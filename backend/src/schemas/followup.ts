import { z } from 'zod';

/**
 * Zod schemas for the /followups endpoints.
 *
 * SECURITY: userId and orgId are NEVER present in these input schemas.
 * They are always derived from the verified AuthContext in the handler layer.
 */

export const CreateFollowUpSchema = z.object({
  taskId: z.string().min(1),
  channelType: z.enum(['email', 'slack', 'jira', 'other']),
  recipientOrTarget: z.string().optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1),
});

export const UpdateFollowUpSchema = z.object({
  channelType: z.enum(['email', 'slack', 'jira', 'other']).optional(),
  recipientOrTarget: z.string().optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).optional(),
});

export type CreateFollowUpInput = z.infer<typeof CreateFollowUpSchema>;
export type UpdateFollowUpInput = z.infer<typeof UpdateFollowUpSchema>;
