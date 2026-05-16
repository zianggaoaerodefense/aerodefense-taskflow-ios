import { z } from 'zod';

/**
 * Zod schemas for the /summaries endpoints.
 *
 * SECURITY: userId and orgId are NEVER present in these input schemas.
 * They are always derived from the verified AuthContext in the handler layer.
 */

const SummarySectionSchema = z.object({
  id: z.string().min(1),
  heading: z.string().min(1),
  body: z.string(),
  extractedBullets: z.array(z.string()),
});

const SummaryStructuredSchema = z.object({
  requester: z.string().optional(),
  requesterContact: z.string().optional(),
  mainAsk: z.string().optional(),
  deadline: z.string().optional(),
  risks: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  sections: z.array(SummarySectionSchema).default([]),
});

export const CreateSummarySchema = z.object({
  title: z.string().min(1).max(500),
  sourceType: z.enum(['agent', 'email', 'slack', 'jira', 'manual', 'import', 'sample']),
  sourceRefs: z.array(z.string()).default([]),
  rawText: z.string(),
  structured: SummaryStructuredSchema.default({
    risks: [],
    dependencies: [],
    sections: [],
  }),
  tags: z.array(z.string()).default([]),
  suggestedPriority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  reviewNeeded: z.boolean().default(true),
  actionNeeded: z.boolean().default(false),
});

export const UpdateSummarySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  tags: z.array(z.string()).optional(),
  suggestedPriority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  reviewNeeded: z.boolean().optional(),
  actionNeeded: z.boolean().optional(),
  structured: SummaryStructuredSchema.partial().optional(),
});

export const AcceptTasksSchema = z.object({
  taskCandidateIds: z.array(z.string().min(1)).min(1),
});

export type CreateSummaryInput = z.infer<typeof CreateSummarySchema>;
export type UpdateSummaryInput = z.infer<typeof UpdateSummarySchema>;
export type AcceptTasksInput = z.infer<typeof AcceptTasksSchema>;
