import { z } from 'zod';

/**
 * Zod schemas for the /approval-requests endpoints.
 *
 * SECURITY:
 * - userId and orgId are NEVER present in these input schemas.
 * - The `payload` field is an opaque record. It is stored as-is and must be
 *   validated at execution time before any external side-effect is triggered.
 * - Credentials, tokens, or secrets must NEVER be embedded in `payload`.
 */

export const CreateApprovalRequestSchema = z.object({
  taskId: z.string().optional(),
  draftId: z.string().optional(),
  actionType: z.enum([
    'send_email',
    'send_slack',
    'comment_jira',
    'update_jira',
  ]),
  /**
   * Opaque payload describing the intended external action.
   * Must not contain plaintext credentials or API keys.
   */
  payload: z.record(z.unknown()),
  expiresAt: z.string().datetime().optional(),
});

export const RejectApprovalSchema = z.object({
  reason: z.string().max(1000).optional(),
});

export type CreateApprovalRequestInput = z.infer<typeof CreateApprovalRequestSchema>;
export type RejectApprovalInput = z.infer<typeof RejectApprovalSchema>;
