import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuthContext, AgentAuthContext } from '../auth/types';
import { verifyUserToken, verifyAgentToken } from '../auth/verifyToken';
import { errorResponse } from '../utils/response';

/**
 * Signature for a Lambda handler that has already been authenticated.
 * The `auth` parameter is a verified, typed context — never derived from the
 * request body.
 */
export type AuthenticatedHandler = (
  event: APIGatewayProxyEvent,
  auth: AuthContext,
) => Promise<APIGatewayProxyResult>;

/**
 * Wraps an AuthenticatedHandler with Bearer-token verification.
 *
 * Resolution order:
 *   1. Extract the Bearer token from the Authorization header.
 *   2. Try to verify as a user token (JWT_SECRET).
 *   3. If that fails, try to verify as an agent token (AGENT_JWT_SECRET).
 *   4. If both fail, return 401.
 *
 * SECURITY:
 * - userId is NEVER read from the request body, query string, or path params.
 *   It comes exclusively from the verified JWT payload.
 * - A token that is expired, tampered-with, or signed with the wrong secret
 *   always results in a 401 — the inner handler is never called.
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const authHeader =
      event.headers?.['Authorization'] ?? event.headers?.['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(401, 'Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);

    try {
      let auth: AuthContext;

      // Attempt user-token verification first; fall back to agent token.
      // Both paths throw jwt errors on failure — caught below.
      try {
        auth = verifyUserToken(token);
      } catch {
        auth = verifyAgentToken(token);
      }

      return await handler(event, auth);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'JsonWebTokenError' || name === 'TokenExpiredError') {
        return errorResponse(401, 'Invalid or expired token');
      }
      // Re-throw non-auth errors so the caller's error handler can deal with them.
      throw err;
    }
  };
}

/**
 * Asserts that the auth context is an agent token AND that the token carries
 * the specified scope. Throws AuthError (403) if either check fails.
 *
 * Call this at the top of every agent-only handler before accessing any data.
 *
 * Example:
 *   requireScope(auth, AGENT_SCOPES.FOLLOWUPS_DRAFT);
 */
export function requireScope(auth: AuthContext, scope: string): asserts auth is AgentAuthContext {
  if (auth.type !== 'agent') {
    throw new AuthError('Agent token required for this endpoint');
  }
  if (!auth.scopes.includes(scope)) {
    throw new AuthError(`Missing required scope: ${scope}`);
  }
}

/**
 * Asserts that the auth context is a human user token.
 * Use this on endpoints that must NOT be callable by agents.
 */
export function requireUser(auth: AuthContext): asserts auth is import('../auth/types').UserAuthContext {
  if (auth.type !== 'user') {
    throw new AuthError('User token required for this endpoint');
  }
}

/**
 * Thrown when an auth policy check fails (wrong token type, missing scope).
 * handleError() converts this to a 403 response.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
