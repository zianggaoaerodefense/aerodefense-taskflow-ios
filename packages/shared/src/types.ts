// Shared TypeScript types for TaskFlow.
// These mirror the Postgres schema in supabase/migrations/
// and the request/response shapes of the Edge Functions.

// ---------------------------------------------------------------------------
// Database row types (snake_case to match Postgres columns)
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  display_name: string | null;
  org_id: string | null;
  role: "user" | "admin";
  created_at: string;
  updated_at: string;
}

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRun {
  id: string;
  user_id: string;
  workflow_id: string | null;
  status: "running" | "completed" | "failed";
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface Summary {
  id: string;
  user_id: string;
  workflow_id: string | null;
  title: string;
  content: string;
  source: "agent" | "user" | "manual" | null;
  source_ref: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export type TaskStatus = "open" | "in_progress" | "waiting" | "done" | "archived";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskSource = "agent" | "user";

export interface Task {
  id: string;
  user_id: string;
  workflow_id: string | null;
  summary_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  snoozed_until: string | null;
  source: TaskSource;
  created_at: string;
  updated_at: string;
}

export type TaskEventType =
  | "created"
  | "updated"
  | "status_changed"
  | "snoozed"
  | "completed"
  | "archived";

export interface TaskEvent {
  id: string;
  user_id: string;
  task_id: string;
  actor: "user" | "agent" | "system";
  event_type: TaskEventType;
  previous_status: TaskStatus | null;
  new_status: TaskStatus | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AgentMessage {
  id: string;
  user_id: string;
  workflow_id: string | null;
  role: "agent" | "system";
  content: string;
  context: Record<string, unknown>;
  created_at: string;
}

export interface AgentConnection {
  id: string;
  user_id: string;
  token_hash: string;
  label: string;
  status: "active" | "revoked";
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  actor: "user" | "agent" | "system";
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Edge Function: agent-context response
// ---------------------------------------------------------------------------

export interface AgentContextResponse {
  as_of: string;
  open_tasks: Pick<Task, "id" | "title" | "description" | "status" | "priority" | "due_at" | "created_at" | "updated_at">[];
  recently_completed_tasks: Pick<Task, "id" | "title" | "status" | "priority" | "due_at" | "updated_at">[];
  recent_task_events: Pick<TaskEvent, "id" | "task_id" | "actor" | "event_type" | "previous_status" | "new_status" | "details" | "created_at">[];
  active_workflows: Pick<Workflow, "id" | "name" | "description" | "status" | "created_at">[];
  recent_summaries: Pick<Summary, "id" | "title" | "content" | "source" | "status" | "created_at">[];
  recent_agent_messages: Pick<AgentMessage, "id" | "role" | "content" | "context" | "created_at">[];
}

// ---------------------------------------------------------------------------
// Edge Function: agent-write request/response
// ---------------------------------------------------------------------------

export interface AgentWriteSummaryInput {
  title: string;
  content: string;
  source?: "agent";
  workflow_id?: string;
}

export interface AgentWriteTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  due_at?: string;
  workflow_id?: string;
}

export interface AgentWriteMessageInput {
  role?: "agent" | "system";
  content: string;
  context?: Record<string, unknown>;
}

export interface AgentWriteWorkflowRunInput {
  workflow_id?: string;
  status?: "running" | "completed" | "failed";
  output?: Record<string, unknown>;
}

export interface AgentWriteRequest {
  summaries?: AgentWriteSummaryInput[];
  tasks?: AgentWriteTaskInput[];
  agent_messages?: AgentWriteMessageInput[];
  workflow_runs?: AgentWriteWorkflowRunInput[];
}

export interface AgentWriteResponse {
  summaries?: Pick<Summary, "id" | "title" | "created_at">[];
  tasks?: Pick<Task, "id" | "title" | "status" | "priority" | "created_at">[];
  agent_messages?: Pick<AgentMessage, "id" | "role" | "created_at">[];
  workflow_runs?: Pick<WorkflowRun, "id" | "status" | "created_at">[];
}

// ---------------------------------------------------------------------------
// Edge Function: agent-update-task request/response
// ---------------------------------------------------------------------------

export interface AgentUpdateTaskRequest {
  task_id: string;
  status?: TaskStatus;
  title?: string;
  description?: string;
  priority?: TaskPriority;
  due_at?: string | null;
}

export interface AgentUpdateTaskResponse {
  task: Pick<Task, "id" | "title" | "status" | "priority" | "due_at" | "updated_at">;
}

// ---------------------------------------------------------------------------
// Edge Function: create-agent-connection request/response
// ---------------------------------------------------------------------------

export interface CreateAgentConnectionRequest {
  label?: string;
  expires_in_days?: number;
}

export interface CreateAgentConnectionResponse {
  connection: Pick<AgentConnection, "id" | "label" | "status" | "expires_at" | "created_at">;
  token: string;
  warning: string;
}

// ---------------------------------------------------------------------------
// Edge Function: revoke-agent-connection request/response
// ---------------------------------------------------------------------------

export interface RevokeAgentConnectionRequest {
  connection_id: string;
}

export interface RevokeAgentConnectionResponse {
  revoked: true;
}
