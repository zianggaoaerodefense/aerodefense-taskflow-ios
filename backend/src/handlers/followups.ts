/**
 * followups.ts — Handlers for /followups endpoints.
 *
 * SECURITY INVARIANTS:
 * - userId is NEVER read from the request body or path parameters.
 *   It is always sourced from the verified AuthContext produced by withAuth().
 * - All MongoDB queries delegate to followupRepo which filters by userId + orgId.
 * - Agent endpoints require explicit scope verification via requireScope().
 * - External inputs are validated with Zod before use.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuthContext } from '../auth/types';
import { withAuth, requireScope } from '../middleware/withAuth';
import { AGENT_SCOPES } from '../auth/types';
import { getDb } from '../db/connection';
import {
  findDrafts,
  findDraftById,
  insertDraft,
  updateDraft,
  updateDraftStatus,
} from '../db/repositories/followupRepo';
import { insertAuditEvent } from '../db/repositories/auditRepo';
import { CreateFollowUpSchema, UpdateFollowUpSchema } from '../schemas/followup';
import {
  successResponse,
  parseBody,
  getPathParam,
  getQueryParam,
} from '../utils/response';
import { handleError, NotFoundError } from '../utils/errors';
import { FollowUpDraftDoc, FollowUpDraftDTO, toId } from '../models/types';

// ---------------------------------------------------------------------------
// DTO mapper
// ---------------------------------------------------------------------------

function toDraftDTO(doc: FollowUpDraftDoc): FollowUpDraftDTO {
  return {
    id: toId(doc),
    taskId: doc.taskId,
    channelType: doc.channelType,
    recipientOrTarget: doc.recipientOrTarget,
    subject: doc.subject,
    body: doc.body,
    status: doc.status,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /followups
// ---------------------------------------------------------------------------

export const list = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const db = await getDb();
      const taskId = getQueryParam(event, 'taskId');
      const statusParam = getQueryParam(event, 'status');
      const limitStr = getQueryParam(event, 'limit');
      const skipStr = getQueryParam(event, 'skip');

      const drafts = await findDrafts(db, auth, {
        taskId,
        status: statusParam as FollowUpDraftDoc['status'] | undefined,
        limit: limitStr ? Math.min(parseInt(limitStr, 10), 200) : 100,
        skip: skipStr ? parseInt(skipStr, 10) : 0,
      });

      return successResponse({ followups: drafts.map(toDraftDTO) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /followups
// ---------------------------------------------------------------------------

export const create = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      // Agent must have FOLLOWUPS_DRAFT scope; users are permitted freely.
      if (auth.type === 'agent') {
        requireScope(auth, AGENT_SCOPES.FOLLOWUPS_DRAFT);
      }

      const body = parseBody<unknown>(event);
      const input = CreateFollowUpSchema.parse(body);
      const db = await getDb();
      const now = new Date();

      const doc = await insertDraft(db, auth, {
        ...input,
        status: 'draft',
        userId: auth.userId,
        orgId: auth.orgId,
        createdBy: auth.type === 'agent' ? 'agent' : 'user',
        createdAt: now,
        updatedAt: now,
      });

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'followup.create',
        entityType: 'followUpDraft',
        entityId: toId(doc),
      });

      return successResponse({ followup: toDraftDTO(doc) }, 201);
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /followups/{id}
// ---------------------------------------------------------------------------

export const get = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();
      const doc = await findDraftById(db, auth, id);
      if (!doc) throw new NotFoundError('Follow-up draft');
      return successResponse({ followup: toDraftDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /followups/{id}
// ---------------------------------------------------------------------------

export const update = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const body = parseBody<unknown>(event);
      const input = UpdateFollowUpSchema.parse(body);
      const db = await getDb();

      const doc = await updateDraft(db, auth, id, input as Partial<FollowUpDraftDoc>);
      if (!doc) throw new NotFoundError('Follow-up draft');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'followup.update',
        entityType: 'followUpDraft',
        entityId: id,
      });

      return successResponse({ followup: toDraftDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /followups/{id}/mark-reviewed
// ---------------------------------------------------------------------------

export const markReviewed = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();
      const now = new Date();

      const doc = await updateDraftStatus(db, auth, id, 'reviewed', { reviewedAt: now });
      if (!doc) throw new NotFoundError('Follow-up draft');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'followup.markReviewed',
        entityType: 'followUpDraft',
        entityId: id,
        after: { status: 'reviewed' },
      });

      return successResponse({ followup: toDraftDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /followups/{id}/approve
// ---------------------------------------------------------------------------

export const approve = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();
      const now = new Date();

      const doc = await updateDraftStatus(db, auth, id, 'approved', { approvedAt: now });
      if (!doc) throw new NotFoundError('Follow-up draft');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'followup.approve',
        entityType: 'followUpDraft',
        entityId: id,
        after: { status: 'approved' },
      });

      return successResponse({ followup: toDraftDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /followups/{id}/archive
// ---------------------------------------------------------------------------

export const archive = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();

      const doc = await updateDraftStatus(db, auth, id, 'archived');
      if (!doc) throw new NotFoundError('Follow-up draft');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'followup.archive',
        entityType: 'followUpDraft',
        entityId: id,
        after: { status: 'archived' },
      });

      return successResponse({ followup: toDraftDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);
