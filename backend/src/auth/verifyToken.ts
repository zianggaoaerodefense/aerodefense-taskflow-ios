import jwt from 'jsonwebtoken';
import { AgentAuthContext, UserAuthContext } from './types';

/**
 * Verifies a user JWT against JWT_SECRET and returns a typed UserAuthContext.
 *
 * SECURITY:
 * - The secret is read from the environment — never from the request or code.
 * - userId is extracted from the `sub` claim of the verified payload only.
 *   It is NEVER accepted from the request body.
 * - Throws a jwt.JsonWebTokenError / jwt.TokenExpiredError on failure, which
 *   the withAuth middleware converts to a 401 response.
 */
export function verifyUserToken(token: string): UserAuthContext {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  // jwt.verify throws if the token is invalid, expired, or tampered with.
  const payload = jwt.verify(token, secret) as jwt.JwtPayload;

  if (typeof payload.sub !== 'string' || !payload.sub) {
    throw new jwt.JsonWebTokenError('Token missing required sub claim');
  }
  if (typeof payload['orgId'] !== 'string' || !payload['orgId']) {
    throw new jwt.JsonWebTokenError('Token missing required orgId claim');
  }

  return {
    type: 'user',
    userId: payload.sub,
    orgId: payload['orgId'] as string,
    roles: Array.isArray(payload['roles']) ? (payload['roles'] as string[]) : [],
  };
}

/**
 * Verifies an agent JWT against AGENT_JWT_SECRET and returns a typed
 * AgentAuthContext. Agent tokens use a separate secret so that a leaked user
 * token cannot be used to call agent-only endpoints, and vice-versa.
 *
 * SECURITY:
 * - Uses a distinct secret (AGENT_JWT_SECRET) from the user secret.
 * - userId is extracted from the verified payload — NEVER from request data.
 * - scopes must be declared explicitly in the token; absent scopes are not
 *   granted implicitly.
 */
export function verifyAgentToken(token: string): AgentAuthContext {
  const secret = process.env.AGENT_JWT_SECRET;
  if (!secret) {
    throw new Error('AGENT_JWT_SECRET is not configured');
  }

  const payload = jwt.verify(token, secret) as jwt.JwtPayload;

  if (typeof payload['userId'] !== 'string' || !payload['userId']) {
    throw new jwt.JsonWebTokenError('Agent token missing required userId claim');
  }
  if (typeof payload['orgId'] !== 'string' || !payload['orgId']) {
    throw new jwt.JsonWebTokenError('Agent token missing required orgId claim');
  }
  if (typeof payload['agentId'] !== 'string' || !payload['agentId']) {
    throw new jwt.JsonWebTokenError('Agent token missing required agentId claim');
  }

  return {
    type: 'agent',
    userId: payload['userId'] as string,
    orgId: payload['orgId'] as string,
    agentId: payload['agentId'] as string,
    scopes: Array.isArray(payload['scopes']) ? (payload['scopes'] as string[]) : [],
  };
}

/**
 * Returns true if the agent auth context contains the requested scope.
 * Use requireScope() (from withAuth.ts) instead of this function when you
 * want to throw on a missing scope.
 */
export function hasScope(auth: AgentAuthContext, scope: string): boolean {
  return auth.scopes.includes(scope);
}
