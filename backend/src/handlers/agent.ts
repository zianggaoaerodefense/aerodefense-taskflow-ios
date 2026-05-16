/**
 * agent.ts — Handlers for /agent/* endpoints.
 *
 * SECURITY INVARIANTS:
 * - ALL agent endpoints require a valid agent JWT (AGENT_JWT_SECRET), not a
 *   user JWT. requireScope() enforces this via withAuth + the agent token path.
 * - userId is NEVER accepted from the request body. It is always sourced from
 *   the verified AgentAuthContext (JWT payload `userId` claim).
 * - Every agent action that mutates data requires an explicit scope check.
 * - Approval requests created here are in 'pending' status — they are NEVER
 *   auto-executed. Execution requires separate CTO action.
 * - All external inputs are validated with Zod before use.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuthContext } from '../auth/types';
import { withAuth, requireScope } from '../middleware/withAuth';
import { AGENT_SCOPES } from '../auth/types';
import { getDb } from '../db/connection';
import { insertSummary } from '../db/repositories/summaryRepo';
import { findTasks, insertTask } from '../db/repositories/taskRepo';
import { findDrafts, insertDraft } from '../db/repositories/followupRepo';
import { findApprovals, insertApproval } from '../db/repositories/approvalRepo';
import { insertAgentRun, updateAgentRun } from '../db/repositories/agentRunRepo';
import { insertAuditEvent } from '../db/repositories/auditRepo';
import {
  AgentRunResultsSchema,
  AgentCreateFollowUpDraftSchema,
  AgentCreateApprovalRequestSchema,
} from '../schemas/validation';
import {
  successResponse,
  parseBody,
  getQueryParam,
} from '../utils/response';
import { handleError } from '../utils/errors';
import { toId } from '../models/types';

// ---------------------------------------------------------------------------
// POST /agent/run-results — scope: agent:summaries:create
//
// Agent submits the result of a scheduled or manual run.
// Creates summaries and task candidates, then marks the run completed.
// ---------------------------------------------------------------------------

export const submitRunResults = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      requireScope(auth, AGENT_SCOPES.SUMMARIES_CREATE);

      const body = parseBody<unknown>(event);
      const input = AgentRunResultsSchema.parse(body);
      const db = await getDb();
      const now = new Date();

      // 1. Create AgentRun record with status='started'.
      const run = await insertAgentRun(db, auth, {
        runType: input.runType,
        status: 'started',
        agentId: auth.agentId,  // always from verified token, never from body
        sourcesChecked: input.sourcesChecked,
        summaryIds: [],
        taskIds: [],
        userId: auth.userId,
        orgId: auth.orgId,
        createdAt: now,
        updatedAt: now,
      });
      const runId = toId(run);

      const summaryIds: string[] = [];
      const taskIds: string[] = [];

      // 2. For each summary in the payload: insert summary, then insert task candidates.
      for (const summaryPayload of input.summaries) {
        const summaryDoc = await insertSummary(db, auth, {
          title: summaryPayload.title,
          sourceType: summaryPayload.sourceType,
          sourceRefs: summaryPayload.sourceRefs,
          rawText: summaryPayload.rawText,
          structured: summaryPayload.structured,
          tags: summaryPayload.tags,
          suggestedPriority: summaryPayload.suggestedPriority,
          reviewNeeded: true,
          actionNeeded: false,
          taskCandidateIds: [],
          linkedTaskIds: [],
          userId: auth.userId,
          orgId: auth.orgId,
          createdAt: now,
          updatedAt: now,
        });
        const summaryId = toId(summaryDoc);
        summaryIds.push(summaryId);

        await insertAuditEvent(db, auth, {
          actor: 'agent',
          actorId: auth.agentId,
          action: 'summary.create',
          entityType: 'summary',
          entityId: summaryId,
          after: { title: summaryDoc.title, sourceType: summaryDoc.sourceType, runId },
        });

        // Insert task candidates as tasks with status from the candidate schema.
        for (const candidate of summaryPayload.taskCandidates) {
          const task = await insertTask(db, auth, {
            summaryId,
            title: candidate.title,
            details: candidate.details,
            status: candidate.status,
            priority: candidate.priority,
            requesterName: candidate.requesterName,
            requesterContact: candidate.requesterContact,
            resourceType: candidate.resourceType,
            resourceLabel: candidate.resourceLabel,
            resourceUrl: candidate.resourceUrl,
            targetCompletionDate: candidate.targetCompletionDate ? new Date(candidate.targetCompletionDate) : undefined,
            notes: '',
            createdBy: 'agent',
            userId: auth.userId,
            orgId: auth.orgId,
            createdAt: now,
            updatedAt: now,
          });
          const taskId = toId(task);
          taskIds.push(taskId);

          await insertAuditEvent(db, auth, {
            actor: 'agent',
            actorId: auth.agentId,
            action: 'task.create',
            entityType: 'task',
            entityId: taskId,
            after: { title: task.title, status: task.status, summaryId, runId },
          });
        }
      }

      // 3. Update AgentRun with status='completed', summaryIds, taskIds.
      await updateAgentRun(db, auth, runId, {
        status: 'completed',
        summaryIds,
        taskIds,
        completedAt: new Date(),
      });

      await insertAuditEvent(db, auth, {
        actor: 'agent',
        actorId: auth.agentId,
        action: 'agent.runCompleted',
        entityType: 'agentRun',
        entityId: runId,
        after: { status: 'completed', summaryCount: summaryIds.length, taskCount: taskIds.length },
      });

      return successResponse({
        runId,
        status: 'completed',
        summariesCreated: summaryIds.length,
        tasksCreated: taskIds.length,
        summaryIds,
        taskIds,
      }, 201);
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /agent/pending-review
//
// Returns tasks + follow-up drafts that need CTO review.
// Requires TASKS_READ scope.
// ---------------------------------------------------------------------------

export const pendingReview = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      requireScope(auth, AGENT_SCOPES.TASKS_READ);

      const db = await getDb();
      const limitStr = getQueryParam(event, 'limit');
      const limit = limitStr ? Math.min(parseInt(limitStr, 10), 100) : 50;

      const [tasks, drafts] = await Promise.all([
        findTasks(db, auth, { status: 'reviewNeeded', limit }),
        findDrafts(db, auth, { status: 'draft', limit }),
      ]);

      return successResponse({
        tasks: tasks.map((t) => ({
          id: toId(t),
          title: t.title,
          status: t.status,
          priority: t.priority,
          createdAt: t.createdAt.toISOString(),
        })),
        followupDrafts: drafts.map((d) => ({
          id: toId(d),
          taskId: d.taskId,
          channelType: d.channelType,
          status: d.status,
          createdAt: d.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /agent/changes — scope: agent:tasks:read
//
// Returns recent tasks, follow-up drafts, and approvals updated since a given
// timestamp. Defaults to the last 24 hours. Accepts optional ?since= (ISO-8601).
// ---------------------------------------------------------------------------

export const changes = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      requireScope(auth, AGENT_SCOPES.TASKS_READ);

      const db = await getDb();
      const sinceParam = getQueryParam(event, 'since');
      const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const limit = 100;

      // Fetch recent tasks, follow-up drafts, and approvals in parallel.
      const [tasks, drafts, approvals] = await Promise.all([
        findTasks(db, auth, { limit }),
        findDrafts(db, auth, { limit }),
        findApprovals(db, auth, { limit }),
      ]);

      const updatedTasks = tasks.filter((t) => t.updatedAt >= since);
      const updatedDrafts = drafts.filter((d) => d.updatedAt >= since);
      const updatedApprovals = approvals.filter((a) => a.updatedAt >= since);

      return successResponse({
        since: since.toISOString(),
        tasks: updatedTasks.map((t) => ({
          id: toId(t),
          title: t.title,
          status: t.status,
          priority: t.priority,
          updatedAt: t.updatedAt.toISOString(),
        })),
        followupDrafts: updatedDrafts.map((d) => ({
          id: toId(d),
          taskId: d.taskId,
          channelType: d.channelType,
          status: d.status,
          updatedAt: d.updatedAt.toISOString(),
        })),
        approvals: updatedApprovals.map((a) => ({
          id: toId(a),
          actionType: a.actionType,
          status: a.status,
          updatedAt: a.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /agent/followup-drafts — scope: agent:followups:draft
//
// Agent creates a single follow-up draft for CTO review.
// Body: { taskId, channelType, recipientOrTarget?, subject?, body }
// Draft is created with status='draft' and createdBy='agent'.
// ---------------------------------------------------------------------------

export const createFollowupDrafts = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      requireScope(auth, AGENT_SCOPES.FOLLOWUPS_DRAFT);

      const body = parseBody<unknown>(event);
      const input = AgentCreateFollowUpDraftSchema.parse(body);
      const db = await getDb();
      const now = new Date();

      const draft = await insertDraft(db, auth, {
        taskId: input.taskId,
        channelType: input.channelType,
        recipientOrTarget: input.recipientOrTarget,
        subject: input.subject,
        body: input.body,
        status: 'draft',
        createdBy: 'agent',
        userId: auth.userId,
        orgId: auth.orgId,
        createdAt: now,
        updatedAt: now,
      });

      await insertAuditEvent(db, auth, {
        actor: 'agent',
        actorId: auth.agentId,
        action: 'agent.createFollowupDraft',
        entityType: 'followUpDraft',
        entityId: toId(draft),
        after: { taskId: input.taskId, channelType: input.channelType },
      });

      return successResponse({
        followupDraft: {
          id: toId(draft),
          taskId: draft.taskId,
          channelType: draft.channelType,
          status: draft.status,
          createdAt: draft.createdAt.toISOString(),
        },
      }, 201);
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /agent/approval-requests — scope: agent:approvals:create
//
// Agent creates a single approval request for CTO action.
// Body: { taskId?, draftId?, actionType, payload }
// Request is created with status='pending' and createdBy='agent'.
// Agent CANNOT execute the approval — only humans can via /approve + /mark-executed.
// ---------------------------------------------------------------------------

// TODO: Phase 2 — trigger actual external action on approve/execute

export const createApprovalRequests = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      requireScope(auth, AGENT_SCOPES.APPROVALS_CREATE);

      const body = parseBody<unknown>(event);
      const input = AgentCreateApprovalRequestSchema.parse(body);
      const db = await getDb();
      const now = new Date();

      const approval = await insertApproval(db, auth, {
        taskId: input.taskId,
        draftId: input.draftId,
        actionType: input.actionType,
        payload: input.payload,
        status: 'pending',
        createdBy: 'agent',
        userId: auth.userId,
        orgId: auth.orgId,
        createdAt: now,
        updatedAt: now,
      });

      await insertAuditEvent(db, auth, {
        actor: 'agent',
        actorId: auth.agentId,
        action: 'agent.createApprovalRequest',
        entityType: 'approvalRequest',
        entityId: toId(approval),
        after: { actionType: input.actionType, status: 'pending', taskId: input.taskId, draftId: input.draftId },
      });

      return successResponse({
        approvalRequest: {
          id: toId(approval),
          actionType: approval.actionType,
          status: approval.status,
          taskId: approval.taskId,
          draftId: approval.draftId,
          createdAt: approval.createdAt.toISOString(),
        },
      }, 201);
    } catch (err) {
      return handleError(err);
    }
  },
);
