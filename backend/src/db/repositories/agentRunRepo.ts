/**
 * agentRunRepo.ts — Repository for the `agentRuns` collection.
 *
 * SECURITY INVARIANTS:
 * - Every public function accepts an AuthContext and applies userId + orgId
 *   to every query filter. No query is issued by _id alone.
 * - userId and orgId are always sourced from the verified AuthContext, never
 *   from client-supplied request data.
 * - Ownership fields (userId, orgId, _id) are overwritten from auth context on
 *   insert and stripped from update payloads to prevent ownership transfer.
 * - The `errorMessage` field must be sanitised by the caller — it must not
 *   contain secrets, credentials, or internal stack traces that could assist
 *   an attacker. A safe, generic message is preferred.
 */

import { Db, ObjectId, Filter, UpdateFilter } from 'mongodb';
import { AgentRunDoc, AgentRunStatus } from '../../models/types';
import { AuthContext } from '../../auth/types';

const COLLECTION = 'agentRuns';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a MongoDB filter that is always scoped to the authenticated user's
 * userId and orgId. Optional extra fields narrow the filter further.
 */
function userFilter(
  auth: AuthContext,
  extra?: Partial<AgentRunDoc>,
): Filter<AgentRunDoc> {
  return {
    userId: auth.userId,
    orgId: auth.orgId,
    ...(extra as unknown as Filter<AgentRunDoc>),
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
 * Fetches a single agent run by its MongoDB _id, scoped to the authenticated
 * user. Returns null for non-existent or cross-user documents alike — the two
 * cases are deliberately indistinguishable to the caller.
 */
export async function findAgentRunById(
  db: Db,
  auth: AuthContext,
  id: string,
): Promise<AgentRunDoc | null> {
  return db
    .collection<AgentRunDoc>(COLLECTION)
    .findOne(userFilter(auth, { _id: toObjectId(id) } as Partial<AgentRunDoc>));
}

/**
 * Returns a paginated list of agent runs for the authenticated user, sorted
 * newest-first. Supports optional filtering by status or runType.
 */
export async function findAgentRuns(
  db: Db,
  auth: AuthContext,
  opts?: {
    status?: AgentRunStatus;
    runType?: 'scheduled' | 'manual';
    limit?: number;
    skip?: number;
  },
): Promise<AgentRunDoc[]> {
  const extra: Partial<AgentRunDoc> = {};
  if (opts?.status !== undefined) extra.status = opts.status;
  if (opts?.runType !== undefined) extra.runType = opts.runType;

  return db
    .collection<AgentRunDoc>(COLLECTION)
    .find(userFilter(auth, extra))
    .sort({ createdAt: -1 })
    .skip(opts?.skip ?? 0)
    .limit(opts?.limit ?? 50)
    .toArray();
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/**
 * Inserts a new agent run document, always stamping userId and orgId from the
 * verified auth context regardless of what the caller provided. The initial
 * status is enforced as 'started' so callers cannot record a pre-completed run.
 */
export async function insertAgentRun(
  db: Db,
  auth: AuthContext,
  run: Omit<AgentRunDoc, '_id'>,
): Promise<AgentRunDoc> {
  // Enforce auth context ownership and lock initial status to 'started'.
  const doc: Omit<AgentRunDoc, '_id'> = {
    ...run,
    userId: auth.userId,
    orgId: auth.orgId,
    status: 'started',
  };
  const result = await db
    .collection<AgentRunDoc>(COLLECTION)
    .insertOne(doc as AgentRunDoc);
  return { ...doc, _id: result.insertedId };
}

/**
 * Applies a partial update to an agent run, scoped to the authenticated user.
 * Ownership fields (userId, orgId, _id) are stripped from the update payload
 * to prevent accidental ownership transfer.
 *
 * Intended for lifecycle transitions: moving status from 'started' to
 * 'completed' or 'failed', and recording summaryIds, taskIds, and completedAt.
 *
 * Returns the updated document, or null when no matching document was found.
 */
export async function updateAgentRun(
  db: Db,
  auth: AuthContext,
  id: string,
  updates: Partial<AgentRunDoc>,
): Promise<AgentRunDoc | null> {
  // Strip ownership and immutable fields from the caller-supplied updates.
  const { userId: _u, orgId: _o, _id: _i, ...safeUpdates } = updates as AgentRunDoc;

  const update: UpdateFilter<AgentRunDoc> = {
    $set: { ...safeUpdates, updatedAt: new Date() },
  };

  const result = await db
    .collection<AgentRunDoc>(COLLECTION)
    .findOneAndUpdate(
      userFilter(auth, { _id: toObjectId(id) } as Partial<AgentRunDoc>),
      update,
      { returnDocument: 'after' },
    );

  return result ?? null;
}

/**
 * Convenience wrapper that finalises an agent run by transitioning it to
 * 'completed' or 'failed', recording processed summary/task IDs and stamping
 * completedAt atomically.
 *
 * @param id          - The _id of the run document to finalise.
 * @param status      - Terminal status: 'completed' or 'failed'.
 * @param extraFields - Additional fields to set, e.g. summaryIds, taskIds,
 *                      completedAt, errorMessage (sanitised).
 */
export async function finaliseAgentRun(
  db: Db,
  auth: AuthContext,
  id: string,
  status: 'completed' | 'failed',
  extraFields?: Partial<AgentRunDoc>,
): Promise<AgentRunDoc | null> {
  return updateAgentRun(db, auth, id, {
    status,
    completedAt: new Date(),
    ...extraFields,
  });
}
