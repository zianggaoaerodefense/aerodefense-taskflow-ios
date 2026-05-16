// revoke-agent-connection
// Called by the authenticated mobile app user.
// Revokes an existing agent connection so the ChatGPT agent can no longer
// use it. Ownership is verified before the update is applied.
//
// SECURITY:
// - user_id derived from verified Supabase JWT
// - Ownership check prevents one user from revoking another user's connection

import {
  errorResponse,
  handleCors,
  jsonResponse,
} from "../_shared/cors.ts";
import {
  authenticateAppUser,
  serviceClient,
} from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const corsResult = handleCors(req);
  if (corsResult) return corsResult;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const auth = await authenticateAppUser(req);
  if (!auth) return errorResponse("Unauthorized", 401);

  const body = await req.json().catch(() => ({}));
  const connectionId: string | null =
    typeof body.connection_id === "string" ? body.connection_id : null;
  if (!connectionId) return errorResponse("connection_id is required", 400);

  const db = serviceClient();

  const { data: existing, error: fetchError } = await db
    .from("agent_connections")
    .select("id, user_id, status")
    .eq("id", connectionId)
    .single();

  if (fetchError || !existing) return errorResponse("Connection not found", 404);
  if (existing.user_id !== auth.userId) return errorResponse("Forbidden", 403);
  if (existing.status === "revoked") return errorResponse("Already revoked", 409);

  const { error } = await db
    .from("agent_connections")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  if (error) {
    console.error("revoke-agent-connection update error:", error.code);
    return errorResponse("Failed to revoke connection", 500);
  }

  await db.from("audit_logs").insert({
    user_id: auth.userId,
    actor: "user",
    actor_id: auth.userId,
    action: "agent_connection.revoke",
    entity_type: "agent_connections",
    entity_id: connectionId,
  });

  return jsonResponse({ revoked: true });
});
