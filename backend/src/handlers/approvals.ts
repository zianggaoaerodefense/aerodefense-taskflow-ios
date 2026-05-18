/**
 * approvals.ts — Handlers for /approval-requests endpoints.
 *
 * SECURITY INVARIANTS:
 * - userId is NEVER read from the request body or path parameters.
 *   It is always sourced from the verified AuthContext produced by withAuth().
 * - All MongoDB queries delegate to approvalRepo which filters by userId + orgId.
 * - Approval requests are NEVER auto-executed. Execution of any external
 *   action requires a separate explicit user action on /mark-executed.
 * - The `payload` field is stored opaquely; it must not contain credentials.
 * - External inputs are validated with Zod before use.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { AuthContext } from '../auth/types';
import { withAuth, requireScope } from '../middleware/withAuth';
import { AGENT_SCOPES } from '../auth/types';
import { getDb } from '../db/connection';
import {
  findApprovals,
  findApprovalById,
  insertApproval,
  updateApprovalStatus,
} from '../db/repositories/approvalRepo';
import { insertAuditEvent } from '../db/repositories/auditRepo';
import { CreateApprovalRequestSchema, RejectApprovalSchema } from '../schemas/approval';
import {
  successResponse,
  parseBody,
  getPathParam,
  getQueryParam,
} from '../utils/response';
import { handleError, NotFoundError, BadRequestError } from '../utils/errors';
import { ApprovalRequestDoc, ApprovalRequestDTO, ApprovalStatus, toId, toISOString } from '../models/types';

// ---------------------------------------------------------------------------
// DTO mapper
// ---------------------------------------------------------------------------

function toApprovalDTO(doc: ApprovalRequestDoc): ApprovalRequestDTO {
  return {
    id: toId(doc),
    taskId: doc.taskId,
    draftId: doc.draftId,
    actionType: doc.actionType,
    status: doc.status,
    payload: doc.payload,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    approvedAt: toISOString(doc.approvedAt),
  };
}

// ---------------------------------------------------------------------------
// GET /approval-requests
// ---------------------------------------------------------------------------

export const list = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const db = await getDb();
      const statusParam = getQueryParam(event, 'status') as ApprovalStatus | undefined;
      const taskId = getQueryParam(event, 'taskId');
      const draftId = getQueryParam(event, 'draftId');
      const limitStr = getQueryParam(event, 'limit');
      const skipStr = getQueryParam(event, 'skip');

      const approvals = await findApprovals(db, auth, {
        status: statusParam,
        taskId,
        draftId,
        limit: limitStr ? Math.min(parseInt(limitStr, 10), 200) : 100,
        skip: skipStr ? parseInt(skipStr, 10) : 0,
      });

      return successResponse({ approvals: approvals.map(toApprovalDTO) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /approval-requests
// ---------------------------------------------------------------------------

export const create = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      // Agent must have APPROVALS_CREATE scope; users are permitted freely.
      if (auth.type === 'agent') {
        requireScope(auth, AGENT_SCOPES.APPROVALS_CREATE);
      }

      const body = parseBody<unknown>(event);
      const input = CreateApprovalRequestSchema.parse(body);
      const db = await getDb();
      const now = new Date();

      const doc = await insertApproval(db, auth, {
        ...input,
        status: 'pending',
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        userId: auth.userId,
        orgId: auth.orgId,
        createdBy: auth.type === 'agent' ? 'agent' : 'user',
        createdAt: now,
        updatedAt: now,
      });

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'approval.create',
        entityType: 'approvalRequest',
        entityId: toId(doc),
      });

      return successResponse({ approval: toApprovalDTO(doc) }, 201);
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /approval-requests/{id}/approve
//
// Sets status='approved'. Does NOT execute the action automatically.
// TODO: Phase 2 — trigger actual external action on approve/execute
// ---------------------------------------------------------------------------

export const approve = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();

      const existing = await findApprovalById(db, auth, id);
      if (!existing) throw new NotFoundError('Approval request');
      if (existing.status !== 'pending') {
        throw new BadRequestError(`Cannot approve a request with status: ${existing.status}`);
      }

      const now = new Date();
      const doc = await updateApprovalStatus(db, auth, id, 'approved', { approvedAt: now });
      if (!doc) throw new NotFoundError('Approval request');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'approval.approve',
        entityType: 'approvalRequest',
        entityId: id,
        after: { status: 'approved' },
      });

      return successResponse({ approval: toApprovalDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /approval-requests/{id}/reject
// ---------------------------------------------------------------------------

export const reject = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const body = parseBody<unknown>(event);
      // reason is optional — parse leniently.
      const parsed = RejectApprovalSchema.safeParse(body ?? {});
      const db = await getDb();

      const existing = await findApprovalById(db, auth, id);
      if (!existing) throw new NotFoundError('Approval request');
      if (existing.status !== 'pending') {
        throw new BadRequestError(`Cannot reject a request with status: ${existing.status}`);
      }

      const now = new Date();
      const doc = await updateApprovalStatus(db, auth, id, 'rejected', { rejectedAt: now });
      if (!doc) throw new NotFoundError('Approval request');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'approval.reject',
        entityType: 'approvalRequest',
        entityId: id,
        after: {
          status: 'rejected',
          reason: parsed.success ? parsed.data.reason : undefined,
        },
      });

      return successResponse({ approval: toApprovalDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /approval-requests/{id}/mark-executed
//
// Records that the user has manually executed the approved action externally.
// This endpoint does NOT trigger any external side-effect itself.
// ---------------------------------------------------------------------------

export const markExecuted = withAuth(
  async (event: APIGatewayProxyEvent, auth: AuthContext): Promise<APIGatewayProxyResult> => {
    try {
      const id = getPathParam(event, 'id');
      const db = await getDb();

      const existing = await findApprovalById(db, auth, id);
      if (!existing) throw new NotFoundError('Approval request');
      if (existing.status !== 'approved') {
        throw new BadRequestError(`Cannot mark executed a request with status: ${existing.status}`);
      }

      const now = new Date();
      const doc = await updateApprovalStatus(db, auth, id, 'executed', { executedAt: now });
      if (!doc) throw new NotFoundError('Approval request');

      await insertAuditEvent(db, auth, {
        actor: auth.type,
        actorId: auth.type === 'agent' ? auth.agentId : auth.userId,
        action: 'approval.markExecuted',
        entityType: 'approvalRequest',
        entityId: id,
        after: { status: 'executed' },
      });

      return successResponse({ approval: toApprovalDTO(doc) });
    } catch (err) {
      return handleError(err);
    }
  },
);
