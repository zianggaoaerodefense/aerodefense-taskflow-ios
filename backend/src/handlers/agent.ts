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
import { findTasks } from '../db/repositories/taskRepo';
import { findDrafts, insertDraft } from '../db/repositories/followupRepo';
import { insertApproval } from '../db/repositories/approvalRepo';
import { insertAuditEvent, findAuditEvents } from '../db/repositories/auditRepo';
import {
  AgentRunResultSchema,
  AgentCreateFollowupDraftsSchema,
  AgentCreateApprovalRequestsSchema,
} from '../schemas/agent';
import {
  successResponse,
  parseBody,
  getQueryParam,
} from '../utils/response';
import { handleError } from '../utils/errors';
import {
  AgentRunDoc,
  FollowUpDraftDoc,
  ApprovalRequestDoc,
  toId,
} from '../models/types';

// ---------------------------------------------------------------------------
// POST /agent/run-results
//
// Agent submits the outcome of a scheduled or manual run.
// ---------------------------------------------------------------------------

export const submitRunResults = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      // Any agent with a valid token may submit run results — no extra scope
      // required for telemetry. Callers must still present a valid agent JWT.
      if (auth.type !== 'agent') {
        return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Agent token required' }) };
      }

      const body = parseBody<unknown>(event);
      const input = AgentRunResultSchema.parse(body);
      const db = await getDb();
      const now = new Date();

      const doc: Omit<AgentRunDoc, '_id'> = {
        userId: auth.userId,
        orgId: auth.orgId,
        runType: input.runType,
        status: input.status,
        agentId: auth.agentId,         // agentId always from verified token, not body
        sourcesChecked: input.sourcesChecked,
        summaryIds: input.summaryIds,
        taskIds: input.taskIds,
        errorMessage: input.errorMessage,
        completedAt: input.completedAt ? new Date(input.completedAt) : undefined,
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection<AgentRunDoc>('agentRuns').insertOne(doc as AgentRunDoc);
      const insertedId = result.insertedId.toHexString();

      await insertAuditEvent(db, auth, {
        actor: 'agent',
        actorId: auth.agentId,
        action: 'agent.submitRunResults',
        entityType: 'agentRun',
        entityId: insertedId,
        after: { status: input.status, runType: input.runType },
      });

      return successResponse({ runId: insertedId, status: input.status }, 201);
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
// GET /agent/changes
//
// Returns recent audit events so the agent can sync its local state.
// Requires TASKS_READ scope.
// ---------------------------------------------------------------------------

export const changes = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      requireScope(auth, AGENT_SCOPES.TASKS_READ);

      const db = await getDb();
      const entityType = getQueryParam(event, 'entityType');
      const limitStr = getQueryParam(event, 'limit');

      const events = await findAuditEvents(db, auth, {
        entityType,
        limit: limitStr ? Math.min(parseInt(limitStr, 10), 200) : 100,
      });

      return successResponse({
        changes: events.map((e) => ({
          id: toId(e),
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId,
          actor: e.actor,
          createdAt: e.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /agent/followup-drafts
//
// Agent creates one or more follow-up drafts for CTO review.
// Requires FOLLOWUPS_DRAFT scope.
// ---------------------------------------------------------------------------

export const createFollowupDrafts = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      requireScope(auth, AGENT_SCOPES.FOLLOWUPS_DRAFT);

      const body = parseBody<unknown>(event);
      const input = AgentCreateFollowupDraftsSchema.parse(body);
      const db = await getDb();
      const now = new Date();

      const created: FollowUpDraftDoc[] = [];
      for (const draft of input.drafts) {
        const doc = await insertDraft(db, auth, {
          ...draft,
          status: 'draft',
          userId: auth.userId,
          orgId: auth.orgId,
          createdBy: 'agent',
          createdAt: now,
          updatedAt: now,
        });
        created.push(doc);

        await insertAuditEvent(db, auth, {
          actor: 'agent',
          actorId: auth.agentId,
          action: 'agent.createFollowupDraft',
          entityType: 'followUpDraft',
          entityId: toId(doc),
        });
      }

      return successResponse(
        {
          created: created.map((d) => ({
            id: toId(d),
            taskId: d.taskId,
            channelType: d.channelType,
            status: d.status,
          })),
          count: created.length,
        },
        201,
      );
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /agent/approval-requests
//
// Agent creates one or more approval requests for CTO action.
// Requires APPROVALS_CREATE scope.
// All created requests are in 'pending' status — never auto-executed.
// ---------------------------------------------------------------------------

export const createApprovalRequests = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      requireScope(auth, AGENT_SCOPES.APPROVALS_CREATE);

      const body = parseBody<unknown>(event);
      const input = AgentCreateApprovalRequestsSchema.parse(body);
      const db = await getDb();
      const now = new Date();

      const created: ApprovalRequestDoc[] = [];
      for (const req of input.requests) {
        const doc = await insertApproval(db, auth, {
          ...req,
          status: 'pending',
          expiresAt: req.expiresAt ? new Date(req.expiresAt) : undefined,
          userId: auth.userId,
          orgId: auth.orgId,
          createdBy: 'agent',
          createdAt: now,
          updatedAt: now,
        });
        created.push(doc);

        await insertAuditEvent(db, auth, {
          actor: 'agent',
          actorId: auth.agentId,
          action: 'agent.createApprovalRequest',
          entityType: 'approvalRequest',
          entityId: toId(doc),
          after: { actionType: req.actionType, status: 'pending' },
        });
      }

      return successResponse(
        {
          created: created.map((r) => ({
            id: toId(r),
            actionType: r.actionType,
            status: r.status,
          })),
          count: created.length,
        },
        201,
      );
    } catch (err) {
      return handleError(err);
    }
  },
);
