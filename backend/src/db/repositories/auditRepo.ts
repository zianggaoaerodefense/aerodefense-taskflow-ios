/**
 * auditRepo.ts — Repository for the `auditEvents` collection.
 *
 * SECURITY INVARIANTS:
 * - Audit events are append-only. There are no update or delete operations
 *   exposed by this repository.
 * - userId and orgId on every inserted event are sourced from the verified
 *   AuthContext, never from client-supplied request data.
 * - The `before` and `after` snapshot fields must be sanitised by the caller
 *   before being passed here — they must never contain secrets, tokens,
 *   passwords, or other sensitive material.
 * - Read operations are scoped to the authenticated user's userId + orgId
 *   so cross-tenant audit events are never exposed.
 * - The `actorId` field records the identity of the actor (userId or agentId)
 *   for non-repudiation purposes.
 * - Audit insert failures are caught and logged rather than re-thrown so that
 *   a failed audit write does not roll back the primary mutation (best-effort).
 */

import { Db, Filter } from 'mongodb';
import { AuditEventDoc } from '../../models/types';
import { AuthContext, ActorType } from '../../auth/types';

const COLLECTION = 'auditEvents';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a MongoDB filter that is always scoped to the authenticated user's
 * userId and orgId. Optional extra fields narrow the filter further.
 */
function userFilter(
  auth: AuthContext,
  extra?: Partial<AuditEventDoc>,
): Filter<AuditEventDoc> {
  return {
    userId: auth.userId,
    orgId: auth.orgId,
    ...(extra as unknown as Filter<AuditEventDoc>),
  };
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Inserts a single audit event, stamping userId and orgId unconditionally from
 * the verified AuthContext. Audit insert failures are caught and logged rather
 * than re-thrown so that a failed write does not roll back the primary mutation.
 *
 * The `before` and `after` snapshots MUST be sanitised by the caller — strip
 * any secrets, tokens, or sensitive PII before passing them here.
 *
 * @param params.actor      - Whether the action was taken by a user, agent, or
 *                            the system.
 * @param params.actorId    - The userId or agentId of the actor.
 * @param params.action     - Human-readable action label, e.g. 'task.status.updated'.
 * @param params.entityType - Collection/domain name, e.g. 'task', 'summary'.
 * @param params.entityId   - MongoDB _id (string) of the affected document.
 * @param params.before     - Optional sanitised pre-mutation snapshot.
 * @param params.after      - Optional sanitised post-mutation snapshot.
 */
export async function insertAuditEvent(
  db: Db,
  auth: AuthContext,
  params: {
    actor: ActorType;
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  },
): Promise<void> {
  const now = new Date();
  const doc: Omit<AuditEventDoc, '_id'> = {
    userId: auth.userId,
    orgId: auth.orgId,
    actor: params.actor,
    actorId: params.actorId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    before: params.before,
    after: params.after,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.collection<AuditEventDoc>(COLLECTION).insertOne(doc as AuditEventDoc);
  } catch (err) {
    // Audit failure is non-fatal — log sanitised message and continue.
    console.error('[auditRepo] Failed to insert audit event:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Returns a paginated list of audit events for the authenticated user,
 * optionally filtered by entityType, entityId, or actor type.
 * Results are sorted newest-first. Default limit is 200; maximum is 200.
 *
 * Audit events are immutable — no mutation operations are exposed.
 */
export async function findAuditEvents(
  db: Db,
  auth: AuthContext,
  opts?: {
    entityType?: string;
    entityId?: string;
    actor?: ActorType;
    limit?: number;
    skip?: number;
  },
): Promise<AuditEventDoc[]> {
  const extra: Partial<AuditEventDoc> = {};
  if (opts?.entityType !== undefined) extra.entityType = opts.entityType;
  if (opts?.entityId !== undefined) extra.entityId = opts.entityId;
  if (opts?.actor !== undefined) extra.actor = opts.actor;

  return db
    .collection<AuditEventDoc>(COLLECTION)
    .find(userFilter(auth, extra))
    .sort({ createdAt: -1 })
    .skip(opts?.skip ?? 0)
    .limit(Math.min(opts?.limit ?? 200, 200))
    .toArray();
}
