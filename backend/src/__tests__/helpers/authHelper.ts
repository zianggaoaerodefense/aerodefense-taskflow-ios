/**
 * authHelper.ts — Factories for test JWT tokens and auth context fixtures.
 *
 * Sets JWT_SECRET and AGENT_JWT_SECRET before any module imports verifyToken
 * so the verifier picks up the test secrets automatically.
 *
 * SECURITY: These secrets are only used in tests and are never committed to
 * any production environment. They match no real signing key.
 */

import jwt from 'jsonwebtoken';
import { UserAuthContext, AgentAuthContext } from '../../auth/types';

// Must be set before verifyToken.ts is imported by any handler under test.
const USER_SECRET = 'test-user-secret-do-not-use-in-prod';
const AGENT_SECRET = 'test-agent-secret-do-not-use-in-prod';
process.env.JWT_SECRET = USER_SECRET;
process.env.AGENT_JWT_SECRET = AGENT_SECRET;

// ---------------------------------------------------------------------------
// Token factories
// ---------------------------------------------------------------------------

export function makeUserToken(overrides?: {
  sub?: string;
  orgId?: string;
  roles?: string[];
}): string {
  return jwt.sign(
    {
      sub: overrides?.sub ?? 'user-001',
      orgId: overrides?.orgId ?? 'org-001',
      roles: overrides?.roles ?? ['user'],
    },
    USER_SECRET,
    { expiresIn: '1h' },
  );
}

export function makeAgentToken(overrides?: {
  userId?: string;
  orgId?: string;
  agentId?: string;
  scopes?: string[];
}): string {
  return jwt.sign(
    {
      userId: overrides?.userId ?? 'user-001',
      orgId: overrides?.orgId ?? 'org-001',
      agentId: overrides?.agentId ?? 'agent-001',
      scopes: overrides?.scopes ?? [],
    },
    AGENT_SECRET,
    { expiresIn: '1h' },
  );
}

// ---------------------------------------------------------------------------
// Pre-built auth context fixtures (no JWT needed)
// ---------------------------------------------------------------------------

export const TEST_USER_AUTH: UserAuthContext = {
  type: 'user',
  userId: 'user-001',
  orgId: 'org-001',
  roles: ['user'],
};

/** A second user in the same org — used to verify cross-tenant isolation. */
export const TEST_OTHER_USER_AUTH: UserAuthContext = {
  type: 'user',
  userId: 'user-002',
  orgId: 'org-001',
  roles: ['user'],
};

/** An agent with every scope — use slice/override for narrower scope tests. */
export const TEST_AGENT_AUTH: AgentAuthContext = {
  type: 'agent',
  userId: 'user-001',
  orgId: 'org-001',
  agentId: 'agent-001',
  scopes: [
    'agent:summaries:create',
    'agent:tasks:read',
    'agent:tasks:suggest',
    'agent:followups:draft',
    'agent:approvals:create',
  ],
};
