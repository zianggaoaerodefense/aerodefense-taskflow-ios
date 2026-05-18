/**
 * Auth context types for TaskFlow.
 *
 * SECURITY INVARIANTS:
 * - userId is NEVER sourced from the request body. It is always derived from
 *   the verified JWT payload carried in the Authorization header.
 * - Agent tokens carry explicit scopes; every agent-accessible endpoint must
 *   verify the required scope before performing any work.
 */

export type ActorType = 'user' | 'agent' | 'system';

/** Auth context populated from a verified user JWT. */
export interface UserAuthContext {
  type: 'user';
  /** MongoDB user document _id (string form). Sourced from the JWT `sub` claim. */
  userId: string;
  /** Organisation the user belongs to. Used to enforce tenant isolation. */
  orgId: string;
  /** RBAC roles assigned to this user, e.g. ['admin', 'owner']. */
  roles: string[];
}

/** Auth context populated from a verified agent JWT. */
export interface AgentAuthContext {
  type: 'agent';
  /** The user this agent is acting on behalf of. Sourced from the JWT payload. */
  userId: string;
  /** Organisation boundary — must match target documents. */
  orgId: string;
  /** Identifies the specific agent integration (e.g. 'meeting-summariser-v1'). */
  agentId: string;
  /**
   * Explicit permission scopes granted to this token.
   * Every agent endpoint must call requireScope() to verify the needed scope
   * before performing any data mutation.
   */
  scopes: string[];
}

/** Discriminated union of all auth context shapes. */
export type AuthContext = UserAuthContext | AgentAuthContext;

/**
 * Canonical agent scope constants.
 * When adding a new scope, also update the AGENT_SCOPES map below and
 * document which endpoint(s) require it.
 */
export const AGENT_SCOPES = {
  /** Allows the agent to create new meeting-summary documents. */
  SUMMARIES_CREATE: 'agent:summaries:create',
  /** Allows the agent to read task documents owned by the target user. */
  TASKS_READ: 'agent:tasks:read',
  /** Allows the agent to propose task candidates from a summary. */
  TASKS_SUGGEST: 'agent:tasks:suggest',
  /** Allows the agent to create follow-up drafts for user review. */
  FOLLOWUPS_DRAFT: 'agent:followups:draft',
  /**
   * Allows the agent to create approval-request documents.
   * Approval requests are NEVER auto-executed — they require explicit user
   * action before any external side-effect is triggered.
   */
  APPROVALS_CREATE: 'agent:approvals:create',
} as const;

/** Union of all valid scope string literals. */
export type AgentScope = (typeof AGENT_SCOPES)[keyof typeof AGENT_SCOPES];
