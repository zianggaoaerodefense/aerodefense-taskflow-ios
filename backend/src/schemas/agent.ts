import { z } from 'zod';

/**
 * Zod schemas for agent-facing endpoints (/agent/*).
 *
 * SECURITY:
 * - userId is NEVER accepted in any agent input schema. It is always sourced
 *   from the verified AgentAuthContext (JWT payload).
 * - Every agent endpoint must call requireScope() before processing.
 * - All external actions described here require explicit user approval before
 *   any side-effect is triggered.
 */

export const AgentRunResultSchema = z.object({
  agentId: z.string().min(1),
  runType: z.enum(['scheduled', 'manual']),
  status: z.enum(['started', 'completed', 'failed']),
  sourcesChecked: z.array(z.string()).default([]),
  summaryIds: z.array(z.string()).default([]),
  taskIds: z.array(z.string()).default([]),
  errorMessage: z.string().optional(),
  completedAt: z.string().datetime().optional(),
});

export const AgentFollowUpDraftSchema = z.object({
  taskId: z.string().min(1),
  channelType: z.enum(['email', 'slack', 'jira', 'other']),
  recipientOrTarget: z.string().optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1),
});

export const AgentCreateFollowupDraftsSchema = z.object({
  drafts: z.array(AgentFollowUpDraftSchema).min(1).max(20),
});

export const AgentCreateApprovalRequestSchema = z.object({
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
   * The user must review and approve this before any execution occurs.
   */
  payload: z.record(z.unknown()),
  expiresAt: z.string().datetime().optional(),
});

export const AgentCreateApprovalRequestsSchema = z.object({
  requests: z.array(AgentCreateApprovalRequestSchema).min(1).max(10),
});

export type AgentRunResultInput = z.infer<typeof AgentRunResultSchema>;
export type AgentCreateFollowupDraftsInput = z.infer<typeof AgentCreateFollowupDraftsSchema>;
export type AgentCreateApprovalRequestsInput = z.infer<typeof AgentCreateApprovalRequestsSchema>;
