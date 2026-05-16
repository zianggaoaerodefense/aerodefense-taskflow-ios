// create-agent-connection
// Called by the authenticated mobile app user.
// Generates a one-time cryptographic token, stores only its SHA-256 hash,
// and returns the raw token once. It is never stored and cannot be recovered.
//
// SECURITY:
// - user_id is derived from the verified Supabase JWT, never from the body
// - Only the token hash is persisted; the raw token is ephemeral
// - Audit log entry written for every connection created

import {
  errorResponse,
  handleCors,
  jsonResponse,
} from "../_shared/cors.ts";
import {
  authenticateAppUser,
  generateToken,
  hashToken,
  serviceClient,
} from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const corsResult = handleCors(req);
  if (corsResult) return corsResult;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const auth = await authenticateAppUser(req);
  if (!auth) return errorResponse("Unauthorized", 401);

  const body = await req.json().catch(() => ({}));
  const label: string =
    typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim().slice(0, 100)
      : "ChatGPT Agent";
  const expiresDays: number | null =
    typeof body.expires_in_days === "number" && body.expires_in_days > 0
      ? Math.min(body.expires_in_days, 365)
      : null;

  const rawToken = generateToken(32);
  const tokenHash = await hashToken(rawToken);
  const expiresAt = expiresDays
    ? new Date(
        Date.now() + expiresDays * 24 * 60 * 60 * 1000,
      ).toISOString()
    : null;

  const db = serviceClient();

  const { data, error } = await db
    .from("agent_connections")
    .insert({
      user_id: auth.userId,
      token_hash: tokenHash,
      label,
      status: "active",
      expires_at: expiresAt,
    })
    .select("id, label, status, expires_at, created_at")
    .single();

  if (error) {
    console.error("create-agent-connection insert error:", error.code);
    return errorResponse("Failed to create connection", 500);
  }

  await db.from("audit_logs").insert({
    user_id: auth.userId,
    actor: "user",
    actor_id: auth.userId,
    action: "agent_connection.create",
    entity_type: "agent_connections",
    entity_id: data.id,
    after_snapshot: { label, expires_at: expiresAt },
  });

  return jsonResponse({
    connection: data,
    token: rawToken,
    warning:
      "Copy and store this token securely. It will not be shown again.",
  });
});
