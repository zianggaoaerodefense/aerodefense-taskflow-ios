// Agent connection service.
// createConnection and revokeConnection call Edge Functions (not raw Supabase)
// because the Edge Functions generate the one-time token and apply audit logs.
// listConnections uses the Supabase client directly (RLS scopes it to the user).
//
// SECURITY:
// - Raw tokens are never stored; the caller must display and discard them.
// - The service role key is never used here.

import { supabase } from '../lib/supabase'
import type { AgentConnection } from '../types/database'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!

export async function listConnections(): Promise<AgentConnection[]> {
  const { data, error } = await supabase
    .from('agent_connections')
    .select('id, label, status, expires_at, last_used_at, created_at, revoked_at')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data as AgentConnection[]
}

export interface CreatedConnection {
  connection: Pick<AgentConnection, 'id' | 'label' | 'status' | 'expires_at' | 'created_at'>
  token: string
  warning: string
}

export async function createConnection(
  label: string,
  expiresDays?: number,
): Promise<CreatedConnection> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const body: Record<string, unknown> = { label }
  if (expiresDays && expiresDays > 0) body.expires_in_days = expiresDays

  const res = await fetch(`${supabaseUrl}/functions/v1/create-agent-connection`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error ?? 'Failed to create connection')
  }

  return res.json() as Promise<CreatedConnection>
}

export async function revokeConnection(connectionId: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')

  const res = await fetch(`${supabaseUrl}/functions/v1/revoke-agent-connection`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ connection_id: connectionId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error ?? 'Failed to revoke connection')
  }
}
