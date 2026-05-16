import { z } from 'zod';

/**
 * Zod schemas for the /tasks endpoints.
 *
 * SECURITY: userId and orgId are NEVER present in these input schemas.
 * They are always derived from the verified AuthContext in the handler layer.
 */

export const CreateTaskSchema = z.object({
  summaryId: z.string().optional(),
  title: z.string().min(1).max(500),
  details: z.string().default(''),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  requesterName: z.string().optional(),
  requesterContact: z.string().optional(),
  resourceType: z
    .enum(['email', 'slack', 'jira', 'github', 'document', 'other'])
    .default('other'),
  resourceLabel: z.string().optional(),
  resourceUrl: z.string().url().optional(),
  targetCompletionDate: z.string().datetime().optional(),
  notes: z.string().default(''),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  details: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  requesterName: z.string().optional(),
  requesterContact: z.string().optional(),
  resourceType: z
    .enum(['email', 'slack', 'jira', 'github', 'document', 'other'])
    .optional(),
  resourceLabel: z.string().optional(),
  resourceUrl: z.string().url().optional(),
  targetCompletionDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
