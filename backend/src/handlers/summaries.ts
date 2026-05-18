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
import { insertAuditEvent } from '../db/repositories/auditRepo';
import {
  CreateSummarySchema,
  UpdateSummarySchema,
} from '../schemas/summary';
import {
  successResponse,
  errorResponse,
  parseBody,
  getPathParam,
  getQueryParam,
} from '../utils/response';
import { handleError, NotFoundError, BadRequestError } from '../utils/errors';
import { insertTask } from '../db/repositories/taskRepo';
import { CreateTaskSchema as FullCreateTaskSchema } from '../schemas/validation';
import { SummaryDoc, SummaryDTO, TaskDoc, TaskPriority, toId, toISOString } from '../models/types';

// ---------------------------------------------------------------------------
// Action-verb extraction stub
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

function containsActionVerb(text: string): boolean {
  const lower = text.toLowerCase();
  return ACTION_VERBS.some((verb) => {
    const idx = lower.indexOf(verb);
    if (idx === -1) return false;
    const b = idx === 0 ? '' : lower[idx - 1];
    const a = lower[idx + verb.length] ?? '';
    return (b === '' || !/\w/.test(b)) && (a === '' || !/\w/.test(a));
  });
}

function extractTaskCandidates(summary: SummaryDoc): TaskCandidate[] {
  const p: TaskPriority = summary.suggestedPriority ?? 'normal';
  const results: TaskCandidate[] = [];
  for (const line of summary.rawText.split('\n')) {
    const t = line.trim();
    if (t && containsActionVerb(t)) {
      results.push({ title: t.slice(0, 200), details: t, sectionContext: 'rawText', suggestedResourceType: 'other', suggestedPriority: p });
    }
  }
  for (const sec of summary.structured.sections ?? []) {
    for (const bullet of sec.extractedBullets ?? []) {
      const t = bullet.trim();
      if (t && containsActionVerb(t)) {
        results.push({ title: t.slice(0, 200), details: t, sectionContext: sec.heading || sec.id, suggestedResourceType: 'other', suggestedPriority: p });
      }
    }
  }
  const seen = new Set<string>();
  return results.filter((c) => { const k = c.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

function toTaskDTO(doc: TaskDoc) {
  return {
    id: toId(doc), userId: doc.userId, orgId: doc.orgId, summaryId: doc.summaryId,
    title: doc.title, details: doc.details, status: doc.status, priority: doc.priority,
    requesterName: doc.requesterName, requesterContact: doc.requesterContact,
    resourceType: doc.resourceType, resourceLabel: doc.resourceLabel, resourceUrl: doc.resourceUrl,
    targetCompletionDate: toISOString(doc.targetCompletionDate),
    actualCompletionDate: toISOString(doc.actualCompletionDate),
    reviewedAt: toISOString(doc.reviewedAt), doneAt: toISOString(doc.doneAt),
    notes: doc.notes, followUpDraftId: doc.followUpDraftId, createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString(),
  };
}

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
// Stub: scans rawText + section bullets for action verbs.
// Returns candidates WITHOUT inserting any tasks into the database.
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
      if (!summary) throw new NotFoundError('Summary not found');

      const candidates = extractTaskCandidates(summary);
      return successResponse({ candidates, count: candidates.length });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /summaries/{id}/accept-tasks
// Body options (one required):
//   { candidateIndices: number[] }   — select by zero-based index into extracted candidates
//   { taskTitles: string[] }         — select by case-insensitive title match
//   { tasks: CreateTaskSchema[] }    — provide full task objects to insert
// ---------------------------------------------------------------------------

export const acceptTasks = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();

      const summary = await findSummaryById(db, auth, id);
      if (!summary) throw new NotFoundError('Summary not found');

      const body = parseBody<Record<string, unknown>>(event);
      const allCandidates = extractTaskCandidates(summary);

      interface Seed { title: string; details: string; priority: TaskPriority; resourceType?: TaskDoc['resourceType']; requesterName?: string; requesterContact?: string; resourceLabel?: string; resourceUrl?: string; targetCompletionDate?: string; notes?: string; }
      let seeds: Seed[] = [];

      if (Array.isArray(body.candidateIndices)) {
        for (const idx of body.candidateIndices as number[]) {
          if (idx >= 0 && idx < allCandidates.length) {
            const c = allCandidates[idx];
            seeds.push({ title: c.title, details: c.details, priority: c.suggestedPriority });
          }
        }
      } else if (Array.isArray(body.taskTitles)) {
        for (const t of body.taskTitles as string[]) {
          const m = allCandidates.find((c) => c.title.toLowerCase() === t.toLowerCase());
          seeds.push({ title: m?.title ?? t, details: m?.details ?? '', priority: m?.suggestedPriority ?? summary.suggestedPriority ?? 'normal' });
        }
      } else if (Array.isArray(body.tasks)) {
        for (const raw of body.tasks as unknown[]) {
          const p = FullCreateTaskSchema.parse(raw);
          seeds.push({ title: p.title, details: p.details, priority: p.priority, requesterName: p.requesterName, requesterContact: p.requesterContact, resourceType: p.resourceType as TaskDoc['resourceType'], resourceLabel: p.resourceLabel, resourceUrl: p.resourceUrl, targetCompletionDate: p.targetCompletionDate, notes: p.notes });
        }
      } else {
        throw new BadRequestError('Body must include one of: candidateIndices, taskTitles, or tasks');
      }

      if (seeds.length === 0) return successResponse({ tasks: [], linkedTaskIds: summary.linkedTaskIds });

      const now = new Date();
      const inserted: TaskDoc[] = [];

      for (const seed of seeds) {
        const task = await insertTask(db, auth, {
          summaryId: id, title: seed.title, details: seed.details, status: 'new',
          priority: seed.priority, requesterName: seed.requesterName, requesterContact: seed.requesterContact,
          resourceType: seed.resourceType ?? 'other', resourceLabel: seed.resourceLabel, resourceUrl: seed.resourceUrl,
          targetCompletionDate: seed.targetCompletionDate ? new Date(seed.targetCompletionDate) : undefined,
          notes: seed.notes ?? '', createdBy: auth.type === 'agent' ? 'agent' : 'user',
          userId: auth.userId, orgId: auth.orgId, createdAt: now, updatedAt: now,
        });
        await addLinkedTask(db, auth, id, toId(task));
        await insertAuditEvent(db, auth, { actor: auth.type, actorId: auth.type === 'agent' ? auth.agentId : auth.userId, action: 'task.create', entityType: 'task', entityId: toId(task), after: { title: task.title, summaryId: id } });
        inserted.push(task);
      }

      const refreshed = await findSummaryById(db, auth, id);
      await insertAuditEvent(db, auth, { actor: auth.type, actorId: auth.type === 'agent' ? auth.agentId : auth.userId, action: 'summary.acceptTasks', entityType: 'summary', entityId: id, after: { acceptedCount: inserted.length } });

      return successResponse({ tasks: inserted.map(toTaskDTO), linkedTaskIds: refreshed?.linkedTaskIds ?? [] }, 201);
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

      const existing = await findSummaryById(db, auth, id);
      if (!existing) throw new NotFoundError('Summary not found');
      if (existing.archivedAt) return errorResponse(409, 'Summary is already archived');

      const doc = await archiveSummary(db, auth, id);
      if (!doc) throw new NotFoundError('Summary not found');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'summary.archive',
        entityType: 'summary',
        entityId: id,
        after: { archivedAt: doc.archivedAt?.toISOString() },
      });

      return successResponse({ summary: toSummaryDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);
