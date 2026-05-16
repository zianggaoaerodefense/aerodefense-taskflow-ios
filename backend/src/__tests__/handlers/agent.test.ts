/**
 * agent.test.ts — Handler-level tests for /agent/* endpoints.
 *
 * What these tests prove:
 * - Every agent endpoint enforces its required scope (403 without it).
 * - User tokens cannot call agent endpoints (403 — agents only).
 * - Approval requests created by the agent always have status='pending'
 *   and createdBy='agent' — the agent cannot pre-approve its own requests.
 * - submitRunResults with the correct scope calls the repo to insert summaries.
 * - Follow-up drafts created by the agent have createdBy='agent'.
 *
 * Repos are mocked so tests only cover scope-enforcement and handler
 * orchestration, not MongoDB query behavior.
 */

import { ObjectId } from 'mongodb';
import { makeUserToken, makeAgentToken } from '../helpers/authHelper';
import { makeAuthEvent } from '../helpers/eventHelper';
import { AGENT_SCOPES } from '../../auth/types';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('../../db/connection', () => ({ getDb: jest.fn().mockResolvedValue({}) }));

const mockInsertSummary = jest.fn();
const mockFindTasks = jest.fn();
jest.mock('../../db/repositories/summaryRepo', () => ({
  insertSummary: (...args: any[]) => mockInsertSummary(...args),
}));

const mockInsertTask = jest.fn();
jest.mock('../../db/repositories/taskRepo', () => ({
  insertTask: (...args: any[]) => mockInsertTask(...args),
  findTasks: (...args: any[]) => mockFindTasks(...args),
}));

const mockInsertDraft = jest.fn();
const mockFindDrafts = jest.fn();
jest.mock('../../db/repositories/followupRepo', () => ({
  insertDraft: (...args: any[]) => mockInsertDraft(...args),
  findDrafts: (...args: any[]) => mockFindDrafts(...args),
}));

const mockInsertApproval = jest.fn();
const mockFindApprovals = jest.fn();
jest.mock('../../db/repositories/approvalRepo', () => ({
  insertApproval: (...args: any[]) => mockInsertApproval(...args),
  findApprovals: (...args: any[]) => mockFindApprovals(...args),
}));

const mockInsertAgentRun = jest.fn();
const mockUpdateAgentRun = jest.fn();
jest.mock('../../db/repositories/agentRunRepo', () => ({
  insertAgentRun: (...args: any[]) => mockInsertAgentRun(...args),
  updateAgentRun: (...args: any[]) => mockUpdateAgentRun(...args),
}));

const mockInsertAuditEvent = jest.fn();
jest.mock('../../db/repositories/auditRepo', () => ({
  insertAuditEvent: (...args: any[]) => mockInsertAuditEvent(...args),
}));

import {
  submitRunResults,
  pendingReview,
  createFollowupDrafts,
  createApprovalRequests,
} from '../../handlers/agent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentEvent(scopes: string[], body?: unknown, extra?: object) {
  return makeAuthEvent(makeAgentToken({ scopes }), {
    httpMethod: 'POST',
    body: body ? JSON.stringify(body) : null,
    ...extra,
  });
}

const validRunBody = {
  runType: 'manual',
  sourcesChecked: ['gmail'],
  summaries: [
    {
      title: 'Q3 review',
      sourceType: 'email',
      rawText: 'Please follow up on the Q3 report.',
      structured: { risks: [], dependencies: [], sections: [] },
      tags: [],
      taskCandidates: [],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInsertAuditEvent.mockResolvedValue(undefined);
  mockInsertAgentRun.mockResolvedValue({ _id: new ObjectId(), status: 'started' });
  mockUpdateAgentRun.mockResolvedValue(undefined);
  mockInsertSummary.mockResolvedValue({
    _id: new ObjectId(),
    title: 'Q3 review',
    userId: 'user-001',
    orgId: 'org-001',
    sourceType: 'email',
  });
  mockInsertTask.mockResolvedValue({ _id: new ObjectId(), title: 'Task', userId: 'user-001' });
  mockInsertDraft.mockResolvedValue({
    _id: new ObjectId(),
    taskId: 'task-id',
    channelType: 'email',
    status: 'draft',
    createdBy: 'agent',
    createdAt: new Date(),
  });
  mockInsertApproval.mockResolvedValue({
    _id: new ObjectId(),
    actionType: 'send_email',
    status: 'pending',
    createdBy: 'agent',
    taskId: undefined,
    draftId: undefined,
    createdAt: new Date(),
  });
  mockFindTasks.mockResolvedValue([]);
  mockFindDrafts.mockResolvedValue([]);
  mockFindApprovals.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// POST /agent/run-results
// ---------------------------------------------------------------------------

describe('POST /agent/run-results', () => {
  it('returns 403 for a user token', async () => {
    const res = await submitRunResults(
      makeAuthEvent(makeUserToken(), { body: JSON.stringify(validRunBody) }) as any,
    );
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for agent without summaries:create scope', async () => {
    const res = await submitRunResults(agentEvent([], validRunBody) as any);
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for agent with a different scope', async () => {
    const res = await submitRunResults(
      agentEvent([AGENT_SCOPES.TASKS_READ], validRunBody) as any,
    );
    expect(res.statusCode).toBe(403);
  });

  it('returns 201 for agent with correct scope', async () => {
    const res = await submitRunResults(
      agentEvent([AGENT_SCOPES.SUMMARIES_CREATE], validRunBody) as any,
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.summariesCreated).toBe(1);
    expect(body.tasksCreated).toBe(0);
  });

  it('calls insertSummary for each summary in the payload', async () => {
    await submitRunResults(
      agentEvent([AGENT_SCOPES.SUMMARIES_CREATE], validRunBody) as any,
    );
    expect(mockInsertSummary).toHaveBeenCalledTimes(1);
    const [, auth] = mockInsertSummary.mock.calls[0];
    expect(auth.userId).toBe('user-001');
    expect(auth.orgId).toBe('org-001');
  });

  it('calls insertTask for each task candidate', async () => {
    const bodyWithCandidates = {
      ...validRunBody,
      summaries: [{
        ...validRunBody.summaries[0],
        taskCandidates: [
          { title: 'Follow up with finance', details: '', status: 'reviewNeeded', priority: 'high', resourceType: 'email' },
          { title: 'Send Q3 report', details: '', status: 'reviewNeeded', priority: 'normal', resourceType: 'email' },
        ],
      }],
    };
    await submitRunResults(
      agentEvent([AGENT_SCOPES.SUMMARIES_CREATE], bodyWithCandidates) as any,
    );
    expect(mockInsertTask).toHaveBeenCalledTimes(2);
    // createdBy must be 'agent'
    const [, , taskDoc] = mockInsertTask.mock.calls[0];
    expect(taskDoc.createdBy).toBe('agent');
  });
});

// ---------------------------------------------------------------------------
// GET /agent/pending-review
// ---------------------------------------------------------------------------

describe('GET /agent/pending-review', () => {
  it('returns 403 for a user token', async () => {
    const res = await pendingReview(makeAuthEvent(makeUserToken()) as any);
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for agent without tasks:read scope', async () => {
    const res = await pendingReview(agentEvent([]) as any);
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 for agent with tasks:read scope', async () => {
    const res = await pendingReview(agentEvent([AGENT_SCOPES.TASKS_READ]) as any);
    expect(res.statusCode).toBe(200);
  });

  it('filters tasks to reviewNeeded status', async () => {
    await pendingReview(agentEvent([AGENT_SCOPES.TASKS_READ]) as any);
    expect(mockFindTasks).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ status: 'reviewNeeded' }),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /agent/followup-drafts
// ---------------------------------------------------------------------------

describe('POST /agent/followup-drafts', () => {
  const validDraftBody = {
    taskId: '507f1f77bcf86cd799439011',
    channelType: 'email',
    body: 'Hi Alice, following up on the Q3 report.',
  };

  it('returns 403 without followups:draft scope', async () => {
    const res = await createFollowupDrafts(agentEvent([], validDraftBody) as any);
    expect(res.statusCode).toBe(403);
  });

  it('returns 201 with correct scope', async () => {
    const res = await createFollowupDrafts(
      agentEvent([AGENT_SCOPES.FOLLOWUPS_DRAFT], validDraftBody) as any,
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.followupDraft.status).toBe('draft');
  });

  it('calls insertDraft with createdBy=agent and status=draft', async () => {
    await createFollowupDrafts(
      agentEvent([AGENT_SCOPES.FOLLOWUPS_DRAFT], validDraftBody) as any,
    );
    const [, , draftDoc] = mockInsertDraft.mock.calls[0];
    expect(draftDoc.createdBy).toBe('agent');
    expect(draftDoc.status).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
// POST /agent/approval-requests
// ---------------------------------------------------------------------------

describe('POST /agent/approval-requests', () => {
  const validApprovalBody = {
    actionType: 'send_email',
    payload: { to: 'alice@example.com', subject: 'Follow-up' },
  };

  it('returns 403 without approvals:create scope', async () => {
    const res = await createApprovalRequests(agentEvent([], validApprovalBody) as any);
    expect(res.statusCode).toBe(403);
  });

  it('returns 201 with correct scope', async () => {
    const res = await createApprovalRequests(
      agentEvent([AGENT_SCOPES.APPROVALS_CREATE], validApprovalBody) as any,
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.approvalRequest.status).toBe('pending');
  });

  it('calls insertApproval with status=pending and createdBy=agent', async () => {
    await createApprovalRequests(
      agentEvent([AGENT_SCOPES.APPROVALS_CREATE], validApprovalBody) as any,
    );
    const [, , approvalDoc] = mockInsertApproval.mock.calls[0];
    // The repo is responsible for hardcoding 'pending', but the handler must
    // pass status='pending' — verify the handler's intent here.
    expect(approvalDoc.status).toBe('pending');
    expect(approvalDoc.createdBy).toBe('agent');
  });

  it('returns 400 for an invalid actionType', async () => {
    const res = await createApprovalRequests(
      agentEvent([AGENT_SCOPES.APPROVALS_CREATE], {
        actionType: 'launch_rockets',    // not in schema
        payload: {},
      }) as any,
    );
    expect(res.statusCode).toBe(400);
  });
});
