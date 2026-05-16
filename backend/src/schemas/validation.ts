import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
const taskStatusSchema = z.enum(['new', 'reviewNeeded', 'actionNeeded', 'waiting', 'done', 'archived']);
const resourceTypeSchema = z.enum(['email', 'slack', 'jira', 'github', 'document', 'other']);
const channelTypeSchema = z.enum(['email', 'slack', 'jira', 'other']);
const sourceTypeSchema = z.enum(['agent', 'email', 'slack', 'jira', 'manual', 'import', 'sample']);
const approvalActionTypeSchema = z.enum(['send_email', 'send_slack', 'comment_jira', 'update_jira']);
const draftStatusSchema = z.enum(['draft', 'reviewed', 'approved', 'sentExternally', 'archived']);

// ---------------------------------------------------------------------------
// Summary schemas
// ---------------------------------------------------------------------------

export const CreateSummarySchema = z.object({
  title: z.string().min(1).max(500),
  sourceType: sourceTypeSchema,
  sourceRefs: z.array(z.string()).default([]),
  rawText: z.string().min(1),
  structured: z.object({
    requester: z.string().optional(),
    requesterContact: z.string().optional(),
    mainAsk: z.string().optional(),
    deadline: z.string().optional(),
    risks: z.array(z.string()).default([]),
    dependencies: z.array(z.string()).default([]),
    sections: z.array(
      z.object({
        id: z.string(),
        heading: z.string(),
        body: z.string(),
        extractedBullets: z.array(z.string()).default([]),
      }),
    ).default([]),
  }),
  tags: z.array(z.string()).default([]),
  suggestedPriority: taskPrioritySchema.default('normal'),
  reviewNeeded: z.boolean().default(true),
  actionNeeded: z.boolean().default(false),
});

export type CreateSummaryInput = z.infer<typeof CreateSummarySchema>;

export const UpdateSummarySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  tags: z.array(z.string()).optional(),
  suggestedPriority: taskPrioritySchema.optional(),
  reviewNeeded: z.boolean().optional(),
  actionNeeded: z.boolean().optional(),
  structured: z
    .object({
      requester: z.string().optional(),
      requesterContact: z.string().optional(),
      mainAsk: z.string().optional(),
      deadline: z.string().optional(),
      risks: z.array(z.string()).optional(),
      dependencies: z.array(z.string()).optional(),
      sections: z
        .array(
          z.object({
            id: z.string(),
            heading: z.string(),
            body: z.string(),
            extractedBullets: z.array(z.string()).default([]),
          }),
        )
        .optional(),
    })
    .optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

export type UpdateSummaryInput = z.infer<typeof UpdateSummarySchema>;

// ---------------------------------------------------------------------------
// Task schemas
// ---------------------------------------------------------------------------

export const CreateTaskSchema = z.object({
  summaryId: z.string().optional(),
  title: z.string().min(1).max(500),
  details: z.string().default(''),
  status: taskStatusSchema.default('new'),
  priority: taskPrioritySchema.default('normal'),
  requesterName: z.string().optional(),
  requesterContact: z.string().optional(),
  resourceType: resourceTypeSchema.default('other'),
  resourceLabel: z.string().optional(),
  resourceUrl: z.string().url().optional(),
  targetCompletionDate: z.string().datetime().optional(),
  notes: z.string().default(''),
});

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  details: z.string().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  requesterName: z.string().optional(),
  requesterContact: z.string().optional(),
  resourceType: resourceTypeSchema.optional(),
  resourceLabel: z.string().optional(),
  resourceUrl: z.string().url().optional(),
  targetCompletionDate: z.string().datetime().optional(),
  notes: z.string().optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;

// ---------------------------------------------------------------------------
// Accept-tasks (from summary) schemas
// ---------------------------------------------------------------------------

export const AcceptTasksByCandidateIndicesSchema = z.object({
  candidateIndices: z.array(z.number().int().nonnegative()),
});

export const AcceptTasksByTitlesSchema = z.object({
  taskTitles: z.array(z.string().min(1)),
});

export const AcceptTasksByFullSchema = z.object({
  tasks: z.array(CreateTaskSchema),
});

export const AcceptTasksSchema = z.union([
  AcceptTasksByCandidateIndicesSchema,
  AcceptTasksByTitlesSchema,
  AcceptTasksByFullSchema,
]);

export type AcceptTasksInput = z.infer<typeof AcceptTasksSchema>;

// ---------------------------------------------------------------------------
// Follow-up draft schemas
// ---------------------------------------------------------------------------

export const CreateFollowUpDraftSchema = z.object({
  taskId: z.string().min(1),
  channelType: channelTypeSchema,
  recipientOrTarget: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().min(1),
  status: draftStatusSchema.default('draft'),
});

export type CreateFollowUpDraftInput = z.infer<typeof CreateFollowUpDraftSchema>;

export const UpdateFollowUpDraftSchema = z.object({
  channelType: channelTypeSchema.optional(),
  recipientOrTarget: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().min(1).optional(),
  status: draftStatusSchema.optional(),
}).refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided' });

export type UpdateFollowUpDraftInput = z.infer<typeof UpdateFollowUpDraftSchema>;

// ---------------------------------------------------------------------------
// Approval request schemas
// ---------------------------------------------------------------------------

export const CreateApprovalRequestSchema = z.object({
  taskId: z.string().optional(),
  draftId: z.string().optional(),
  actionType: approvalActionTypeSchema,
  /**
   * Opaque payload describing the external action.
   * SECURITY: Must not contain credentials or tokens — validate on execution.
   */
  payload: z.record(z.unknown()),
  expiresAt: z.string().datetime().optional(),
});

export type CreateApprovalRequestInput = z.infer<typeof CreateApprovalRequestSchema>;

// ---------------------------------------------------------------------------
// Agent schemas
// ---------------------------------------------------------------------------

const AgentTaskCandidateSchema = z.object({
  title: z.string().min(1).max(500),
  details: z.string().default(''),
  status: taskStatusSchema.default('reviewNeeded'),
  priority: taskPrioritySchema.default('normal'),
  requesterName: z.string().optional(),
  requesterContact: z.string().optional(),
  resourceType: resourceTypeSchema.default('other'),
  resourceLabel: z.string().optional(),
  resourceUrl: z.string().url().optional(),
  targetCompletionDate: z.string().datetime().optional(),
});

const AgentSummaryPayloadSchema = z.object({
  title: z.string().min(1).max(500),
  sourceType: sourceTypeSchema,
  sourceRefs: z.array(z.string()).default([]),
  rawText: z.string().min(1),
  structured: z.object({
    requester: z.string().optional(),
    requesterContact: z.string().optional(),
    mainAsk: z.string().optional(),
    deadline: z.string().optional(),
    risks: z.array(z.string()).default([]),
    dependencies: z.array(z.string()).default([]),
    sections: z.array(
      z.object({
        id: z.string(),
        heading: z.string(),
        body: z.string(),
        extractedBullets: z.array(z.string()).default([]),
      }),
    ).default([]),
  }),
  tags: z.array(z.string()).default([]),
  suggestedPriority: taskPrioritySchema.default('normal'),
  taskCandidates: z.array(AgentTaskCandidateSchema).default([]),
});

export const AgentRunResultsSchema = z.object({
  runType: z.enum(['scheduled', 'manual']).default('scheduled'),
  sourcesChecked: z.array(z.string()).default([]),
  summaries: z.array(AgentSummaryPayloadSchema),
});

export type AgentRunResultsInput = z.infer<typeof AgentRunResultsSchema>;
export type AgentTaskCandidateInput = z.infer<typeof AgentTaskCandidateSchema>;
export type AgentSummaryPayloadInput = z.infer<typeof AgentSummaryPayloadSchema>;

export const AgentCreateFollowUpDraftSchema = z.object({
  taskId: z.string().min(1),
  channelType: channelTypeSchema,
  recipientOrTarget: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().min(1),
});

export type AgentCreateFollowUpDraftInput = z.infer<typeof AgentCreateFollowUpDraftSchema>;

export const AgentCreateApprovalRequestSchema = z.object({
  taskId: z.string().optional(),
  draftId: z.string().optional(),
  actionType: approvalActionTypeSchema,
  payload: z.record(z.unknown()),
});

export type AgentCreateApprovalRequestInput = z.infer<typeof AgentCreateApprovalRequestSchema>;
