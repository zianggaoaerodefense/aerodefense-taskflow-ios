/**
 * approvalRepo.ts — Repository for the `approvalRequests` collection.
 *
 * SECURITY INVARIANTS:
 * - Every public function accepts an AuthContext and applies userId + orgId
 *   to every query filter. No query is issued by _id alone.
 * - userId and orgId are always sourced from the verified AuthContext, never
 *   from client-supplied request data.
 * - Ownership fields (userId, orgId, _id) are overwritten from auth context on
 *   insert and stripped from status-update payloads to prevent ownership
 *   transfer.
 * - Approval requests are NEVER auto-executed by this repository. Execution
 *   is a separate concern handled by the approval service layer, which must
 *   verify explicit user action before triggering any external side-effect.
 * - The `payload` field is stored opaquely and must be validated before use
 *   at execution time. It must not contain credentials or tokens.
 */

import { Db, ObjectId, Filter, UpdateFilter } from 'mongodb';
import { ApprovalRequestDoc, ApprovalStatus } from '../../models/types';
import { AuthContext } from '../../auth/types';

const COLLECTION = 'approvalRequests';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a MongoDB filter that is always scoped to the authenticated user's
 * userId and orgId. Optional extra fields narrow the filter further.
 */
function userFilter(
  auth: AuthContext,
  extra?: Partial<ApprovalRequestDoc>,
): Filter<ApprovalRequestDoc> {
  return {
    userId: auth.userId,
    orgId: auth.orgId,
    ...(extra as unknown as Filter<ApprovalRequestDoc>),
  };
}

/**
 * Parses a string id into an ObjectId. Throws a descriptive error rather than
 * letting MongoDB throw a cryptic BSONTypeError so callers can return HTTP 400.
 */
function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new Error(`Invalid document id: ${id}`);
  }
  return new ObjectId(id);
}

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Fetches a single approval request by its MongoDB _id, scoped to the
 * authenticated user. Returns null for non-existent or cross-user documents
 * alike — the two cases are deliberately indistinguishable to the caller.
 */
export async function findApprovalById(
  db: Db,
  auth: AuthContext,
  id: string,
): Promise<ApprovalRequestDoc | null> {
  return db
    .collection<ApprovalRequestDoc>(COLLECTION)
    .findOne(userFilter(auth, { _id: toObjectId(id) } as Partial<ApprovalRequestDoc>));
}

/**
 * Returns a paginated, optionally-filtered list of approval requests for the
 * authenticated user. Results are sorted newest-first.
 *
 * When `status` is supplied only requests matching that status are returned.
 * Callers typically filter by 'pending' to surface actionable approvals.
 */
export async function findApprovals(
  db: Db,
  auth: AuthContext,
  opts?: {
    status?: ApprovalStatus;
    taskId?: string;
    draftId?: string;
    limit?: number;
    skip?: number;
  },
): Promise<ApprovalRequestDoc[]> {
  const extra: Partial<ApprovalRequestDoc> = {};
  if (opts?.status !== undefined) extra.status = opts.status;
  if (opts?.taskId !== undefined) extra.taskId = opts.taskId;
  if (opts?.draftId !== undefined) extra.draftId = opts.draftId;

  return db
    .collection<ApprovalRequestDoc>(COLLECTION)
    .find(userFilter(auth, extra))
    .sort({ createdAt: -1 })
    .skip(opts?.skip ?? 0)
    .limit(opts?.limit ?? 100)
    .toArray();
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Inserts a new approval request document, always stamping userId and orgId
 * from the verified auth context regardless of what the caller provided.
 * Initial status is always 'pending' — callers cannot create pre-approved
 * requests through this function.
 */
export async function insertApproval(
  db: Db,
  auth: AuthContext,
  approval: Omit<ApprovalRequestDoc, '_id'>,
): Promise<ApprovalRequestDoc> {
  // Enforce auth context ownership and lock initial status to 'pending'.
  const doc: Omit<ApprovalRequestDoc, '_id'> = {
    ...approval,
    userId: auth.userId,
    orgId: auth.orgId,
    status: 'pending',
  };
  const result = await db
    .collection<ApprovalRequestDoc>(COLLECTION)
    .insertOne(doc as ApprovalRequestDoc);
  return { ...doc, _id: result.insertedId };
}

/**
 * Transitions an approval request to a new status, stamping the appropriate
 * lifecycle timestamp atomically. Scoped to the authenticated user.
 *
 * The `extraFields` parameter is intended for lifecycle timestamps only
 * (approvedAt, rejectedAt, executedAt). Ownership fields in `extraFields`
 * are silently stripped.
 *
 * Returns the updated document, or null when no matching document was found.
 *
 * NOTE: This function intentionally does NOT trigger any external side-effects.
 * Execution logic (sending email, posting to Slack, etc.) must be handled
 * by the approval service layer after calling this function.
 */
export async function updateApprovalStatus(
  db: Db,
  auth: AuthContext,
  id: string,
  status: ApprovalStatus,
  extraFields?: Partial<ApprovalRequestDoc>,
): Promise<ApprovalRequestDoc | null> {
  // Strip ownership and immutable fields from any caller-supplied extras.
  const {
    userId: _u,
    orgId: _o,
    _id: _i,
    status: _s,
    payload: _p,
    createdBy: _c,
    ...safeExtras
  } = (extraFields ?? {}) as ApprovalRequestDoc;

  const update: UpdateFilter<ApprovalRequestDoc> = {
    $set: { ...safeExtras, status, updatedAt: new Date() },
  };

  const result = await db
    .collection<ApprovalRequestDoc>(COLLECTION)
    .findOneAndUpdate(
      userFilter(auth, { _id: toObjectId(id) } as Partial<ApprovalRequestDoc>),
      update,
      { returnDocument: 'after' },
    );

  return result ?? null;
}
