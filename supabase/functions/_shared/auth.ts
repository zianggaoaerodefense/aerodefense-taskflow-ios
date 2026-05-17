import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Service client bypasses RLS. Only used inside Edge Functions; never exposed
// to the mobile app or ChatGPT agent.
export function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Verify a mobile app user's Supabase JWT and return their user_id.
// Returns null for any invalid or missing token.
export async function authenticateAppUser(
  req: Request,
): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const jwt = authHeader.slice(7);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await client.auth.getUser(jwt);
  if (error || !user) return null;

  return { userId: user.id };
}

// Verify a ChatGPT agent request using the X-Agent-Token header.
// Maps the token hash to the owning user_id.
// user_id is NEVER taken from the request body.
export async function authenticateAgentToken(
  req: Request,
): Promise<{ userId: string; connectionId: string } | null> {
  const rawToken = req.headers.get("X-Agent-Token");
  if (!rawToken) return null;

  const tokenHash = await hashToken(rawToken);
  const db = serviceClient();

  const { data, error } = await db
    .from("agent_connections")
    .select("id, user_id, status, expires_at")
    .eq("token_hash", tokenHash)
    .single();

  if (error || !data) return null;
  if (data.status !== "active") return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Fire-and-forget last_used_at update — don't let it block the response
  db.from("agent_connections")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return { userId: data.user_id, connectionId: data.id };
}

export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(token),
  );
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateToken(byteLength = 32): string {
  const array = new Uint8Array(byteLength);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
