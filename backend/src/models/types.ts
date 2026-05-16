import { ObjectId } from 'mongodb';

export type TaskStatus = 'new' | 'reviewNeeded' | 'actionNeeded' | 'waiting' | 'done' | 'archived';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type ResourceType = 'email' | 'slack' | 'jira' | 'github' | 'document' | 'other';
export type ChannelType = 'email' | 'slack' | 'jira' | 'other';
export type DraftStatus = 'draft' | 'reviewed' | 'approved' | 'sentExternally' | 'archived';
export type SourceType = 'agent' | 'email' | 'slack' | 'jira' | 'manual' | 'import' | 'sample';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
export type ApprovalActionType = 'send_email' | 'send_slack' | 'comment_jira' | 'update_jira';
export type ActorType = 'user' | 'agent' | 'system';
export type AgentRunStatus = 'started' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// Base document — every collection document embeds userId + orgId for
// multi-tenant isolation. These fields are always sourced from the verified
// AuthContext, never from client-supplied request body.
// ---------------------------------------------------------------------------
export interface BaseDocument {
  _id?: ObjectId | string;
  userId: string;
  orgId: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Structured summary sub-documents
// ---------------------------------------------------------------------------
export interface SummarySection {
  id: string;
  heading: string;
  body: string;
  extractedBullets: string[];
}

export interface SummaryStructured {
  requester?: string;
  requesterContact?: string;
  mainAsk?: string;
  deadline?: string;
  risks: string[];
  dependencies: string[];
  sections: SummarySection[];
}

// ---------------------------------------------------------------------------
// Collection documents
// ---------------------------------------------------------------------------
export interface SummaryDoc extends BaseDocument {
  title: string;
  sourceType: SourceType;
  sourceRefs: string[];
  rawText: string;
  structured: SummaryStructured;
  tags: string[];
  suggestedPriority: TaskPriority;
  reviewNeeded: boolean;
  actionNeeded: boolean;
  taskCandidateIds: string[];
  linkedTaskIds: string[];
  archivedAt?: Date;
}

export interface TaskDoc extends BaseDocument {
  summaryId?: string;
  title: string;
  details: string;
  status: TaskStatus;
  priority: TaskPriority;
  requesterName?: string;
  requesterContact?: string;
  resourceType: ResourceType;
  resourceLabel?: string;
  resourceUrl?: string;
  targetCompletionDate?: Date;
  actualCompletionDate?: Date;
  reviewedAt?: Date;
  doneAt?: Date;
  notes: string;
  followUpDraftId?: string;
  archivedAt?: Date;
  createdBy: ActorType;
}

export interface FollowUpDraftDoc extends BaseDocument {
  taskId: string;
  channelType: ChannelType;
  recipientOrTarget?: string;
  subject?: string;
  body: string;
  status: DraftStatus;
  createdBy: ActorType;
  reviewedAt?: Date;
  approvedAt?: Date;
}

export interface ApprovalRequestDoc extends BaseDocument {
  taskId?: string;
  draftId?: string;
  actionType: ApprovalActionType;
  status: ApprovalStatus;
  /**
   * Opaque payload describing the external action to be taken if approved.
   * This is stored as-is and must be validated before any execution.
   * NEVER include plaintext credentials or tokens inside the payload.
   */
  payload: Record<string, unknown>;
  createdBy: ActorType;
  approvedAt?: Date;
  rejectedAt?: Date;
  executedAt?: Date;
  expiresAt?: Date;
}

export interface AuditEventDoc extends BaseDocument {
  actor: ActorType;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Snapshot of the document state before mutation (sanitised — no secrets). */
  before?: Record<string, unknown>;
  /** Snapshot of the document state after mutation (sanitised — no secrets). */
  after?: Record<string, unknown>;
}

export interface AgentRunDoc extends BaseDocument {
  runType: 'scheduled' | 'manual';
  status: AgentRunStatus;
  agentId: string;
  sourcesChecked: string[];
  summaryIds: string[];
  taskIds: string[];
  errorMessage?: string;
  completedAt?: Date;
}

export interface SourceRefDoc extends BaseDocument {
  sourceType: SourceType;
  externalId: string;
  externalUrl?: string;
  /** Raw content fetched from the external source. Treat as sensitive. */
  rawContent?: string;
  fetchedAt: Date;
}

export interface UserDoc {
  _id?: ObjectId | string;
  userId: string;
  orgId: string;
  displayName: string;
  email: string;
  roles: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// DTOs — what the API layer returns to clients.
// ObjectId _id is mapped to a plain string `id`. Internal MongoDB fields are
// never exposed directly. Dates are serialised as ISO-8601 strings.
// ---------------------------------------------------------------------------
export interface TaskDTO {
  id: string;
  userId: string;
  orgId: string;
  summaryId?: string;
  title: string;
  details: string;
  status: TaskStatus;
  priority: TaskPriority;
  requesterName?: string;
  requesterContact?: string;
  resourceType: ResourceType;
  resourceLabel?: string;
  resourceUrl?: string;
  targetCompletionDate?: string;
  actualCompletionDate?: string;
  reviewedAt?: string;
  doneAt?: string;
  notes: string;
  followUpDraftId?: string;
  createdBy: ActorType;
  createdAt: string;
  updatedAt: string;
}

export interface SummaryDTO {
  id: string;
  userId: string;
  orgId: string;
  title: string;
  sourceType: SourceType;
  rawText: string;
  structured: SummaryStructured;
  tags: string[];
  suggestedPriority: TaskPriority;
  reviewNeeded: boolean;
  actionNeeded: boolean;
  taskCandidateIds: string[];
  linkedTaskIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpDraftDTO {
  id: string;
  taskId: string;
  channelType: ChannelType;
  recipientOrTarget?: string;
  subject?: string;
  body: string;
  status: DraftStatus;
  createdBy: ActorType;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRequestDTO {
  id: string;
  taskId?: string;
  draftId?: string;
  actionType: ApprovalActionType;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  createdBy: ActorType;
  createdAt: string;
  approvedAt?: string;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Converts the _id field of any MongoDB document to a plain hex string.
 * Returns an empty string when _id is absent (e.g. before insert completes).
 */
export function toId(doc: { _id?: ObjectId | string }): string {
  if (!doc._id) return '';
  return doc._id instanceof ObjectId ? doc._id.toHexString() : doc._id.toString();
}

/**
 * Converts a Date to an ISO-8601 string, or returns undefined when the date
 * is absent. Used when building DTOs so the type system knows the output is
 * always a string when the input is a Date.
 */
export function toISOString(date: Date | undefined): string | undefined {
  return date?.toISOString();
}
