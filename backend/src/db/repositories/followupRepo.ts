/**
 * followupRepo.ts — Repository for the `followUpDrafts` collection.
 *
 * SECURITY INVARIANTS:
 * - Every public function accepts an AuthContext and applies userId + orgId
 *   to every query filter. No query is issued by _id alone.
 * - userId and orgId are always sourced from the verified AuthContext, never
 *   from client-supplied request data.
 * - Ownership fields (userId, orgId, _id) are overwritten from auth context on
 *   insert and stripped from update payloads to prevent ownership transfer.
 * - taskId is validated by the caller before reaching this repository; the
 *   repository itself does not verify cross-collection foreign-key integrity,
 *   but the userFilter ensures only drafts owned by the authenticated user
 *   are accessible regardless of the taskId supplied.
 */

import { Db, ObjectId, Filter, UpdateFilter } from 'mongodb';
import { FollowUpDraftDoc, DraftStatus } from '../../models/types';
import { AuthContext } from '../../auth/types';

const COLLECTION = 'followUpDrafts';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a MongoDB filter that is always scoped to the authenticated user's
 * userId and orgId. Optional extra fields narrow the filter further.
 *
 * The cast through `unknown` is required because TypeScript cannot reconcile
 * the structural difference between `Partial<FollowUpDraftDoc>` and
 * `Filter<FollowUpDraftDoc>`. The userId/orgId equality check is always
 * present so cross-tenant access is not possible.
 */
function userFilter(
  auth: AuthContext,
  extra?: Partial<FollowUpDraftDoc>,
): Filter<FollowUpDraftDoc> {
  return {
    userId: auth.userId,
    orgId: auth.orgId,
    ...(extra as unknown as Filter<FollowUpDraftDoc>),
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
 * Fetches a single follow-up draft by its MongoDB _id, scoped to the
 * authenticated user. Returns null for non-existent or cross-user documents
 * alike — the two cases are deliberately indistinguishable to the caller.
 */
export async function findDraftById(
  db: Db,
  auth: AuthContext,
  id: string,
): Promise<FollowUpDraftDoc | null> {
  return db
    .collection<FollowUpDraftDoc>(COLLECTION)
    .findOne(userFilter(auth, { _id: toObjectId(id) } as Partial<FollowUpDraftDoc>));
}

/**
 * Returns a paginated, optionally-filtered list of follow-up drafts for the
 * authenticated user. Results are sorted newest-first.
 *
 * When `taskId` is supplied only drafts linked to that task are returned;
 * the task itself is still required to be owned by the same user because
 * the userFilter always includes userId + orgId.
 */
export async function findDrafts(
  db: Db,
  auth: AuthContext,
  opts?: {
    taskId?: string;
    status?: DraftStatus;
    limit?: number;
    skip?: number;
  },
): Promise<FollowUpDraftDoc[]> {
  const extra: Partial<FollowUpDraftDoc> = {};
  if (opts?.taskId !== undefined) extra.taskId = opts.taskId;
  if (opts?.status !== undefined) extra.status = opts.status;

  return db
    .collection<FollowUpDraftDoc>(COLLECTION)
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
 * Inserts a new follow-up draft document, always stamping userId and orgId
 * from the verified auth context regardless of what the caller provided.
 */
export async function insertDraft(
  db: Db,
  auth: AuthContext,
  draft: Omit<FollowUpDraftDoc, '_id'>,
): Promise<FollowUpDraftDoc> {
  // Enforce auth context ownership regardless of what the caller passed in.
  const doc: Omit<FollowUpDraftDoc, '_id'> = {
    ...draft,
    userId: auth.userId,
    orgId: auth.orgId,
  };
  const result = await db
    .collection<FollowUpDraftDoc>(COLLECTION)
    .insertOne(doc as FollowUpDraftDoc);
  return { ...doc, _id: result.insertedId };
}

/**
 * Applies a partial update to a follow-up draft, scoped to the authenticated
 * user. Ownership fields (userId, orgId, _id) and taskId are stripped from
 * the updates to prevent accidental ownership or linkage transfer.
 *
 * Returns the updated document, or null when no matching document was found.
 */
export async function updateDraft(
  db: Db,
  auth: AuthContext,
  id: string,
  updates: Partial<FollowUpDraftDoc>,
): Promise<FollowUpDraftDoc | null> {
  // Strip ownership and immutable fields from the caller-supplied updates.
  const {
    userId: _u,
    orgId: _o,
    _id: _i,
    taskId: _t,
    ...safeUpdates
  } = updates as FollowUpDraftDoc;

  const update: UpdateFilter<FollowUpDraftDoc> = {
    $set: { ...safeUpdates, updatedAt: new Date() },
  };

  const result = await db
    .collection<FollowUpDraftDoc>(COLLECTION)
    .findOneAndUpdate(
      userFilter(auth, { _id: toObjectId(id) } as Partial<FollowUpDraftDoc>),
      update,
      { returnDocument: 'after' },
    );

  return result ?? null;
}

/**
 * Convenience wrapper that transitions a draft to a new status, optionally
 * stamping a lifecycle timestamp (e.g. reviewedAt, approvedAt) atomically.
 *
 * Valid status transitions should be enforced by the service layer before
 * calling this function; the repository does not validate state machine rules.
 */
export async function updateDraftStatus(
  db: Db,
  auth: AuthContext,
  id: string,
  status: DraftStatus,
  extraFields?: Partial<FollowUpDraftDoc>,
): Promise<FollowUpDraftDoc | null> {
  return updateDraft(db, auth, id, { status, ...extraFields });
}
