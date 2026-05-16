// agent-context
// Called by the ChatGPT agent via GPT Action (GET request).
// Returns the current workflow context for the authenticated user:
//   - open tasks
//   - recently completed tasks
//   - recent task events
//   - active workflows
//   - recent summaries
//   - recent agent messages
//
// SECURITY:
// - Authenticated via X-Agent-Token (hashed, looked up in agent_connections)
// - user_id is always derived from the token lookup, never from the request
// - All queries are scoped to the resolved user_id

import {
  errorResponse,
  handleCors,
  jsonResponse,
} from "../_shared/cors.ts";
import {
  authenticateAgentToken,
  serviceClient,
} from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const corsResult = handleCors(req);
  if (corsResult) return corsResult;

  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const auth = await authenticateAgentToken(req);
  if (!auth) return errorResponse("Unauthorized", 401);

  const db = serviceClient();
  const { userId } = auth;
  const now = new Date();
  const thirtyDaysAgo = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const sevenDaysAgo = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    openTasksResult,
    doneTasksResult,
    eventsResult,
    workflowsResult,
    summariesResult,
    messagesResult,
  ] = await Promise.all([
    db
      .from("tasks")
      .select("id, title, description, status, priority, due_at, created_at, updated_at")
      .eq("user_id", userId)
      .in("status", ["open", "in_progress", "waiting"])
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(50),

    db
      .from("tasks")
      .select("id, title, status, priority, due_at, updated_at")
      .eq("user_id", userId)
      .eq("status", "done")
      .gte("updated_at", thirtyDaysAgo)
      .order("updated_at", { ascending: false })
      .limit(20),

    db
      .from("task_events")
      .select("id, task_id, actor, event_type, previous_status, new_status, details, created_at")
      .eq("user_id", userId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(50),

    db
      .from("workflows")
      .select("id, name, description, status, created_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20),

    db
      .from("summaries")
      .select("id, title, content, source, status, created_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })
      .limit(10),

    db
      .from("agent_messages")
      .select("id, role, content, context, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return jsonResponse({
    as_of: now.toISOString(),
    open_tasks: openTasksResult.data ?? [],
    recently_completed_tasks: doneTasksResult.data ?? [],
    recent_task_events: eventsResult.data ?? [],
    active_workflows: workflowsResult.data ?? [],
    recent_summaries: summariesResult.data ?? [],
    // Reverse so messages are chronological (oldest first) for context
    recent_agent_messages: (messagesResult.data ?? []).reverse(),
  });
});
