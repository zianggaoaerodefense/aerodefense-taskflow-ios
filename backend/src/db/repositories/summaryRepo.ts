/**
 * summaryRepo.ts — Repository for the `summaries` collection.
 *
 * SECURITY INVARIANTS:
 * - Every public function accepts an AuthContext and applies userId + orgId
 *   to every query filter. No query is issued by _id alone.
 * - userId and orgId are always sourced from the verified AuthContext, never
 *   from client-supplied request data.
 * - Ownership fields (userId, orgId) are overwritten from auth context on
 *   insert, so client-supplied values cannot affect tenant isolation.
 */

import { Db, ObjectId, Filter, UpdateFilter } from 'mongodb';
import { SummaryDoc, SourceType } from '../../models/types';
import { AuthContext } from '../../auth/types';

const COLLECTION = 'summaries';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function userFilter(
  auth: AuthContext,
  extra?: Partial<SummaryDoc>,
): Filter<SummaryDoc> {
  return {
    userId: auth.userId,
    orgId: auth.orgId,
    ...(extra as unknown as Filter<SummaryDoc>),
  };
}

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
 * Fetches a single summary by its MongoDB _id, scoped to the authenticated
 * user. Returns null for non-existent or cross-user documents alike.
 */
export async function findSummaryById(
  db: Db,
  auth: AuthContext,
  id: string,
): Promise<SummaryDoc | null> {
  return db
    .collection<SummaryDoc>(COLLECTION)
    .findOne(userFilter(auth, { _id: toObjectId(id) } as Partial<SummaryDoc>));
}

/**
 * Returns a paginated list of summaries for the authenticated user.
 * Supports optional filtering by sourceType, reviewNeeded, and actionNeeded.
 * Results are sorted newest-first.
 */
export async function findSummaries(
  db: Db,
  auth: AuthContext,
  opts?: {
    sourceType?: SourceType;
    reviewNeeded?: boolean;
    actionNeeded?: boolean;
    includeArchived?: boolean;
    limit?: number;
    skip?: number;
  },
): Promise<SummaryDoc[]> {
  const extra: Partial<SummaryDoc> = {};
  if (opts?.sourceType !== undefined) extra.sourceType = opts.sourceType;
  if (opts?.reviewNeeded !== undefined) extra.reviewNeeded = opts.reviewNeeded;
  if (opts?.actionNeeded !== undefined) extra.actionNeeded = opts.actionNeeded;

  const filter = userFilter(auth, extra);

  // Exclude archived summaries by default.
  if (!opts?.includeArchived) {
    (filter as Record<string, unknown>)['archivedAt'] = { $exists: false };
  }

  return db
    .collection<SummaryDoc>(COLLECTION)
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(opts?.skip ?? 0)
    .limit(opts?.limit ?? 100)
    .toArray();
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Inserts a new summary document, always stamping userId and orgId from the
 * verified auth context regardless of what the caller provided.
 */
export async function insertSummary(
  db: Db,
  auth: AuthContext,
  summary: Omit<SummaryDoc, '_id'>,
): Promise<SummaryDoc> {
  const doc: Omit<SummaryDoc, '_id'> = {
    ...summary,
    userId: auth.userId,
    orgId: auth.orgId,
  };
  const result = await db
    .collection<SummaryDoc>(COLLECTION)
    .insertOne(doc as SummaryDoc);
  return { ...doc, _id: result.insertedId };
}

/**
 * Applies a partial update to a summary, scoped to the authenticated user.
 * Ownership fields (userId, orgId, _id) are stripped from `updates` to
 * prevent accidental or malicious ownership transfer.
 *
 * Returns the updated document, or null when no matching document was found.
 */
export async function updateSummary(
  db: Db,
  auth: AuthContext,
  id: string,
  updates: Partial<SummaryDoc>,
): Promise<SummaryDoc | null> {
  const { userId: _u, orgId: _o, _id: _i, ...safeUpdates } = updates as SummaryDoc;

  const update: UpdateFilter<SummaryDoc> = {
    $set: { ...safeUpdates, updatedAt: new Date() },
  };

  const result = await db
    .collection<SummaryDoc>(COLLECTION)
    .findOneAndUpdate(
      userFilter(auth, { _id: toObjectId(id) } as Partial<SummaryDoc>),
      update,
      { returnDocument: 'after' },
    );

  return result ?? null;
}

/**
 * Appends task candidate IDs to the summary's `taskCandidateIds` array,
 * deduplicating against existing entries via $addToSet.
 * Scoped to the authenticated user.
 */
export async function addTaskCandidates(
  db: Db,
  auth: AuthContext,
  id: string,
  candidateIds: string[],
): Promise<SummaryDoc | null> {
  if (candidateIds.length === 0) return findSummaryById(db, auth, id);

  const update: UpdateFilter<SummaryDoc> = {
    $addToSet: { taskCandidateIds: { $each: candidateIds } },
    $set: { updatedAt: new Date() },
  };

  const result = await db
    .collection<SummaryDoc>(COLLECTION)
    .findOneAndUpdate(
      userFilter(auth, { _id: toObjectId(id) } as Partial<SummaryDoc>),
      update,
      { returnDocument: 'after' },
    );

  return result ?? null;
}

/**
 * Appends a single confirmed task ID to the summary's `linkedTaskIds` array,
 * deduplicating via $addToSet.
 * Scoped to the authenticated user.
 */
export async function addLinkedTask(
  db: Db,
  auth: AuthContext,
  summaryId: string,
  taskId: string,
): Promise<SummaryDoc | null> {
  const update: UpdateFilter<SummaryDoc> = {
    $addToSet: { linkedTaskIds: taskId },
    $set: { updatedAt: new Date() },
  };

  const result = await db
    .collection<SummaryDoc>(COLLECTION)
    .findOneAndUpdate(
      userFilter(auth, { _id: toObjectId(summaryId) } as Partial<SummaryDoc>),
      update,
      { returnDocument: 'after' },
    );

  return result ?? null;
}

/**
 * Soft-deletes a summary by stamping `archivedAt`. The document remains in
 * the collection for audit purposes but is excluded from default queries.
 * Scoped to the authenticated user.
 */
export async function archiveSummary(
  db: Db,
  auth: AuthContext,
  id: string,
): Promise<SummaryDoc | null> {
  const now = new Date();
  const update: UpdateFilter<SummaryDoc> = {
    $set: { archivedAt: now, updatedAt: now },
  };

  const result = await db
    .collection<SummaryDoc>(COLLECTION)
    .findOneAndUpdate(
      userFilter(auth, { _id: toObjectId(id) } as Partial<SummaryDoc>),
      update,
      { returnDocument: 'after' },
    );

  return result ?? null;
}
