// TypeScript types mirroring supabase/migrations/*.sql
// Keep in sync with packages/shared/src/types.ts when making schema changes.

export type TaskStatus = 'open' | 'in_progress' | 'waiting' | 'done' | 'archived'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'

// Enriched source values. Legacy 'agent'/'user' kept for backward compatibility.
export type TaskSource =
  | 'email'
  | 'slack'
  | 'calendar'
  | 'jira'
  | 'github'
  | 'chatgpt_agent'
  | 'manual'
  | 'agent'   // legacy
  | 'user'    // legacy

export type TaskCategory =
  | 'review'
  | 'respond'
  | 'approve'
  | 'follow_up'
  | 'schedule'
  | 'prepare'
  | 'investigate'
  | 'implement'
  | 'test'
  | 'deploy'
  | 'decide'
  | 'summarize'
  | 'monitor'
  | 'delegate'
  | 'blocked'

export interface Task {
  id: string
  user_id: string
  workflow_id: string | null
  summary_id: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_at: string | null
  snoozed_until: string | null
  source: TaskSource
  // Enriched source fields
  source_type: string | null
  source_ref: string | null
  source_title: string | null
  source_url: string | null
  last_source_at: string | null
  // Categorization
  task_category: TaskCategory | null
  task_subcategory: string | null
  workflow_name: string | null
  project_name: string | null
  requester: string | null
  owner: string | null
  // Grouping and scoring
  tags: string[]
  group_keys: Record<string, string>
  metadata: Record<string, unknown>
  urgency_score: number
  importance_score: number
  duplicate_check_note: string | null
  created_at: string
  updated_at: string
}

export interface Summary {
  id: string
  user_id: string
  workflow_id: string | null
  title: string
  content: string
  source: string | null
  source_ref: string | null
  status: 'active' | 'archived'
  // Enriched fields
  summary_date: string | null
  source_coverage: string[]
  key_decisions: string[]
  blockers: string[]
  next_actions: string[]
  category_breakdown: Record<string, unknown>
  workflow_breakdown: unknown[]
  recommended_views: string[]
  created_at: string
  updated_at: string
}

export interface Workflow {
  id: string
  user_id: string
  name: string
  description: string | null
  status: 'active' | 'paused' | 'archived'
  // Enriched fields
  objective: string | null
  current_focus: string | null
  cadence: string | null
  next_review_at: string | null
  project_name: string | null
  workflow_category: string | null
  primary_sources: string[]
  related_people: string[]
  related_repos: string[]
  related_jira_projects: string[]
  related_slack_channels: string[]
  related_customers: string[]
  sort_order: number
  active_task_count: number
  blocked_task_count: number
  high_priority_task_count: number
  created_at: string
  updated_at: string
}

export interface WorkflowRun {
  id: string
  user_id: string
  workflow_id: string | null
  status: 'running' | 'completed' | 'failed'
  input: Record<string, unknown> | null
  output: Record<string, unknown> | null
  error: string | null
  started_at: string
  completed_at: string | null
  // Enriched fields
  source_coverage: string[]
  tasks_created_count: number
  tasks_updated_count: number
  duplicates_skipped_count: number
  summaries_created_count: number
  workflows_created_or_updated_count: number
  created_at: string
}

export interface AgentConnection {
  id: string
  user_id: string
  label: string
  status: 'active' | 'revoked'
  expires_at: string | null
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
}

export interface TaskEvent {
  id: string
  user_id: string
  task_id: string
  actor: 'user' | 'agent' | 'system'
  event_type: string
  previous_status: TaskStatus | null
  new_status: TaskStatus | null
  details: Record<string, unknown>
  // Enriched fields
  source_type: string | null
  task_category: string | null
  workflow_name: string | null
  project_name: string | null
  created_at: string
}
