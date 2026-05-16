// TypeScript types mirroring supabase/migrations/20240101000000_initial_schema.sql
// Keep in sync with packages/shared/src/types.ts when making schema changes.

export type TaskStatus = 'open' | 'in_progress' | 'waiting' | 'done' | 'archived'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'
export type TaskSource = 'agent' | 'user'

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
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export interface Workflow {
  id: string
  user_id: string
  name: string
  description: string | null
  status: 'active' | 'paused' | 'archived'
  created_at: string
  updated_at: string
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
  created_at: string
}
