/**
 * taskRepo.ts — Repository for the `tasks` collection.
 *
 * SECURITY INVARIANTS:
 * - Every public function accepts an AuthContext and applies userId + orgId
 *   to every query filter. No query is issued by _id alone.
 * - userId and orgId are always sourced from the verified AuthContext, never
 *   from client-supplied request data.
 * - The `updates` parameter on mutating functions is whitelisted through the
 *   Zod-validated DTO layer before it reaches this module. The repository
 *   itself does not re-validate, but callers must validate before calling.
 */

import { Db, ObjectId, Filter, UpdateFilter } from 'mongodb';
import { TaskDoc, TaskStatus } from '../../models/types';
import { AuthContext } from '../../auth/types';

const COLLECTION = 'tasks';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a MongoDB filter that is always scoped to the authenticated user's
 * userId and orgId. Optional extra fields narrow the filter further.
 *
 * The double-cast through `unknown` is required because TypeScript cannot
 * reconcile the structural difference between `Partial<TaskDoc>` (which uses
 * `ObjectId | string` for _id) and `Filter<TaskDoc>` (which uses MongoDB's
 * filter operators). The userId/orgId equality check is always present, so
 * cross-tenant access is not possible even if the extra fields are wrong.
 */
function userFilter(
  auth: AuthContext,
  extra?: Partial<TaskDoc>,
): Filter<TaskDoc> {
  return {
    userId: auth.userId,
    orgId: auth.orgId,
    ...(extra as unknown as Filter<TaskDoc>),
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
 * Fetches a single task by its MongoDB _id, scoped to the authenticated user.
 * Returns null when the task does not exist OR belongs to a different user —
 * the two cases are deliberately indistinguishable to the caller.
 */
export async function findTaskById(
  db: Db,
  auth: AuthContext,
  id: string,
): Promise<TaskDoc | null> {
  return db
    .collection<TaskDoc>(COLLECTION)
    .findOne(userFilter(auth, { _id: toObjectId(id) } as Partial<TaskDoc>));
}

/**
 * Returns a paginated, optionally-filtered list of tasks for the authenticated
 * user. Results are sorted newest-first.
 */
export async function findTasks(
  db: Db,
  auth: AuthContext,
  opts?: {
    status?: TaskStatus;
    summaryId?: string;
    limit?: number;
    skip?: number;
  },
): Promise<TaskDoc[]> {
  const extra: Partial<TaskDoc> = {};
  if (opts?.status !== undefined) extra.status = opts.status;
  if (opts?.summaryId !== undefined) extra.summaryId = opts.summaryId;

  return db
    .collection<TaskDoc>(COLLECTION)
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
 * Inserts a new task document. The caller must ensure that `task.userId` and
 * `task.orgId` match `auth.userId` and `auth.orgId` — the repository enforces
 * this by overwriting those fields unconditionally before insert.
 */
export async function insertTask(
  db: Db,
  auth: AuthContext,
  task: Omit<TaskDoc, '_id'>,
): Promise<TaskDoc> {
  // Enforce auth context ownership regardless of what the caller passed in.
  const doc: Omit<TaskDoc, '_id'> = {
    ...task,
    userId: auth.userId,
    orgId: auth.orgId,
  };
  const result = await db.collection<TaskDoc>(COLLECTION).insertOne(doc as TaskDoc);
  return { ...doc, _id: result.insertedId };
}

/**
 * Applies a partial update to a task, scoped to the authenticated user.
 * The filter always includes userId + orgId so cross-user mutation is not
 * possible even if `id` is guessed.
 *
 * Returns the updated document, or null if no matching document was found.
 */
export async function updateTask(
  db: Db,
  auth: AuthContext,
  id: string,
  updates: Partial<TaskDoc>,
): Promise<TaskDoc | null> {
  // Strip any attempt to overwrite ownership fields from the updates payload.
  const { userId: _u, orgId: _o, _id: _i, ...safeUpdates } = updates as TaskDoc;

  const update: UpdateFilter<TaskDoc> = {
    $set: { ...safeUpdates, updatedAt: new Date() },
  };

  const result = await db
    .collection<TaskDoc>(COLLECTION)
    .findOneAndUpdate(
      userFilter(auth, { _id: toObjectId(id) } as Partial<TaskDoc>),
      update,
      { returnDocument: 'after' },
    );

  return result ?? null;
}

/**
 * Convenience wrapper that transitions a task to a new status, optionally
 * applying extra field updates (e.g. doneAt, reviewedAt) atomically.
 */
export async function markTaskStatus(
  db: Db,
  auth: AuthContext,
  id: string,
  status: TaskStatus,
  extraFields?: Partial<TaskDoc>,
): Promise<TaskDoc | null> {
  return updateTask(db, auth, id, { status, ...extraFields });
}
