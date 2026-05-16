/**
 * audit.ts — Handler for GET /audit-events.
 *
 * SECURITY INVARIANTS:
 * - userId is NEVER read from the request body or query parameters.
 *   It is always sourced from the verified AuthContext produced by withAuth().
 * - Audit events are scoped to the authenticated user's userId + orgId,
 *   so cross-tenant events are never exposed.
 * - This endpoint is read-only. There are no mutation operations on audit events.
 * - Raw audit snapshots (before/after) may contain field names but must never
 *   contain secrets — sanitisation is enforced at write time by auditRepo callers.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuthContext } from '../auth/types';
import { withAuth } from '../middleware/withAuth';
import { getDb } from '../db/connection';
import { findAuditEvents } from '../db/repositories/auditRepo';
import { successResponse, getQueryParam } from '../utils/response';
import { handleError } from '../utils/errors';
import { AuditEventDoc, ActorType, toId } from '../models/types';

// ---------------------------------------------------------------------------
// DTO mapper — deliberately omits internal _id ObjectId; uses string `id`.
// ---------------------------------------------------------------------------

function toAuditDTO(doc: AuditEventDoc) {
  return {
    id: toId(doc),
    actor: doc.actor,
    actorId: doc.actorId,
    action: doc.action,
    entityType: doc.entityType,
    entityId: doc.entityId,
    // before/after snapshots are included for transparency but must not
    // contain secrets — enforcement is at insert time.
    before: doc.before,
    after: doc.after,
    createdAt: doc.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /audit-events
// ---------------------------------------------------------------------------

export const list = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const db = await getDb();

      const entityType = getQueryParam(event, 'entityType');
      const entityId = getQueryParam(event, 'entityId');
      const actorParam = getQueryParam(event, 'actor') as ActorType | undefined;
      const limitStr = getQueryParam(event, 'limit');
      const skipStr = getQueryParam(event, 'skip');

      const events = await findAuditEvents(db, auth, {
        entityType,
        entityId,
        actor: actorParam,
        limit: limitStr ? Math.min(parseInt(limitStr, 10), 200) : 50,
        skip: skipStr ? parseInt(skipStr, 10) : 0,
      });

      return successResponse({ auditEvents: events.map(toAuditDTO) });
    } catch (err) {
      return handleError(err);
    }
  },
);
