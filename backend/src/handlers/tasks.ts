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
import { insertDraft } from '../db/repositories/followupRepo';
import { insertAuditEvent } from '../db/repositories/auditRepo';
import { CreateTaskSchema, UpdateTaskSchema } from '../schemas/task';
import {
  successResponse,
  parseBody,
  getPathParam,
  getQueryParam,
} from '../utils/response';
import { handleError, NotFoundError } from '../utils/errors';
import { TaskDoc, TaskDTO, TaskStatus, TaskPriority, ResourceType, ChannelType, toId, toISOString } from '../models/types';

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
      // ?priority= is accepted for client-side convenience; filtering is applied after fetch
      // since taskRepo does not yet expose a priority filter parameter.
      const priorityParam = getQueryParam(event, 'priority') as TaskPriority | undefined;

      const tasks = await findTasks(db, auth, {
        status: statusParam,
        summaryId,
        limit: limitStr ? Math.min(parseInt(limitStr, 10), 200) : 100,
        skip: skipStr ? parseInt(skipStr, 10) : 0,
      });

      const filtered = priorityParam ? tasks.filter((t) => t.priority === priorityParam) : tasks;

      return successResponse({ tasks: filtered.map(toTaskDTO) });
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
        after: { title: doc.title, status: doc.status, priority: doc.priority },
      });

      return successResponse({ task: toTaskDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Follow-up draft generation helpers (used by markDone)
// ---------------------------------------------------------------------------

function mapResourceTypeToChannel(rt: ResourceType): ChannelType {
  switch (rt) {
    case 'email': return 'email';
    case 'slack': return 'slack';
    case 'jira': return 'jira';
    default: return 'other';
  }
}

function generateFollowUpBody(task: TaskDoc, channelType: ChannelType): string {
  const name = task.requesterName ?? 'there';
  const completionDate = task.actualCompletionDate?.toISOString().split('T')[0] ?? 'recently';
  switch (channelType) {
    case 'email':
      return `Hi ${name},\n\nI wanted to follow up and let you know that I completed: ${task.title}.\n\nSummary:\n${task.details}\n\nPlease let me know if you need anything else.\n\nBest,\nZiang`;
    case 'slack':
      return `Hi ${name}, quick update: I completed ${task.title}. ${task.details.slice(0, 100)}. Let me know if you want me to adjust anything.`;
    case 'jira':
      return `Completed this task.\n\nSummary:\n${task.details}\n\nCompletion date: ${completionDate}`;
    default:
      return `Completed: ${task.title}\n\nDetails:\n${task.details}`;
  }
}

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
        if (!doc) throw new NotFoundError('Task not found');

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
// Transitions task to 'actionNeeded' (reviewed + cleared for action) and stamps reviewedAt.
export const markReviewed = statusHandler(
  'actionNeeded',
  'task.markReviewed',
  (now) => ({ reviewedAt: now }),
);

// POST /tasks/{id}/mark-action-needed
export const markActionNeeded = statusHandler(
  'actionNeeded',
  'task.markActionNeeded',
  (now) => ({ reviewedAt: now }),
);

// POST /tasks/{id}/mark-waiting
export const markWaiting = statusHandler(
  'waiting',
  'task.markWaiting',
);

// POST /tasks/{id}/mark-done
// Transitions to 'done', stamps doneAt + actualCompletionDate, then auto-generates
// a follow-up draft if one does not already exist.
export const markDone = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();
      const now = new Date();

      let task = await markTaskStatus(db, auth, id, 'done', {
        doneAt: now,
        actualCompletionDate: now,
      });
      if (!task) throw new NotFoundError('Task not found');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'task.markDone',
        entityType: 'task',
        entityId: id,
        after: { status: 'done', doneAt: now.toISOString() },
      });

      // Auto-create follow-up draft if not already present.
      if (!task.followUpDraftId) {
        const channelType = mapResourceTypeToChannel(task.resourceType);
        const draftBody = generateFollowUpBody(task, channelType);
        const draft = await insertDraft(db, auth, {
          taskId: toId(task),
          channelType,
          recipientOrTarget: task.requesterName,
          subject: channelType === 'email' ? `Follow-up: ${task.title}` : undefined,
          body: draftBody,
          status: 'draft',
          createdBy: 'system',
          userId: auth.userId,
          orgId: auth.orgId,
          createdAt: now,
          updatedAt: now,
        });

        // Link draft id back to task.
        const updatedTask = await updateTask(db, auth, id, { followUpDraftId: toId(draft) });
        if (updatedTask) task = updatedTask;

        await insertAuditEvent(db, auth, {
          actor: auth.type,
          actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
          action: 'followup.autoCreate',
          entityType: 'followUpDraft',
          entityId: toId(draft),
          after: { taskId: id, channelType },
        });
      }

      return successResponse({ task: toTaskDTO(task) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// POST /tasks/{id}/archive
export const archive = statusHandler(
  'archived',
  'task.archive',
  (now) => ({ archivedAt: now }),
);
