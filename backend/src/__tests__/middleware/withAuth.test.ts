/**
 * withAuth.test.ts — Unit tests for the withAuth middleware and requireScope helper.
 *
 * What these tests prove:
 * - Valid user JWT → handler is called with a well-formed UserAuthContext.
 * - Valid agent JWT → handler is called with a well-formed AgentAuthContext.
 * - Missing Authorization header → 401 (handler never called).
 * - Token signed with wrong secret → 401.
 * - Expired token → 401.
 * - requireScope throws AuthError for wrong token type or missing scope.
 *
 * No database is needed — all assertions are on the auth context shape and
 * HTTP status codes.
 */

import jwt from 'jsonwebtoken';
import { withAuth, requireScope, AuthError } from '../../middleware/withAuth';
import { makeUserToken, makeAgentToken } from '../helpers/authHelper';
import { AGENT_SCOPES } from '../../auth/types';

// authHelper.ts sets JWT_SECRET and AGENT_JWT_SECRET in module scope —
// importing it here ensures those env vars are set before withAuth runs.

const mockHandler = jest.fn().mockResolvedValue({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});

beforeEach(() => { mockHandler.mockClear(); });

// ---------------------------------------------------------------------------
// withAuth — token verification
// ---------------------------------------------------------------------------

describe('withAuth', () => {
  it('calls the handler with a UserAuthContext for a valid user token', async () => {
    const handler = withAuth(mockHandler);
    const event = { headers: { Authorization: `Bearer ${makeUserToken()}` } };

    const res = await handler(event as any);

    expect(res.statusCode).toBe(200);
    expect(mockHandler).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        type: 'user',
        userId: 'user-001',
        orgId: 'org-001',
      }),
    );
  });

  it('calls the handler with an AgentAuthContext for a valid agent token', async () => {
    const handler = withAuth(mockHandler);
    const token = makeAgentToken({ scopes: [AGENT_SCOPES.TASKS_READ] });
    const event = { headers: { Authorization: `Bearer ${token}` } };

    await handler(event as any);

    expect(mockHandler).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        type: 'agent',
        userId: 'user-001',
        agentId: 'agent-001',
        scopes: [AGENT_SCOPES.TASKS_READ],
      }),
    );
  });

  it('returns 401 and does not call handler when Authorization header is missing', async () => {
    const res = await withAuth(mockHandler)({ headers: {} } as any);
    expect(res.statusCode).toBe(401);
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('returns 401 and does not call handler when header does not start with Bearer', async () => {
    const res = await withAuth(mockHandler)({
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    } as any);
    expect(res.statusCode).toBe(401);
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const badToken = jwt.sign({ sub: 'user-001', orgId: 'org-001' }, 'completely-wrong-secret');
    const res = await withAuth(mockHandler)({
      headers: { Authorization: `Bearer ${badToken}` },
    } as any);
    expect(res.statusCode).toBe(401);
    expect(mockHandler).not.toHaveBeenCalled();
  });

  it('returns 401 for an expired token', async () => {
    const expired = jwt.sign(
      { sub: 'user-001', orgId: 'org-001' },
      'test-user-secret-do-not-use-in-prod',
      { expiresIn: '-10s' },
    );
    const res = await withAuth(mockHandler)({
      headers: { Authorization: `Bearer ${expired}` },
    } as any);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a completely malformed token string', async () => {
    const res = await withAuth(mockHandler)({
      headers: { Authorization: 'Bearer not.a.jwt' },
    } as any);
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// requireScope — policy enforcement
// ---------------------------------------------------------------------------

describe('requireScope', () => {
  it('does not throw when agent has the required scope', () => {
    const agentAuth = {
      type: 'agent' as const,
      userId: 'u1',
      orgId: 'o1',
      agentId: 'a1',
      scopes: [AGENT_SCOPES.TASKS_READ],
    };
    expect(() => requireScope(agentAuth, AGENT_SCOPES.TASKS_READ)).not.toThrow();
  });

  it('throws AuthError when agent is missing the required scope', () => {
    const agentAuth = {
      type: 'agent' as const,
      userId: 'u1',
      orgId: 'o1',
      agentId: 'a1',
      scopes: [],
    };
    expect(() => requireScope(agentAuth, AGENT_SCOPES.TASKS_READ)).toThrow(AuthError);
  });

  it('throws AuthError when called with a user token (not an agent)', () => {
    const userAuth = {
      type: 'user' as const,
      userId: 'u1',
      orgId: 'o1',
      roles: [],
    };
    expect(() => requireScope(userAuth as any, AGENT_SCOPES.TASKS_READ)).toThrow(AuthError);
  });
});
