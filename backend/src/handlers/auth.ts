import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { withAuth } from '../middleware/withAuth';
import { AuthContext } from '../auth/types';
import { successResponse } from '../utils/response';
import { handleError } from '../utils/errors';

/**
 * GET /me
 *
 * Returns the authenticated actor's identity as derived from the verified JWT.
 *
 * SECURITY:
 * - All fields in the response are sourced from the verified AuthContext, never
 *   from the request body, query string, or path parameters.
 * - userId and orgId are never accepted from client-supplied data.
 */
export const getMe = withAuth(
  async (
    _event: APIGatewayProxyEvent,
    auth: AuthContext,
  ): Promise<APIGatewayProxyResult> => {
    try {
      if (auth.type === 'user') {
        return successResponse({
          type: 'user',
          userId: auth.userId,
          orgId: auth.orgId,
          roles: auth.roles,
        });
      }

      // Agent token — expose only non-secret identity fields.
      return successResponse({
        type: 'agent',
        userId: auth.userId,
        orgId: auth.orgId,
        agentId: auth.agentId,
        scopes: auth.scopes,
      });
    } catch (err) {
      return handleError(err);
    }
  },
);
