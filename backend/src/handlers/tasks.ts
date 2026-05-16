/**
 * tasks.ts — Handlers for /tasks endpoints.
 *
 * SECURITY INVARIANTS:
 * - userId is NEVER read from the request body or path parameters.
 *   It is always sourced from the verified AuthContext produced by withAuth().
 * - All MongoDB queries delegate to taskRepo which filters by userId + orgId.
 * - Status transitions are applied server-side with timestamping.
 * - External inputs are validated with Zod before use.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuthContext } from '../auth/types';
import { withAuth } from '../middleware/withAuth';
import { getDb } from '../db/connection';
import {
  findTasks,
  findTaskById,
  insertTask,
  updateTask,
  markTaskStatus,
} from '../db/repositories/taskRepo';
import { insertAuditEvent } from '../db/repositories/auditRepo';
import { CreateTaskSchema, UpdateTaskSchema } from '../schemas/task';
import {
  successResponse,
  parseBody,
  getPathParam,
  getQueryParam,
} from '../utils/response';
import { handleError, NotFoundError } from '../utils/errors';
import { TaskDoc, TaskDTO, TaskStatus, toId, toISOString } from '../models/types';

// ---------------------------------------------------------------------------
// DTO mapper
// ---------------------------------------------------------------------------

function toTaskDTO(doc: TaskDoc): TaskDTO {
  return {
    id: toId(doc),
    userId: doc.userId,
    orgId: doc.orgId,
    summaryId: doc.summaryId,
    title: doc.title,
    details: doc.details,
    status: doc.status,
    priority: doc.priority,
    requesterName: doc.requesterName,
    requesterContact: doc.requesterContact,
    resourceType: doc.resourceType,
    resourceLabel: doc.resourceLabel,
    resourceUrl: doc.resourceUrl,
    targetCompletionDate: toISOString(doc.targetCompletionDate),
    actualCompletionDate: toISOString(doc.actualCompletionDate),
    reviewedAt: toISOString(doc.reviewedAt),
    doneAt: toISOString(doc.doneAt),
    notes: doc.notes,
    followUpDraftId: doc.followUpDraftId,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /tasks
// ---------------------------------------------------------------------------

export const list = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const db = await getDb();
      const statusParam = getQueryParam(event, 'status') as TaskStatus | undefined;
      const summaryId = getQueryParam(event, 'summaryId');
      const limitStr = getQueryParam(event, 'limit');
      const skipStr = getQueryParam(event, 'skip');

      const tasks = await findTasks(db, auth, {
        status: statusParam,
        summaryId,
        limit: limitStr ? Math.min(parseInt(limitStr, 10), 200) : 100,
        skip: skipStr ? parseInt(skipStr, 10) : 0,
      });

      return successResponse({ tasks: tasks.map(toTaskDTO) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /tasks
// ---------------------------------------------------------------------------

export const create = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const body = parseBody<unknown>(event);
      const input = CreateTaskSchema.parse(body);
      const db = await getDb();
      const now = new Date();

      const doc = await insertTask(db, auth, {
        ...input,
        targetCompletionDate: input.targetCompletionDate
          ? new Date(input.targetCompletionDate)
          : undefined,
        status: 'new',
        userId: auth.userId,
        orgId: auth.orgId,
        createdBy: auth.type === 'agent' ? 'agent' : 'user',
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      });

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'task.create',
        entityType: 'task',
        entityId: toId(doc),
      });

      return successResponse({ task: toTaskDTO(doc) }, 201);
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /tasks/{id}
// ---------------------------------------------------------------------------

export const get = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();
      const doc = await findTaskById(db, auth, id);
      if (!doc) throw new NotFoundError('Task');
      return successResponse({ task: toTaskDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /tasks/{id}
// ---------------------------------------------------------------------------

export const update = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const body = parseBody<unknown>(event);
      const input = UpdateTaskSchema.parse(body);
      const db = await getDb();

      const updates: Partial<TaskDoc> = {
        ...input,
        targetCompletionDate: input.targetCompletionDate
          ? new Date(input.targetCompletionDate)
          : undefined,
      };

      const doc = await updateTask(db, auth, id, updates);
      if (!doc) throw new NotFoundError('Task');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'task.update',
        entityType: 'task',
        entityId: id,
      });

      return successResponse({ task: toTaskDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Status transition helpers
// ---------------------------------------------------------------------------

function statusHandler(
  newStatus: TaskStatus,
  auditAction: string,
  extraFields?: (now: Date) => Partial<TaskDoc>,
) {
  return withAuth(
    async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
      try {
        const id = getPathParam(event, 'id');
        const db = await getDb();
        const now = new Date();

        const doc = await markTaskStatus(
          db,
          auth,
          id,
          newStatus,
          extraFields ? extraFields(now) : undefined,
        );
        if (!doc) throw new NotFoundError('Task');

        await insertAuditEvent(db, auth, {
          actor: auth.type,
          actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
          action: auditAction,
          entityType: 'task',
          entityId: id,
          after: { status: newStatus },
        });

        return successResponse({ task: toTaskDTO(doc) });
      } catch (err) {
        return handleError(err);
      }
    },
  );
}

// POST /tasks/{id}/mark-reviewed
export const markReviewed = statusHandler(
  'reviewNeeded',
  'task.markReviewed',
  (now) => ({ reviewedAt: now }),
);

// POST /tasks/{id}/mark-action-needed
export const markActionNeeded = statusHandler(
  'actionNeeded',
  'task.markActionNeeded',
);

// POST /tasks/{id}/mark-waiting
export const markWaiting = statusHandler(
  'waiting',
  'task.markWaiting',
);

// POST /tasks/{id}/mark-done
export const markDone = statusHandler(
  'done',
  'task.markDone',
  (now) => ({ doneAt: now, actualCompletionDate: now }),
);

// POST /tasks/{id}/archive
export const archive = statusHandler(
  'archived',
  'task.archive',
  (now) => ({ archivedAt: now }),
);
