// agent-update-task
// Called by the ChatGPT agent via GPT Action to update an existing task.
// Also inserts a task_events row describing the change.
//
// SECURITY:
// - Authenticated via X-Agent-Token; user_id resolved from token
// - Ownership verified: task.user_id must match the resolved user_id
// - task_id must be retrieved from agent-context first;
//   the agent must never invent task IDs
// - Audit log entry written for every update

import {
  errorResponse,
  handleCors,
  jsonResponse,
} from "../_shared/cors.ts";
import {
  authenticateAgentToken,
  serviceClient,
} from "../_shared/auth.ts";

const VALID_STATUSES = new Set([
  "open",
  "in_progress",
  "waiting",
  "done",
  "archived",
]);
const VALID_PRIORITIES = new Set(["low", "medium", "high", "critical"]);

Deno.serve(async (req: Request) => {
  const corsResult = handleCors(req);
  if (corsResult) return corsResult;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const auth = await authenticateAgentToken(req);
  if (!auth) return errorResponse("Unauthorized", 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("Invalid request body", 400);
  }

  const taskId: string | null =
    typeof body.task_id === "string" ? body.task_id : null;
  if (!taskId) return errorResponse("task_id is required", 400);

  const { userId, connectionId } = auth;
  const db = serviceClient();

  // Fetch and verify ownership before applying any change
  const { data: existing, error: fetchError } = await db
    .from("tasks")
    .select("id, user_id, status, title, description, priority")
    .eq("id", taskId)
    .single();

  if (fetchError || !existing) return errorResponse("Task not found", 404);
  if (existing.user_id !== userId) return errorResponse("Forbidden", 403);

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.status === "string" && VALID_STATUSES.has(body.status)) {
    updates.status = body.status;
  }
  if (typeof body.title === "string") {
    updates.title = body.title.slice(0, 500);
  }
  if (typeof body.description === "string") {
    updates.description = body.description;
  }
  if (
    typeof body.priority === "string" &&
    VALID_PRIORITIES.has(body.priority)
  ) {
    updates.priority = body.priority;
  }
  if (typeof body.due_at === "string") {
    updates.due_at = body.due_at;
  } else if (body.due_at === null) {
    updates.due_at = null;
  }

  // Require at least one meaningful field change beyond the timestamp
  if (Object.keys(updates).length <= 1) {
    return errorResponse("No valid fields to update", 400);
  }

  const { data: updated, error: updateError } = await db
    .from("tasks")
    .update(updates)
    .eq("id", taskId)
    .select("id, title, status, priority, due_at, updated_at")
    .single();

  if (updateError) {
    console.error("agent-update-task update error:", updateError.code);
    return errorResponse("Failed to update task", 500);
  }

  const newStatus = (updates.status as string | undefined) ?? existing.status;

  // task_events row
  await db.from("task_events").insert({
    user_id: userId,
    task_id: taskId,
    actor: "agent",
    event_type: updates.status !== undefined ? "status_changed" : "updated",
    previous_status: existing.status,
    new_status: newStatus,
    details: {
      fields_updated: Object.keys(updates).filter((k) => k !== "updated_at"),
      connection_id: connectionId,
    },
  });

  // Audit log (sanitised — no raw description content)
  await db.from("audit_logs").insert({
    user_id: userId,
    actor: "agent",
    actor_id: connectionId,
    action: "task.update",
    entity_type: "tasks",
    entity_id: taskId,
    before_snapshot: {
      status: existing.status,
      priority: existing.priority,
    },
    after_snapshot: {
      status: updated?.status,
      priority: updated?.priority,
    },
  });

  return jsonResponse({ task: updated });
});
