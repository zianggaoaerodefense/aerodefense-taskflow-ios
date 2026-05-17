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

import { supabase } from '../lib/supabase'
import type { TaskPriority } from '../types/database'

// ---------------------------------------------------------------------------
// Payload types (what the agent is expected to produce)
// ---------------------------------------------------------------------------

export interface ImportTaskInput {
  title: string
  description?: string
  priority?: TaskPriority
  due_at?: string
  workflow_name?: string
}

export interface ImportWorkflowInput {
  name: string
  description?: string
}

export interface ImportSummaryInput {
  title: string
  content: string
}

export interface ImportAgentMessageInput {
  content: string
}

export interface AgentImportPayload {
  summary?: ImportSummaryInput
  workflows?: ImportWorkflowInput[]
  tasks?: ImportTaskInput[]
  agent_message?: ImportAgentMessageInput
}

export interface ImportPreview {
  summaryTitle: string | null
  workflowCount: number
  taskCount: number
  hasAgentMessage: boolean
}

export interface ImportResult {
  taskCount: number
  workflowCount: number
  hasSummary: boolean
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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'critical'])

export function parseAndValidate(text: string): AgentImportPayload {
  let raw: unknown
  try {
    raw = JSON.parse(text.trim())
  } catch {
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

  if (!obj.summary && !obj.tasks && !obj.workflows && !obj.agent_message) {
    throw new Error(
      'JSON must contain at least one of: summary, tasks, workflows, agent_message.',
    )
  }

  const payload: AgentImportPayload = {}

  if (obj.summary !== undefined) {
    if (typeof obj.summary !== 'object' || obj.summary === null || Array.isArray(obj.summary)) {
      throw new Error('"summary" must be an object.')
    }
    const s = obj.summary as Record<string, unknown>
    if (typeof s.title !== 'string' || !s.title.trim()) {
      throw new Error('"summary.title" must be a non-empty string.')
    }
    if (typeof s.content !== 'string' || !s.content.trim()) {
      throw new Error('"summary.content" must be a non-empty string.')
    }
    payload.summary = { title: s.title.trim(), content: s.content.trim() }
  }

  if (obj.workflows !== undefined) {
    if (!Array.isArray(obj.workflows)) throw new Error('"workflows" must be an array.')
    payload.workflows = (obj.workflows as unknown[]).map((w, i) => {
      if (typeof w !== 'object' || w === null) {
        throw new Error(`workflows[${i}] must be an object.`)
      }
      const wf = w as Record<string, unknown>
      if (typeof wf.name !== 'string' || !wf.name.trim()) {
        throw new Error(`workflows[${i}].name must be a non-empty string.`)
      }
      return {
        name: wf.name.trim(),
        description: typeof wf.description === 'string' ? wf.description.trim() || undefined : undefined,
      }
    })
  }

  if (obj.tasks !== undefined) {
    if (!Array.isArray(obj.tasks)) throw new Error('"tasks" must be an array.')
    payload.tasks = (obj.tasks as unknown[]).map((t, i) => {
      if (typeof t !== 'object' || t === null) {
        throw new Error(`tasks[${i}] must be an object.`)
      }
      const task = t as Record<string, unknown>
      if (typeof task.title !== 'string' || !task.title.trim()) {
        throw new Error(`tasks[${i}].title must be a non-empty string.`)
      }
      if (task.priority !== undefined && !VALID_PRIORITIES.has(task.priority as string)) {
        throw new Error(`tasks[${i}].priority must be one of: low, medium, high, critical.`)
      }
      return {
        title: (task.title as string).trim(),
        description:
          typeof task.description === 'string' ? task.description.trim() || undefined : undefined,
        priority: task.priority as TaskPriority | undefined,
        due_at: typeof task.due_at === 'string' ? task.due_at : undefined,
        workflow_name:
          typeof task.workflow_name === 'string' ? task.workflow_name.trim() || undefined : undefined,
      }
    })
  }

  if (obj.agent_message !== undefined) {
    if (typeof obj.agent_message !== 'object' || obj.agent_message === null) {
      throw new Error('"agent_message" must be an object.')
    }
    const m = obj.agent_message as Record<string, unknown>
    if (typeof m.content !== 'string' || !m.content.trim()) {
      throw new Error('"agent_message.content" must be a non-empty string.')
    }
    payload.agent_message = { content: m.content.trim() }
  }

  return payload
}

export function buildPreview(payload: AgentImportPayload): ImportPreview {
  return {
    summaryTitle: payload.summary?.title ?? null,
    workflowCount: payload.workflows?.length ?? 0,
    taskCount: payload.tasks?.length ?? 0,
    hasAgentMessage: !!payload.agent_message,
  }
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

  // 1. Insert workflows; build name → id map for linking tasks/summary.
  const workflowNameToId = new Map<string, string>()
  if (payload.workflows?.length) {
    const { data, error } = await supabase
      .from('workflows')
      .insert(
        payload.workflows.map((w) => ({
          user_id: userId,
          name: w.name,
          description: w.description ?? null,
          status: 'active',
        })),
      )
      .select('id, name')
    if (error) throw error
    for (const row of data) workflowNameToId.set(row.name, row.id)
  }

  // Default workflow id for summary / agent_message (first inserted workflow).
  const firstWorkflowId =
    workflowNameToId.size > 0 ? workflowNameToId.values().next().value : null

  // 2. Insert summary.
  let summaryId: string | null = null
  if (payload.summary) {
    const { data, error } = await supabase
      .from('summaries')
      .insert({
        user_id: userId,
        title: payload.summary.title,
        content: payload.summary.content,
        source: 'agent',
        status: 'active',
        workflow_id: firstWorkflowId,
      })
      .select('id')
      .single()
    if (error) throw error
    summaryId = data.id
  }

  // 3. Insert tasks, then task_events.
  let taskCount = 0
  if (payload.tasks?.length) {
    const { data: tasks, error: taskError } = await supabase
      .from('tasks')
      .insert(
        payload.tasks.map((t) => ({
          user_id: userId,
          title: t.title,
          description: t.description ?? null,
          status: 'open',
          priority: t.priority ?? 'medium',
          due_at: t.due_at ?? null,
          source: 'agent',
          workflow_id: t.workflow_name ? (workflowNameToId.get(t.workflow_name) ?? null) : null,
          summary_id: summaryId,
        })),
      )
      .select('id')
    if (taskError) throw taskError
    taskCount = tasks.length

    const { error: eventError } = await supabase.from('task_events').insert(
      tasks.map((t) => ({
        user_id: userId,
        task_id: t.id,
        actor: 'agent',
        event_type: 'created',
        new_status: 'open',
        details: { source: 'import' },
      })),
    )
    if (eventError) throw eventError
  }

  // 4. Insert agent_message.
  if (payload.agent_message) {
    const { error } = await supabase.from('agent_messages').insert({
      user_id: userId,
      content: payload.agent_message.content,
      role: 'agent',
      workflow_id: firstWorkflowId,
      context: {},
    })
    if (error) throw error
  }

  return { taskCount, workflowCount: workflowNameToId.size, hasSummary: !!summaryId }
}
