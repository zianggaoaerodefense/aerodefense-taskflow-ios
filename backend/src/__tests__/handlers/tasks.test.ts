/**
 * tasks.test.ts — Handler-level tests for /tasks endpoints.
 *
 * What these tests prove:
 * - POST /tasks creates a task with status forced to 'new' and emits a
 *   task.create audit event.
 * - POST /tasks/{id}/mark-done:
 *   - calls markTaskStatus with 'done', doneAt, and actualCompletionDate.
 *   - calls insertDraft to auto-create a follow-up draft when no
 *     followUpDraftId is present.
 *   - does NOT call insertDraft when followUpDraftId is already set.
 *   - emits task.markDone and followup.autoCreate audit events.
 *   - returns 404 when markTaskStatus returns null (task not found / wrong user).
 * - Zod validation rejects unknown/invalid priority values (400).
 * - Missing Authorization header → 401.
 *
 * Repos are mocked so tests verify handler orchestration logic only —
 * MongoDB query correctness is verified in taskRepo.test.ts.
 */

import { ObjectId } from 'mongodb';
import { makeUserToken, TEST_USER_AUTH } from '../helpers/authHelper';
import { makeAuthEvent } from '../helpers/eventHelper';
import { TaskDoc } from '../../models/types';

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before handler import
// ---------------------------------------------------------------------------

jest.mock('../../db/connection', () => ({ getDb: jest.fn().mockResolvedValue({}) }));

const mockInsertTask = jest.fn();
const mockFindTaskById = jest.fn();
const mockUpdateTask = jest.fn();
const mockFindTasks = jest.fn();
const mockMarkTaskStatus = jest.fn();
jest.mock('../../db/repositories/taskRepo', () => ({
  insertTask: (...args: any[]) => mockInsertTask(...args),
  findTaskById: (...args: any[]) => mockFindTaskById(...args),
  updateTask: (...args: any[]) => mockUpdateTask(...args),
  findTasks: (...args: any[]) => mockFindTasks(...args),
  markTaskStatus: (...args: any[]) => mockMarkTaskStatus(...args),
}));

const mockInsertDraft = jest.fn();
jest.mock('../../db/repositories/followupRepo', () => ({
  insertDraft: (...args: any[]) => mockInsertDraft(...args),
}));

const mockInsertAuditEvent = jest.fn();
jest.mock('../../db/repositories/auditRepo', () => ({
  insertAuditEvent: (...args: any[]) => mockInsertAuditEvent(...args),
}));

// Import handlers after mocks are in place.
import { create, get, markDone } from '../../handlers/tasks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const userToken = makeUserToken();

function makeTaskDoc(overrides?: Partial<TaskDoc>): TaskDoc {
  return {
    _id: new ObjectId(),
    userId: TEST_USER_AUTH.userId,
    orgId: TEST_USER_AUTH.orgId,
    title: 'Test task',
    details: 'Details',
    status: 'new',
    priority: 'normal',
    resourceType: 'email',
    notes: '',
    createdBy: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TaskDoc;
}

function makeDraftDoc(taskId: string) {
  return {
    _id: new ObjectId(),
    taskId,
    channelType: 'email',
    body: 'Follow-up body',
    status: 'draft',
    createdBy: 'system',
    userId: TEST_USER_AUTH.userId,
    orgId: TEST_USER_AUTH.orgId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInsertAuditEvent.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// POST /tasks (create)
// ---------------------------------------------------------------------------

describe('POST /tasks', () => {
  it('returns 201 and forces status to new regardless of body', async () => {
    const taskDoc = makeTaskDoc({ title: 'Created task', status: 'new' });
    mockInsertTask.mockResolvedValue(taskDoc);

    const event = makeAuthEvent(userToken, {
      httpMethod: 'POST',
      body: JSON.stringify({
        title: 'Created task',
        priority: 'high',
        resourceType: 'slack',
        status: 'done',  // must be ignored — always forced to 'new'
      }),
    });

    const res = await create(event as any);

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.task.title).toBe('Created task');
    // Verify that insertTask was called with status='new', not 'done'
    const [, , insertedDoc] = mockInsertTask.mock.calls[0];
    expect(insertedDoc.status).toBe('new');
  });

  it('calls insertAuditEvent with action=task.create', async () => {
    mockInsertTask.mockResolvedValue(makeTaskDoc());
    const event = makeAuthEvent(userToken, {
      httpMethod: 'POST',
      body: JSON.stringify({ title: 'Task', resourceType: 'email' }),
    });

    await create(event as any);

    expect(mockInsertAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: TEST_USER_AUTH.userId }),
      expect.objectContaining({ action: 'task.create', entityType: 'task' }),
    );
  });

  it('returns 400 for an invalid priority value', async () => {
    const event = makeAuthEvent(userToken, {
      httpMethod: 'POST',
      body: JSON.stringify({ title: 'Task', priority: 'SUPER_URGENT', resourceType: 'email' }),
    });
    const res = await create(event as any);
    expect(res.statusCode).toBe(400);
    expect(mockInsertTask).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is absent', async () => {
    const event = { headers: {}, body: JSON.stringify({ title: 'Task' }) };
    const res = await create(event as any);
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /tasks/{id}
// ---------------------------------------------------------------------------

describe('GET /tasks/{id}', () => {
  it('returns 200 and the task DTO when the task is found', async () => {
    const taskDoc = makeTaskDoc({ title: 'My task' });
    mockFindTaskById.mockResolvedValue(taskDoc);

    const event = makeAuthEvent(userToken, {
      pathParameters: { id: String(taskDoc._id) },
    });
    const res = await get(event as any);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.task.title).toBe('My task');
  });

  it('returns 404 when the repo returns null (task not found or wrong user)', async () => {
    mockFindTaskById.mockResolvedValue(null);
    const event = makeAuthEvent(userToken, {
      pathParameters: { id: new ObjectId().toHexString() },
    });
    const res = await get(event as any);
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /tasks/{id}/mark-done
// ---------------------------------------------------------------------------

describe('POST /tasks/{id}/mark-done', () => {
  it('returns 404 when markTaskStatus returns null (wrong user / not found)', async () => {
    mockMarkTaskStatus.mockResolvedValue(null);
    const event = makeAuthEvent(userToken, {
      pathParameters: { id: new ObjectId().toHexString() },
    });
    const res = await markDone(event as any);
    expect(res.statusCode).toBe(404);
  });

  it('calls markTaskStatus with status=done, doneAt, and actualCompletionDate', async () => {
    const taskDoc = makeTaskDoc({ status: 'done', doneAt: new Date(), actualCompletionDate: new Date() });
    mockMarkTaskStatus.mockResolvedValue(taskDoc);
    mockInsertDraft.mockResolvedValue(makeDraftDoc(String(taskDoc._id)));
    mockUpdateTask.mockResolvedValue({ ...taskDoc, followUpDraftId: 'draft-id' });

    const event = makeAuthEvent(userToken, {
      pathParameters: { id: String(taskDoc._id) },
    });
    await markDone(event as any);

    const [, , _id, status, extraFields] = mockMarkTaskStatus.mock.calls[0];
    expect(status).toBe('done');
    expect(extraFields).toHaveProperty('doneAt');
    expect(extraFields).toHaveProperty('actualCompletionDate');
  });

  it('auto-creates a follow-up draft when followUpDraftId is not set', async () => {
    const taskDoc = makeTaskDoc({ status: 'done', resourceType: 'email', requesterName: 'Alice' });
    mockMarkTaskStatus.mockResolvedValue(taskDoc);
    const draft = makeDraftDoc(String(taskDoc._id));
    mockInsertDraft.mockResolvedValue(draft);
    mockUpdateTask.mockResolvedValue({ ...taskDoc, followUpDraftId: String(draft._id) });

    const event = makeAuthEvent(userToken, {
      pathParameters: { id: String(taskDoc._id) },
    });
    await markDone(event as any);

    expect(mockInsertDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: TEST_USER_AUTH.userId }),
      expect.objectContaining({
        channelType: 'email',
        status: 'draft',
        createdBy: 'system',
      }),
    );
  });

  it('does NOT create a follow-up draft when followUpDraftId is already set', async () => {
    const taskDoc = makeTaskDoc({
      status: 'done',
      followUpDraftId: 'already-exists',
    });
    mockMarkTaskStatus.mockResolvedValue(taskDoc);

    const event = makeAuthEvent(userToken, {
      pathParameters: { id: String(taskDoc._id) },
    });
    await markDone(event as any);

    expect(mockInsertDraft).not.toHaveBeenCalled();
  });

  it('emits task.markDone audit event', async () => {
    const taskDoc = makeTaskDoc({ status: 'done' });
    mockMarkTaskStatus.mockResolvedValue(taskDoc);
    mockInsertDraft.mockResolvedValue(makeDraftDoc(String(taskDoc._id)));
    mockUpdateTask.mockResolvedValue(taskDoc);

    const event = makeAuthEvent(userToken, { pathParameters: { id: String(taskDoc._id) } });
    await markDone(event as any);

    const auditCalls = mockInsertAuditEvent.mock.calls.map((c: any[]) => c[2]);
    const markDoneAudit = auditCalls.find((c: any) => c.action === 'task.markDone');
    expect(markDoneAudit).toBeDefined();
    expect(markDoneAudit.after.status).toBe('done');
  });

  it('emits followup.autoCreate audit event when a draft is created', async () => {
    const taskDoc = makeTaskDoc({ status: 'done' });
    mockMarkTaskStatus.mockResolvedValue(taskDoc);
    mockInsertDraft.mockResolvedValue(makeDraftDoc(String(taskDoc._id)));
    mockUpdateTask.mockResolvedValue(taskDoc);

    const event = makeAuthEvent(userToken, { pathParameters: { id: String(taskDoc._id) } });
    await markDone(event as any);

    const auditCalls = mockInsertAuditEvent.mock.calls.map((c: any[]) => c[2]);
    const autoCreateAudit = auditCalls.find((c: any) => c.action === 'followup.autoCreate');
    expect(autoCreateAudit).toBeDefined();
    expect(autoCreateAudit.entityType).toBe('followUpDraft');
  });

  it('returns 200 and the task DTO on success', async () => {
    const taskDoc = makeTaskDoc({
      status: 'done',
      doneAt: new Date(),
      actualCompletionDate: new Date(),
    });
    mockMarkTaskStatus.mockResolvedValue(taskDoc);
    mockInsertDraft.mockResolvedValue(makeDraftDoc(String(taskDoc._id)));
    mockUpdateTask.mockResolvedValue({ ...taskDoc, followUpDraftId: 'draft-id' });

    const event = makeAuthEvent(userToken, { pathParameters: { id: String(taskDoc._id) } });
    const res = await markDone(event as any);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.task.status).toBe('done');
    expect(body.task.doneAt).toBeDefined();
    expect(body.task.actualCompletionDate).toBeDefined();
  });
});
