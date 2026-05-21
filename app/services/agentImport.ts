// Agent import service.
// Validates JSON produced by a ChatGPT agent (Skills output) and writes it
// to Supabase on behalf of the authenticated user.
//
// SECURITY:
// - user_id is always sourced from the authenticated session, never from the
//   imported JSON. The forbidden-key scan rejects payloads that contain
//   user_id or any credential-like field name before any processing.
// - audit_logs INSERT is service-role-only (RLS); task_events rows provide
//   the audit trail for imported tasks from the app side.
// - All writes use the anon key + user JWT; RLS enforces ownership.
// - Secret-like values are stripped from metadata before writing.

import { supabase } from '../lib/supabase'
import type { TaskCategory, TaskPriority, TaskSource } from '../types/database'
import { generateTaskGroupKeys } from '../utils/groupKeys'
import { computeImportanceScore, computeUrgencyScore } from '../utils/urgencyScore'

// ---------------------------------------------------------------------------
// Payload types (what the agent is expected to produce)
// ---------------------------------------------------------------------------

export interface ImportTaskInput {
  title: string
  description?: string | null
  priority?: TaskPriority
  status?: string
  due_at?: string | null
  workflow_name?: string | null
  project_name?: string | null
  source?: TaskSource
  source_type?: string | null
  source_ref?: string | null
  source_title?: string | null
  source_url?: string | null
  last_source_at?: string | null
  task_category?: TaskCategory | null
  task_subcategory?: string | null
  requester?: string | null
  owner?: string | null
  tags?: string[]
  group_keys?: Record<string, string>
  metadata?: Record<string, unknown>
  urgency_score?: number
  importance_score?: number
}

export interface ImportWorkflowInput {
  name: string
  description?: string
  objective?: string
  project_name?: string | null
  workflow_category?: string | null
  primary_sources?: string[]
  related_people?: string[]
  related_repos?: string[]
  related_jira_projects?: string[]
  related_slack_channels?: string[]
  related_customers?: string[]
}

export interface ImportSummaryInput {
  title: string
  content?: string
  body?: string
  summary_date?: string | null
  source_coverage?: string[]
  key_decisions?: string[]
  blockers?: string[]
  next_actions?: string[]
  category_breakdown?: Record<string, unknown>
  workflow_breakdown?: unknown[]
  recommended_views?: string[]
}

export interface ImportAgentMessageInput {
  content: string
}

// Supports both legacy format and new enriched format from the ChatGPT agent.
export interface AgentImportPayload {
  // New format
  version?: string
  generated_at?: string
  mode?: string
  summaries?: ImportSummaryInput[]
  agent_messages?: ImportAgentMessageInput[]
  // Legacy single-object format (normalized to arrays internally)
  summary?: ImportSummaryInput
  agent_message?: ImportAgentMessageInput
  // Shared
  workflows?: ImportWorkflowInput[]
  tasks?: ImportTaskInput[]
  workflow_runs?: Record<string, unknown>[]
  task_events?: Record<string, unknown>[]
  audit_logs?: Record<string, unknown>[]
}

export interface ImportPreview {
  summaryTitle: string | null
  workflowCount: number
  taskCount: number
  hasAgentMessage: boolean
  enrichedTaskCount: number
}

export interface ImportResult {
  taskCount: number
  workflowCount: number
  hasSummary: boolean
  duplicatesSkipped: number
}

// ---------------------------------------------------------------------------
// Forbidden key scan
// Rejects payloads that contain credential-like field names at any depth.
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set([
  'user_id', 'userId',
  'service_role_key', 'serviceRoleKey',
  'api_key', 'apiKey',
  'api_secret', 'apiSecret',
  'token',
  'password', 'passwd',
  'secret',
  'anon_key', 'anonKey',
  'bearer',
  'jwt',
  'access_token', 'accessToken',
  'refresh_token', 'refreshToken',
  'private_key', 'privateKey',
  'credentials', 'credential',
  'auth_token', 'authToken',
  'session_token', 'sessionToken',
  'cookie', 'cookies',
])

function findForbiddenKey(obj: unknown): string | null {
  if (obj === null || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = findForbiddenKey(item)
      if (hit) return hit
    }
    return null
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return key
    const hit = findForbiddenKey(value)
    if (hit) return hit
  }
  return null
}

// Strip credential-like keys from a metadata object rather than rejecting the whole payload.
const METADATA_STRIP_PATTERN = /key|token|secret|password|credential|auth|bearer|cookie|jwt/i

function sanitizeMetadata(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (METADATA_STRIP_PATTERN.test(k)) continue
    clean[k] = v
  }
  return clean
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_PRIORITIES = new Set<TaskPriority>(['low', 'medium', 'high', 'critical'])
const VALID_STATUSES = new Set(['open', 'in_progress', 'waiting', 'done', 'archived'])
const VALID_SOURCES = new Set<TaskSource>([
  'email', 'slack', 'calendar', 'jira', 'github',
  'chatgpt_agent', 'manual', 'agent', 'user',
])
const VALID_CATEGORIES = new Set<TaskCategory>([
  'review', 'respond', 'approve', 'follow_up', 'schedule',
  'prepare', 'investigate', 'implement', 'test', 'deploy',
  'decide', 'summarize', 'monitor', 'delegate', 'blocked',
])

function parseIsoDate(s: string): string | undefined {
  const d = new Date(s)
  return isNaN(d.getTime()) ? undefined : d.toISOString()
}

// ChatGPT web renders typographic/smart quotes instead of ASCII quotes.
// Normalization is applied only when the original text fails to parse.
function normalizeQuotes(text: string): string {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
}

const PARSE_FAILED = Symbol()

function tryParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return PARSE_FAILED }
}

// ---------------------------------------------------------------------------
// Task field parsing
// ---------------------------------------------------------------------------

function parseTaskInput(t: Record<string, unknown>, i: number): ImportTaskInput {
  if (typeof t.title !== 'string' || !t.title.trim()) {
    throw new Error(`tasks[${i}].title must be a non-empty string.`)
  }

  const priority = t.priority as string | undefined
  if (priority !== undefined && !VALID_PRIORITIES.has(priority as TaskPriority)) {
    throw new Error(`tasks[${i}].priority must be one of: low, medium, high, critical.`)
  }

  const source = t.source as string | undefined
  if (source !== undefined && !VALID_SOURCES.has(source as TaskSource)) {
    throw new Error(
      `tasks[${i}].source must be one of: email, slack, calendar, jira, github, chatgpt_agent, manual.`,
    )
  }

  const task_category = t.task_category as string | undefined
  if (task_category !== undefined && task_category !== null && !VALID_CATEGORIES.has(task_category as TaskCategory)) {
    throw new Error(
      `tasks[${i}].task_category must be one of the supported category values.`,
    )
  }

  const rawMeta = t.metadata
  let metadata: Record<string, unknown> | undefined
  if (rawMeta !== undefined && rawMeta !== null) {
    if (typeof rawMeta !== 'object' || Array.isArray(rawMeta)) {
      throw new Error(`tasks[${i}].metadata must be an object.`)
    }
    metadata = sanitizeMetadata(rawMeta as Record<string, unknown>)
  }

  const tags = t.tags
  if (tags !== undefined && !Array.isArray(tags)) {
    throw new Error(`tasks[${i}].tags must be an array.`)
  }
  const safeTags = Array.isArray(tags)
    ? (tags as unknown[]).filter((v): v is string => typeof v === 'string')
    : undefined

  const group_keys = t.group_keys
  if (group_keys !== undefined && group_keys !== null && (typeof group_keys !== 'object' || Array.isArray(group_keys))) {
    throw new Error(`tasks[${i}].group_keys must be an object.`)
  }

  return {
    title: (t.title as string).trim(),
    description: typeof t.description === 'string' ? t.description.trim() || undefined : undefined,
    priority: priority as TaskPriority | undefined,
    status: typeof t.status === 'string' && VALID_STATUSES.has(t.status) ? t.status : undefined,
    due_at: typeof t.due_at === 'string' ? parseIsoDate(t.due_at) : undefined,
    workflow_name: typeof t.workflow_name === 'string' ? t.workflow_name.trim() || undefined : undefined,
    project_name: typeof t.project_name === 'string' ? t.project_name.trim() || undefined : undefined,
    source: source as TaskSource | undefined,
    source_type: typeof t.source_type === 'string' ? t.source_type.trim() || undefined : undefined,
    source_ref: typeof t.source_ref === 'string' ? t.source_ref.trim() || undefined : undefined,
    source_title: typeof t.source_title === 'string' ? t.source_title.trim() || undefined : undefined,
    source_url: typeof t.source_url === 'string' ? t.source_url.trim() || undefined : undefined,
    last_source_at: typeof t.last_source_at === 'string' ? parseIsoDate(t.last_source_at) : undefined,
    task_category: task_category as TaskCategory | undefined,
    task_subcategory: typeof t.task_subcategory === 'string' ? t.task_subcategory.trim() || undefined : undefined,
    requester: typeof t.requester === 'string' ? t.requester.trim() || undefined : undefined,
    owner: typeof t.owner === 'string' ? t.owner.trim() || undefined : undefined,
    tags: safeTags,
    group_keys: group_keys != null ? (group_keys as Record<string, string>) : undefined,
    metadata,
    urgency_score: typeof t.urgency_score === 'number' ? Math.max(0, Math.round(t.urgency_score)) : undefined,
    importance_score: typeof t.importance_score === 'number' ? Math.max(0, Math.round(t.importance_score)) : undefined,
  }
}

// ---------------------------------------------------------------------------
// Parse and validate
// ---------------------------------------------------------------------------

export function parseAndValidate(text: string): AgentImportPayload {
  const trimmed = text.trim()
  let raw = tryParse(trimmed)
  if (raw === PARSE_FAILED) raw = tryParse(normalizeQuotes(trimmed))
  if (raw === PARSE_FAILED) {
    throw new Error('Invalid JSON — paste the raw output from the agent.')
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Expected a JSON object at the top level.')
  }

  const forbidden = findForbiddenKey(raw)
  if (forbidden) {
    throw new Error(
      `Refused: JSON contains the field "${forbidden}". Remove any credentials or IDs before importing.`,
    )
  }

  const obj = raw as Record<string, unknown>

  // Support both legacy (summary/agent_message) and new format (summaries[]/agent_messages[])
  const hasSummary = obj.summary !== undefined || (Array.isArray(obj.summaries) && obj.summaries.length > 0)
  const hasTasks = Array.isArray(obj.tasks) && obj.tasks.length > 0
  const hasWorkflows = Array.isArray(obj.workflows) && obj.workflows.length > 0
  const hasAgentMessage =
    obj.agent_message !== undefined ||
    (Array.isArray(obj.agent_messages) && obj.agent_messages.length > 0)

  if (!hasSummary && !hasTasks && !hasWorkflows && !hasAgentMessage) {
    throw new Error(
      'JSON must contain at least one of: summary, summaries, tasks, workflows, agent_message, agent_messages.',
    )
  }

  const payload: AgentImportPayload = {
    version: typeof obj.version === 'string' ? obj.version : undefined,
    generated_at: typeof obj.generated_at === 'string' ? obj.generated_at : undefined,
    mode: typeof obj.mode === 'string' ? obj.mode : undefined,
  }

  // Summaries — normalize legacy single object to array
  const rawSummaries: unknown[] = []
  if (Array.isArray(obj.summaries)) rawSummaries.push(...obj.summaries)
  if (obj.summary !== undefined) rawSummaries.push(obj.summary)

  if (rawSummaries.length > 0) {
    payload.summaries = rawSummaries.map((s, i) => {
      if (typeof s !== 'object' || s === null || Array.isArray(s)) {
        throw new Error(`summaries[${i}] must be an object.`)
      }
      const sm = s as Record<string, unknown>
      if (typeof sm.title !== 'string' || !sm.title.trim()) {
        throw new Error(`summaries[${i}].title must be a non-empty string.`)
      }
      const content =
        [sm.content, sm.body].find((v): v is string => typeof v === 'string' && v.trim().length > 0) ?? null
      if (!content) {
        throw new Error(`summaries[${i}] must have a non-empty "content" or "body" field.`)
      }
      return {
        title: sm.title.trim(),
        content: content.trim(),
        summary_date: typeof sm.summary_date === 'string' ? sm.summary_date : undefined,
        source_coverage: Array.isArray(sm.source_coverage)
          ? (sm.source_coverage as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        key_decisions: Array.isArray(sm.key_decisions)
          ? (sm.key_decisions as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        blockers: Array.isArray(sm.blockers)
          ? (sm.blockers as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        next_actions: Array.isArray(sm.next_actions)
          ? (sm.next_actions as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        category_breakdown:
          typeof sm.category_breakdown === 'object' && sm.category_breakdown !== null && !Array.isArray(sm.category_breakdown)
            ? (sm.category_breakdown as Record<string, unknown>)
            : undefined,
        workflow_breakdown: Array.isArray(sm.workflow_breakdown) ? sm.workflow_breakdown : undefined,
        recommended_views: Array.isArray(sm.recommended_views)
          ? (sm.recommended_views as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
      }
    })
  }

  // Workflows
  if (obj.workflows !== undefined) {
    if (!Array.isArray(obj.workflows)) throw new Error('"workflows" must be an array.')
    payload.workflows = (obj.workflows as unknown[]).map((w, i) => {
      if (typeof w !== 'object' || w === null) throw new Error(`workflows[${i}] must be an object.`)
      const wf = w as Record<string, unknown>
      if (typeof wf.name !== 'string' || !wf.name.trim()) {
        throw new Error(`workflows[${i}].name must be a non-empty string.`)
      }
      const desc =
        [wf.description, wf.objective].find((v): v is string => typeof v === 'string' && v.trim().length > 0)
      return {
        name: wf.name.trim(),
        description: desc?.trim() || undefined,
        objective: typeof wf.objective === 'string' ? wf.objective.trim() || undefined : undefined,
        project_name: typeof wf.project_name === 'string' ? wf.project_name.trim() || undefined : undefined,
        workflow_category: typeof wf.workflow_category === 'string' ? wf.workflow_category.trim() || undefined : undefined,
        primary_sources: Array.isArray(wf.primary_sources)
          ? (wf.primary_sources as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        related_people: Array.isArray(wf.related_people)
          ? (wf.related_people as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        related_repos: Array.isArray(wf.related_repos)
          ? (wf.related_repos as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        related_jira_projects: Array.isArray(wf.related_jira_projects)
          ? (wf.related_jira_projects as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        related_slack_channels: Array.isArray(wf.related_slack_channels)
          ? (wf.related_slack_channels as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
        related_customers: Array.isArray(wf.related_customers)
          ? (wf.related_customers as unknown[]).filter((v): v is string => typeof v === 'string')
          : undefined,
      }
    })
  }

  // Tasks
  if (obj.tasks !== undefined) {
    if (!Array.isArray(obj.tasks)) throw new Error('"tasks" must be an array.')
    payload.tasks = (obj.tasks as unknown[]).map((t, i) => {
      if (typeof t !== 'object' || t === null) throw new Error(`tasks[${i}] must be an object.`)
      return parseTaskInput(t as Record<string, unknown>, i)
    })
  }

  // Agent messages — normalize legacy single object to array
  const rawMessages: unknown[] = []
  if (Array.isArray(obj.agent_messages)) rawMessages.push(...obj.agent_messages)
  if (obj.agent_message !== undefined) rawMessages.push(obj.agent_message)

  if (rawMessages.length > 0) {
    payload.agent_messages = rawMessages.map((m, i) => {
      if (typeof m !== 'object' || m === null) throw new Error(`agent_messages[${i}] must be an object.`)
      const msg = m as Record<string, unknown>
      if (typeof msg.content !== 'string' || !msg.content.trim()) {
        throw new Error(`agent_messages[${i}].content must be a non-empty string.`)
      }
      return { content: msg.content.trim() }
    })
  }

  return payload
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export function buildPreview(payload: AgentImportPayload): ImportPreview {
  const tasks = payload.tasks ?? []
  const enrichedTaskCount = tasks.filter(
    (t) => t.source_type || t.task_category || t.requester || t.project_name,
  ).length
  const summaries = payload.summaries ?? []
  return {
    summaryTitle: summaries[0]?.title ?? null,
    workflowCount: payload.workflows?.length ?? 0,
    taskCount: tasks.length,
    hasAgentMessage: (payload.agent_messages?.length ?? 0) > 0,
    enrichedTaskCount,
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

async function findDuplicateTaskId(
  userId: string,
  task: ImportTaskInput,
): Promise<string | null> {
  if (!task.source_ref) return null

  const { data } = await supabase
    .from('tasks')
    .select('id')
    .eq('user_id', userId)
    .eq('source', task.source ?? 'chatgpt_agent')
    .eq('source_ref', task.source_ref)
    .in('status', ['open', 'in_progress', 'waiting'])
    .limit(1)

  return data?.[0]?.id ?? null
}

async function updateExistingTask(
  taskId: string,
  task: ImportTaskInput,
  userId: string,
): Promise<void> {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (task.source_title) updates.source_title = task.source_title
  if (task.source_url) updates.source_url = task.source_url
  if (task.last_source_at) updates.last_source_at = task.last_source_at
  if (task.description) updates.description = task.description
  if (task.urgency_score !== undefined) updates.urgency_score = task.urgency_score
  if (task.group_keys) updates.group_keys = task.group_keys
  if (task.metadata) updates.metadata = task.metadata

  await supabase.from('tasks').update(updates).eq('id', taskId)
  await supabase.from('task_events').insert({
    user_id: userId,
    task_id: taskId,
    actor: 'agent',
    event_type: 'updated',
    details: { source: 'import_duplicate_update', source_ref: task.source_ref },
  })
}

// ---------------------------------------------------------------------------
// Write to Supabase
// ---------------------------------------------------------------------------

export async function executeImport(payload: AgentImportPayload): Promise<ImportResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const userId = session.user.id

  // 1. Insert workflows; build name → id map.
  const workflowNameToId = new Map<string, string>()
  if (payload.workflows?.length) {
    const { data, error } = await supabase
      .from('workflows')
      .insert(
        payload.workflows.map((w) => ({
          user_id: userId,
          name: w.name,
          description: w.description ?? null,
          objective: w.objective ?? null,
          project_name: w.project_name ?? null,
          workflow_category: w.workflow_category ?? null,
          primary_sources: w.primary_sources ?? [],
          related_people: w.related_people ?? [],
          related_repos: w.related_repos ?? [],
          related_jira_projects: w.related_jira_projects ?? [],
          related_slack_channels: w.related_slack_channels ?? [],
          related_customers: w.related_customers ?? [],
          status: 'active',
        })),
      )
      .select('id, name')
    if (error) throw error
    for (const row of data) workflowNameToId.set(row.name, row.id)
  }

  const firstWorkflowId =
    workflowNameToId.size > 0 ? workflowNameToId.values().next().value : null

  // 2. Insert summaries.
  let summaryId: string | null = null
  const summaries = payload.summaries ?? []
  if (summaries.length > 0) {
    const first = summaries[0]
    const { data, error } = await supabase
      .from('summaries')
      .insert({
        user_id: userId,
        title: first.title,
        content: first.content ?? first.body ?? '',
        source: 'agent',
        status: 'active',
        workflow_id: firstWorkflowId,
        summary_date: first.summary_date ?? null,
        source_coverage: first.source_coverage ?? [],
        key_decisions: first.key_decisions ?? [],
        blockers: first.blockers ?? [],
        next_actions: first.next_actions ?? [],
        category_breakdown: first.category_breakdown ?? {},
        workflow_breakdown: first.workflow_breakdown ?? [],
        recommended_views: first.recommended_views ?? [],
      })
      .select('id')
      .single()
    if (error) throw error
    summaryId = data.id
  }

  // 3. Insert tasks with duplicate checking.
  let taskCount = 0
  let duplicatesSkipped = 0

  if (payload.tasks?.length) {
    const tasksToInsert: Record<string, unknown>[] = []
    const skippedTaskIds: string[] = []

    for (const t of payload.tasks) {
      const dupId = await findDuplicateTaskId(userId, t)
      if (dupId) {
        await updateExistingTask(dupId, t, userId)
        skippedTaskIds.push(dupId)
        duplicatesSkipped++
        continue
      }

      const effectiveSource: TaskSource = t.source ?? 'chatgpt_agent'
      const tags = t.tags ?? []
      const metadata = t.metadata ?? {}

      // Auto-generate group_keys if agent did not include them.
      const group_keys =
        t.group_keys && Object.keys(t.group_keys).length > 0
          ? t.group_keys
          : generateTaskGroupKeys({
              source: effectiveSource,
              source_type: t.source_type,
              task_category: t.task_category,
              workflow_name: t.workflow_name,
              project_name: t.project_name,
              due_at: t.due_at,
              requester: t.requester,
              owner: t.owner,
            })

      // Auto-compute urgency/importance if agent did not include them.
      const scoringInput = {
        priority: t.priority,
        due_at: t.due_at,
        source: effectiveSource,
        source_type: t.source_type,
        task_category: t.task_category,
        tags,
        metadata,
      }
      const urgency_score = t.urgency_score ?? computeUrgencyScore(scoringInput)
      const importance_score = t.importance_score ?? computeImportanceScore(scoringInput)

      const workflowId = t.workflow_name
        ? (workflowNameToId.get(t.workflow_name) ?? null)
        : null

      tasksToInsert.push({
        user_id: userId,
        title: t.title,
        description: t.description ?? null,
        status: t.status ?? 'open',
        priority: t.priority ?? 'medium',
        due_at: t.due_at ?? null,
        source: effectiveSource,
        source_type: t.source_type ?? null,
        source_ref: t.source_ref ?? null,
        source_title: t.source_title ?? null,
        source_url: t.source_url ?? null,
        last_source_at: t.last_source_at ?? null,
        task_category: t.task_category ?? null,
        task_subcategory: t.task_subcategory ?? null,
        workflow_name: t.workflow_name ?? null,
        project_name: t.project_name ?? null,
        requester: t.requester ?? null,
        owner: t.owner ?? null,
        tags,
        group_keys,
        metadata,
        urgency_score,
        importance_score,
        workflow_id: workflowId,
        summary_id: summaryId,
      })
    }

    if (tasksToInsert.length > 0) {
      const { data: tasks, error: taskError } = await supabase
        .from('tasks')
        .insert(tasksToInsert)
        .select('id, source, task_category, workflow_name, project_name')
      if (taskError) throw taskError
      taskCount = tasks.length

      const { error: eventError } = await supabase.from('task_events').insert(
        tasks.map((t: Record<string, unknown>) => ({
          user_id: userId,
          task_id: t.id,
          actor: 'agent',
          event_type: 'created',
          new_status: 'open',
          source_type: t.source ?? null,
          task_category: t.task_category ?? null,
          workflow_name: t.workflow_name ?? null,
          project_name: t.project_name ?? null,
          details: { source: 'import' },
        })),
      )
      if (eventError) throw eventError
    }
  }

  // 4. Insert agent messages.
  const messages = payload.agent_messages ?? []
  if (messages.length > 0) {
    const { error } = await supabase.from('agent_messages').insert(
      messages.map((m) => ({
        user_id: userId,
        content: m.content,
        role: 'agent',
        workflow_id: firstWorkflowId,
        context: {},
      })),
    )
    if (error) throw error
  }

  return {
    taskCount,
    workflowCount: workflowNameToId.size,
    hasSummary: !!summaryId,
    duplicatesSkipped,
  }
}
