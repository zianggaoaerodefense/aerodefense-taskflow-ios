/**
 * taskRepo.test.ts — Unit tests for the task repository.
 *
 * What these tests prove:
 * - `findTaskById` always includes userId + orgId in the MongoDB filter
 *   (a different user's _id never matches because userId is in the filter).
 * - `insertTask` overwrites userId/orgId from the AuthContext regardless of
 *   what the caller supplies — callers cannot inject a foreign userId.
 * - `updateTask` strips userId, orgId, and _id from the $set payload before
 *   the MongoDB update — ownership fields are immutable.
 * - `findTasks` passes the caller's userId/orgId to the collection filter.
 * - `markTaskStatus` includes the correct status and extra fields in the update.
 *
 * Approach: mock the MongoDB collection methods with Jest spies, then assert
 * on the arguments they were called with. This tests the filter-construction
 * logic (the critical security invariant) without requiring a running mongod.
 */

import { ObjectId } from 'mongodb';
import { TEST_USER_AUTH, TEST_OTHER_USER_AUTH } from '../helpers/authHelper';
import {
  insertTask,
  findTaskById,
  findTasks,
  updateTask,
  markTaskStatus,
} from '../../db/repositories/taskRepo';
import { TaskDoc } from '../../models/types';

// ---------------------------------------------------------------------------
// Minimal mock MongoDB Db
// ---------------------------------------------------------------------------

const mockFindOne = jest.fn();
const mockInsertOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockToArray = jest.fn();
const mockFind = jest.fn().mockReturnValue({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: mockToArray,
});

const mockCollection = jest.fn().mockReturnValue({
  findOne: mockFindOne,
  find: mockFind,
  insertOne: mockInsertOne,
  findOneAndUpdate: mockFindOneAndUpdate,
});

const mockDb = { collection: mockCollection } as any;

beforeEach(() => {
  jest.clearAllMocks();
  // Default return values — individual tests override as needed.
  mockFindOne.mockResolvedValue(null);
  mockInsertOne.mockResolvedValue({ insertedId: new ObjectId() });
  mockFindOneAndUpdate.mockResolvedValue(null);
  mockToArray.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeTask(overrides?: Partial<Omit<TaskDoc, '_id'>>): Omit<TaskDoc, '_id'> {
  const now = new Date();
  return {
    userId: TEST_USER_AUTH.userId,
    orgId: TEST_USER_AUTH.orgId,
    title: 'Test task',
    details: '',
    status: 'new',
    priority: 'normal',
    resourceType: 'other',
    notes: '',
    createdBy: 'user',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// findTaskById — filter assertions
// ---------------------------------------------------------------------------

describe('findTaskById', () => {
  it('includes userId and orgId in the findOne filter', async () => {
    const id = new ObjectId().toHexString();
    await findTaskById(mockDb, TEST_USER_AUTH, id);
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER_AUTH.userId,
        orgId: TEST_USER_AUTH.orgId,
      }),
    );
  });

  it('uses different userId values for different AuthContexts', async () => {
    const id = new ObjectId().toHexString();
    await findTaskById(mockDb, TEST_USER_AUTH, id);
    const filterA = mockFindOne.mock.calls[0][0];

    mockFindOne.mockClear();
    await findTaskById(mockDb, TEST_OTHER_USER_AUTH, id);
    const filterB = mockFindOne.mock.calls[0][0];

    // Filters differ because userId differs — cross-tenant isolation is enforced
    // by the always-present userId field in the filter.
    expect(filterA.userId).not.toBe(filterB.userId);
    expect(filterA.userId).toBe(TEST_USER_AUTH.userId);
    expect(filterB.userId).toBe(TEST_OTHER_USER_AUTH.userId);
  });

  it('throws for a malformed (non-ObjectId) id string', async () => {
    await expect(findTaskById(mockDb, TEST_USER_AUTH, 'not-an-objectid')).rejects.toThrow();
  });

  it('returns null when the collection returns null', async () => {
    mockFindOne.mockResolvedValue(null);
    const result = await findTaskById(mockDb, TEST_USER_AUTH, new ObjectId().toHexString());
    expect(result).toBeNull();
  });

  it('returns the document when the collection returns a match', async () => {
    const doc: TaskDoc = { ...makeTask(), _id: new ObjectId() } as TaskDoc;
    mockFindOne.mockResolvedValue(doc);
    const result = await findTaskById(mockDb, TEST_USER_AUTH, String(doc._id));
    expect(result).toEqual(doc);
  });
});

// ---------------------------------------------------------------------------
// findTasks — filter assertions
// ---------------------------------------------------------------------------

describe('findTasks', () => {
  it('scopes the find filter to the auth user', async () => {
    await findTasks(mockDb, TEST_USER_AUTH);
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_USER_AUTH.userId,
        orgId: TEST_USER_AUTH.orgId,
      }),
    );
  });

  it('adds status to the filter when provided', async () => {
    await findTasks(mockDb, TEST_USER_AUTH, { status: 'done' });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'done' }),
    );
  });
});

// ---------------------------------------------------------------------------
// insertTask — auth context enforcement
// ---------------------------------------------------------------------------

describe('insertTask', () => {
  it('overwrites userId with auth.userId even when caller supplies a different value', async () => {
    const id = new ObjectId();
    mockInsertOne.mockResolvedValue({ insertedId: id });

    await insertTask(mockDb, TEST_USER_AUTH, makeTask({ userId: 'attacker', orgId: 'evil-org' }));

    const [insertedDoc] = mockInsertOne.mock.calls[0];
    expect(insertedDoc.userId).toBe(TEST_USER_AUTH.userId);
    expect(insertedDoc.orgId).toBe(TEST_USER_AUTH.orgId);
  });

  it('returns a document with the insertedId from MongoDB', async () => {
    const id = new ObjectId();
    mockInsertOne.mockResolvedValue({ insertedId: id });
    const result = await insertTask(mockDb, TEST_USER_AUTH, makeTask());
    expect(String(result._id)).toBe(id.toHexString());
  });
});

// ---------------------------------------------------------------------------
// updateTask — ownership field stripping
// ---------------------------------------------------------------------------

describe('updateTask', () => {
  it('includes userId and orgId in the findOneAndUpdate filter', async () => {
    const id = new ObjectId();
    await updateTask(mockDb, TEST_USER_AUTH, id.toHexString(), { title: 'New title' });
    const [filter] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual(
      expect.objectContaining({
        userId: TEST_USER_AUTH.userId,
        orgId: TEST_USER_AUTH.orgId,
      }),
    );
  });

  it('strips userId, orgId, and _id from the $set payload', async () => {
    const id = new ObjectId();
    await updateTask(mockDb, TEST_USER_AUTH, id.toHexString(), {
      title: 'Updated',
      userId: 'evil-user',
      orgId: 'evil-org',
      _id: new ObjectId(),
    } as Partial<TaskDoc>);

    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set.userId).toBeUndefined();
    expect(update.$set.orgId).toBeUndefined();
    expect(update.$set._id).toBeUndefined();
    expect(update.$set.title).toBe('Updated');
  });
});

// ---------------------------------------------------------------------------
// markTaskStatus — status + extra fields
// ---------------------------------------------------------------------------

describe('markTaskStatus', () => {
  it('sets the new status in the $set payload', async () => {
    const id = new ObjectId();
    await markTaskStatus(mockDb, TEST_USER_AUTH, id.toHexString(), 'done');
    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe('done');
  });

  it('merges extra fields (doneAt, actualCompletionDate) into the $set payload', async () => {
    const id = new ObjectId();
    const now = new Date();
    await markTaskStatus(mockDb, TEST_USER_AUTH, id.toHexString(), 'done', {
      doneAt: now,
      actualCompletionDate: now,
    });
    const [, update] = mockFindOneAndUpdate.mock.calls[0];
    expect(update.$set.status).toBe('done');
    expect(update.$set.doneAt).toEqual(now);
    expect(update.$set.actualCompletionDate).toEqual(now);
  });

  it('always includes userId and orgId in the update filter', async () => {
    const id = new ObjectId();
    await markTaskStatus(mockDb, TEST_USER_AUTH, id.toHexString(), 'waiting');
    const [filter] = mockFindOneAndUpdate.mock.calls[0];
    expect(filter.userId).toBe(TEST_USER_AUTH.userId);
    expect(filter.orgId).toBe(TEST_USER_AUTH.orgId);
  });
});
