// agent-write
// Called by the ChatGPT agent via GPT Action to persist structured output:
//   - summaries
//   - tasks (always status=open on creation)
//   - agent_messages
//   - workflow_runs
//
// SECURITY:
// - Authenticated via X-Agent-Token; user_id resolved from token, never body
// - Input shapes are validated; unknown fields are ignored
// - Every created task also gets a task_events row (actor=agent)
// - Audit log entry written at the end of every successful call

import {
  errorResponse,
  handleCors,
  jsonResponse,
} from "../_shared/cors.ts";
import {
  authenticateAgentToken,
  serviceClient,
} from "../_shared/auth.ts";

const VALID_PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const VALID_WORKFLOW_RUN_STATUSES = new Set(["running", "completed", "failed"]);

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

  const { userId, connectionId } = auth;
  const db = serviceClient();
  const result: Record<string, unknown> = {};

  // --- summaries ---
  if (Array.isArray(body.summaries) && body.summaries.length > 0) {
    const rows = body.summaries
      .filter(
        (s: unknown) =>
          s !== null &&
          typeof s === "object" &&
          typeof (s as Record<string, unknown>).title === "string" &&
          typeof (s as Record<string, unknown>).content === "string",
      )
      .map((s: Record<string, unknown>) => ({
        user_id: userId,
        title: (s.title as string).slice(0, 500),
        content: s.content as string,
        source: "agent",
        workflow_id:
          typeof s.workflow_id === "string" ? s.workflow_id : null,
        status: "active",
      }));

    if (rows.length > 0) {
      const { data, error } = await db
        .from("summaries")
        .insert(rows)
        .select("id, title, created_at");
      if (error) {
        console.error("agent-write summaries:", error.code);
        return errorResponse("Failed to insert summaries", 500);
      }
      result.summaries = data;
    }
  }

  // --- tasks ---
  if (Array.isArray(body.tasks) && body.tasks.length > 0) {
    const taskRows = body.tasks
      .filter(
        (t: unknown) =>
          t !== null &&
          typeof t === "object" &&
          typeof (t as Record<string, unknown>).title === "string",
      )
      .map((t: Record<string, unknown>) => ({
        user_id: userId,
        title: (t.title as string).slice(0, 500),
        description: typeof t.description === "string" ? t.description : null,
        status: "open",
        priority: VALID_PRIORITIES.has(t.priority as string)
          ? t.priority
          : "medium",
        due_at: typeof t.due_at === "string" ? t.due_at : null,
        workflow_id:
          typeof t.workflow_id === "string" ? t.workflow_id : null,
        source: "agent",
      }));

    if (taskRows.length > 0) {
      const { data: createdTasks, error: taskError } = await db
        .from("tasks")
        .insert(taskRows)
        .select("id, title, status, priority, created_at");

      if (taskError) {
        console.error("agent-write tasks:", taskError.code);
        return errorResponse("Failed to insert tasks", 500);
      }

      // task_events: one row per created task
      if (createdTasks && createdTasks.length > 0) {
        const eventRows = createdTasks.map((t) => ({
          user_id: userId,
          task_id: t.id,
          actor: "agent",
          event_type: "created",
          new_status: "open",
          details: { connection_id: connectionId },
        }));
        await db.from("task_events").insert(eventRows);
      }

      result.tasks = createdTasks;
    }
  }

  // --- agent_messages ---
  if (Array.isArray(body.agent_messages) && body.agent_messages.length > 0) {
    const msgRows = body.agent_messages
      .filter(
        (m: unknown) =>
          m !== null &&
          typeof m === "object" &&
          typeof (m as Record<string, unknown>).content === "string",
      )
      .map((m: Record<string, unknown>) => ({
        user_id: userId,
        role: m.role === "system" ? "system" : "agent",
        content: m.content as string,
        context:
          m.context !== null &&
          typeof m.context === "object" &&
          !Array.isArray(m.context)
            ? m.context
            : {},
      }));

    if (msgRows.length > 0) {
      const { data, error } = await db
        .from("agent_messages")
        .insert(msgRows)
        .select("id, role, created_at");
      if (error) {
        console.error("agent-write agent_messages:", error.code);
        return errorResponse("Failed to insert agent messages", 500);
      }
      result.agent_messages = data;
    }
  }

  // --- workflow_runs ---
  if (Array.isArray(body.workflow_runs) && body.workflow_runs.length > 0) {
    const runRows = body.workflow_runs
      .filter((r: unknown) => r !== null && typeof r === "object")
      .map((r: Record<string, unknown>) => ({
        user_id: userId,
        workflow_id:
          typeof r.workflow_id === "string" ? r.workflow_id : null,
        status: VALID_WORKFLOW_RUN_STATUSES.has(r.status as string)
          ? r.status
          : "completed",
        output:
          r.output !== null &&
          typeof r.output === "object" &&
          !Array.isArray(r.output)
            ? r.output
            : null,
      }));

    if (runRows.length > 0) {
      const { data, error } = await db
        .from("workflow_runs")
        .insert(runRows)
        .select("id, status, created_at");
      if (error) {
        console.error("agent-write workflow_runs:", error.code);
        return errorResponse("Failed to insert workflow runs", 500);
      }
      result.workflow_runs = data;
    }
  }

  // Audit log (redacted counts only — no raw content)
  await db.from("audit_logs").insert({
    user_id: userId,
    actor: "agent",
    actor_id: connectionId,
    action: "agent_write",
    entity_type: "multiple",
    after_snapshot: {
      summaries_count: Array.isArray(result.summaries)
        ? result.summaries.length
        : 0,
      tasks_count: Array.isArray(result.tasks) ? result.tasks.length : 0,
      agent_messages_count: Array.isArray(result.agent_messages)
        ? result.agent_messages.length
        : 0,
      workflow_runs_count: Array.isArray(result.workflow_runs)
        ? result.workflow_runs.length
        : 0,
    },
  });

  return jsonResponse(result);
});
