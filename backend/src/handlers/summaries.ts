/**
 * summaries.ts — Handlers for /summaries endpoints.
 *
 * SECURITY INVARIANTS:
 * - userId is NEVER read from the request body or path parameters.
 *   It is always sourced from the verified AuthContext produced by withAuth().
 * - All MongoDB queries delegate to summaryRepo which filters by userId + orgId.
 * - Agent endpoints require explicit scope verification via requireScope().
 * - External inputs are validated with Zod before use.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuthContext } from '../auth/types';
import { withAuth, requireScope } from '../middleware/withAuth';
import { AGENT_SCOPES } from '../auth/types';
import { getDb } from '../db/connection';
import {
  findSummaries,
  findSummaryById,
  insertSummary,
  updateSummary,
  addTaskCandidates,
  addLinkedTask,
  archiveSummary,
} from '../db/repositories/summaryRepo';
import { insertAuditEvent } from '../db/repositories/auditRepo';
import {
  CreateSummarySchema,
  UpdateSummarySchema,
  AcceptTasksSchema,
} from '../schemas/summary';
import {
  successResponse,
  errorResponse,
  parseBody,
  getPathParam,
  getQueryParam,
} from '../utils/response';
import { handleError, NotFoundError } from '../utils/errors';
import { SummaryDoc, SummaryDTO, toId } from '../models/types';

// ---------------------------------------------------------------------------
// DTO mapper
// ---------------------------------------------------------------------------

function toSummaryDTO(doc: SummaryDoc): SummaryDTO {
  return {
    id: toId(doc),
    userId: doc.userId,
    orgId: doc.orgId,
    title: doc.title,
    sourceType: doc.sourceType,
    rawText: doc.rawText,
    structured: doc.structured,
    tags: doc.tags,
    suggestedPriority: doc.suggestedPriority,
    reviewNeeded: doc.reviewNeeded,
    actionNeeded: doc.actionNeeded,
    taskCandidateIds: doc.taskCandidateIds,
    linkedTaskIds: doc.linkedTaskIds,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /summaries
// ---------------------------------------------------------------------------

export const list = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const db = await getDb();
      const limitStr = getQueryParam(event, 'limit');
      const skipStr = getQueryParam(event, 'skip');
      const reviewNeededStr = getQueryParam(event, 'reviewNeeded');
      const actionNeededStr = getQueryParam(event, 'actionNeeded');

      const summaries = await findSummaries(db, auth, {
        reviewNeeded: reviewNeededStr === 'true' ? true : reviewNeededStr === 'false' ? false : undefined,
        actionNeeded: actionNeededStr === 'true' ? true : actionNeededStr === 'false' ? false : undefined,
        limit: limitStr ? Math.min(parseInt(limitStr, 10), 200) : 100,
        skip: skipStr ? parseInt(skipStr, 10) : 0,
      });

      return successResponse({ summaries: summaries.map(toSummaryDTO) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /summaries
// ---------------------------------------------------------------------------

export const create = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      if (auth.type === 'agent') {
        requireScope(auth, AGENT_SCOPES.SUMMARIES_CREATE);
      }

      const body = parseBody<unknown>(event);
      const input = CreateSummarySchema.parse(body);
      const db = await getDb();
      const now = new Date();

      const doc = await insertSummary(db, auth, {
        ...input,
        taskCandidateIds: [],
        linkedTaskIds: [],
        userId: auth.userId,
        orgId: auth.orgId,
        createdAt: now,
        updatedAt: now,
      });

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'summary.create',
        entityType: 'summary',
        entityId: toId(doc),
      });

      return successResponse({ summary: toSummaryDTO(doc) }, 201);
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /summaries/{id}
// ---------------------------------------------------------------------------

export const get = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();
      const doc = await findSummaryById(db, auth, id);
      if (!doc) throw new NotFoundError('Summary');
      return successResponse({ summary: toSummaryDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /summaries/{id}
// ---------------------------------------------------------------------------

export const update = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const body = parseBody<unknown>(event);
      const input = UpdateSummarySchema.parse(body);
      const db = await getDb();

      const before = await findSummaryById(db, auth, id);
      if (!before) throw new NotFoundError('Summary');

      const updated = await updateSummary(db, auth, id, input as Partial<SummaryDoc>);
      if (!updated) throw new NotFoundError('Summary');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'summary.update',
        entityType: 'summary',
        entityId: id,
      });

      return successResponse({ summary: toSummaryDTO(updated) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /summaries/{id}/task-candidates
// ---------------------------------------------------------------------------

export const taskCandidates = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      if (auth.type === 'agent') {
        requireScope(auth, AGENT_SCOPES.TASKS_SUGGEST);
      }

      const id = getPathParam(event, 'id');
      const db = await getDb();

      const summary = await findSummaryById(db, auth, id);
      if (!summary) throw new NotFoundError('Summary');

      const body = parseBody<unknown>(event);
      const { candidateIds } = (body as { candidateIds: string[] });
      if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
        return errorResponse(400, 'candidateIds must be a non-empty array');
      }

      const updated = await addTaskCandidates(db, auth, id, candidateIds);
      if (!updated) throw new NotFoundError('Summary');

      return successResponse({ summary: toSummaryDTO(updated) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /summaries/{id}/accept-tasks
// ---------------------------------------------------------------------------

export const acceptTasks = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const body = parseBody<unknown>(event);
      const input = AcceptTasksSchema.parse(body);
      const db = await getDb();

      const summary = await findSummaryById(db, auth, id);
      if (!summary) throw new NotFoundError('Summary');

      const updated = await addLinkedTask(db, auth, id, input.taskCandidateIds[0]);
      if (!updated) throw new NotFoundError('Summary');

      for (const taskId of input.taskCandidateIds.slice(1)) {
        await addLinkedTask(db, auth, id, taskId);
      }

      const final = await findSummaryById(db, auth, id);
      if (!final) throw new NotFoundError('Summary');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'summary.acceptTasks',
        entityType: 'summary',
        entityId: id,
        after: { acceptedTaskIds: input.taskCandidateIds },
      });

      return successResponse({ summary: toSummaryDTO(final) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /summaries/{id}/archive
// ---------------------------------------------------------------------------

export const archive = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();

      const doc = await archiveSummary(db, auth, id);
      if (!doc) throw new NotFoundError('Summary');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'summary.archive',
        entityType: 'summary',
        entityId: id,
      });

      return successResponse({ summary: toSummaryDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);
