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
  addLinkedTask,
  archiveSummary,
} from '../db/repositories/summaryRepo';
import { insertTask } from '../db/repositories/taskRepo';
import { insertAuditEvent } from '../db/repositories/auditRepo';
import {
  CreateSummarySchema,
  UpdateSummarySchema,
} from '../schemas/summary';
import { CreateTaskSchema as FullCreateTaskSchema } from '../schemas/validation';
import {
  successResponse,
  errorResponse,
  parseBody,
  getPathParam,
  getQueryParam,
} from '../utils/response';
import { handleError, NotFoundError, BadRequestError } from '../utils/errors';
import { SummaryDoc, SummaryDTO, TaskDoc, TaskPriority, toId, toISOString } from '../models/types';

// ---------------------------------------------------------------------------
// Action-verb list for lightweight task-candidate extraction (stub)
// ---------------------------------------------------------------------------

const ACTION_VERBS: string[] = [
  'follow up', 'send', 'review', 'check', 'create', 'update', 'finish',
  'test', 'verify', 'prepare', 'schedule', 'draft', 'ask', 'confirm',
  'investigate', 'implement', 'deploy', 'document', 'provide', 'share', 'discuss',
];

export interface TaskCandidate {
  title: string;
  details: string;
  sectionContext: string;
  suggestedResourceType: string;
  suggestedPriority: TaskPriority;
}

/** Returns true when text contains one of the action verbs at a word boundary. */
function containsActionVerb(text: string): boolean {
  const lower = text.toLowerCase();
  return ACTION_VERBS.some((verb) => {
    const idx = lower.indexOf(verb);
    if (idx === -1) return false;
    const before = idx === 0 ? '' : lower[idx - 1];
    const after = lower[idx + verb.length] ?? '';
    return (before === '' || !/\w/.test(before)) && (after === '' || !/\w/.test(after));
  });
}

/**
 * Stub task-candidate extractor.
 * Scans rawText lines and section extractedBullets for action verbs.
 * Returns candidates WITHOUT inserting anything.
 */
function extractTaskCandidates(summary: SummaryDoc): TaskCandidate[] {
  const candidates: TaskCandidate[] = [];
  const defaultPriority: TaskPriority = summary.suggestedPriority ?? 'normal';

  for (const line of summary.rawText.split('\n')) {
    const t = line.trim();
    if (t && containsActionVerb(t)) {
      candidates.push({ title: t.slice(0, 200), details: t, sectionContext: 'rawText', suggestedResourceType: 'other', suggestedPriority: defaultPriority });
    }
  }

  for (const section of summary.structured.sections ?? []) {
    for (const bullet of section.extractedBullets ?? []) {
      const t = bullet.trim();
      if (t && containsActionVerb(t)) {
        candidates.push({ title: t.slice(0, 200), details: t, sectionContext: section.heading || section.id, suggestedResourceType: 'other', suggestedPriority: defaultPriority });
      }
    }
  }

  // Deduplicate by title (case-insensitive).
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// DTO mappers
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

function toTaskDTO(doc: TaskDoc) {
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
// GET /summaries — optional ?status=, ?limit=, ?skip=
// ---------------------------------------------------------------------------

export const list = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const db = await getDb();
      const status = getQueryParam(event, 'status');
      const limitStr = getQueryParam(event, 'limit');
      const skipStr = getQueryParam(event, 'skip');
      const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200) : 50;
      const skip = skipStr ? Math.max(parseInt(skipStr, 10) || 0, 0) : 0;

      const opts: Parameters<typeof findSummaries>[2] = { limit, skip };
      if (status === 'archived') opts.includeArchived = true;
      else if (status === 'reviewNeeded') opts.reviewNeeded = true;
      else if (status === 'actionNeeded') opts.actionNeeded = true;

      const summaries = await findSummaries(db, auth, opts);
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
      // Agent must have SUMMARIES_CREATE scope; users are permitted freely.
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
        after: { title: doc.title, sourceType: doc.sourceType },
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
        before: { title: before.title, reviewNeeded: before.reviewNeeded, actionNeeded: before.actionNeeded },
        after: { title: updated.title, reviewNeeded: updated.reviewNeeded, actionNeeded: updated.actionNeeded },
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

      // The body is an array of candidate task IDs (already created tasks).
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

      // Move accepted IDs from candidateIds to linkedTaskIds.
      const updated = await addLinkedTask(db, auth, id, input.taskCandidateIds[0]);
      if (!updated) throw new NotFoundError('Summary');

      // For all accepted IDs, link them.
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
