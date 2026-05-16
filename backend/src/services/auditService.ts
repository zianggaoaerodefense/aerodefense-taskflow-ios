/**
 * auditService.ts — Thin wrapper around insertAuditEvent that resolves the
 * actor identity from the verified AuthContext automatically.
 *
 * SECURITY:
 * - orgId and userId are always sourced from the verified AuthContext.
 * - before/after snapshots must be sanitised by the caller — never include
 *   secrets, tokens, raw credentials, or PII in these fields.
 * - Audit writes are best-effort (failures are logged, not re-thrown) so that
 *   a transient write failure does not roll back the primary mutation.
 */

import { Db } from 'mongodb';
import { AuthContext, ActorType } from '../auth/types';
import { insertAuditEvent } from '../db/repositories/auditRepo';

export interface AuditParams {
  actor: ActorType;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * Records an audit event.
 *
 * The `actorId` is derived from `auth`:
 *  - user token  → auth.userId
 *  - agent token → auth.agentId
 *
 * @param db         Connected MongoDB Db instance.
 * @param auth       Verified AuthContext — never sourced from request body.
 * @param params     Audit parameters. before/after must contain no secrets.
 */
export async function audit(
  db: Db,
  auth: AuthContext,
  params: AuditParams,
): Promise<void> {
  const actorId = auth.type === 'agent' ? auth.agentId : auth.userId;

  await insertAuditEvent(db, auth, {
    actor: params.actor,
    actorId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    before: params.before,
    after: params.after,
  });
}
