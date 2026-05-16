# TaskFlow Architecture

## Overview

TaskFlow is a three-layer system:

1. **iPhone SwiftUI app** — primary UI, local SwiftData cache for offline access and fast rendering
2. **AWS Lambda + API Gateway (HTTP API)** — stateless backend, system of record, enforces all authorization
3. **MongoDB Atlas** — cloud database, single `taskflow` database, accessible only from Lambda

The iOS app never talks to MongoDB directly. All state mutations go through the Lambda API, which verifies identity, enforces org-level isolation, and writes to MongoDB.

---

## Security Principles

- **userId is never trusted from the client body.** The `userId` and `orgId` placed on every document are always extracted from the verified JWT in the `Authorization: Bearer` header. Client-supplied `userId` fields in request bodies are silently ignored.
- **All queries are scoped by `userId` AND `orgId`.** Every MongoDB query in the repository layer includes both fields as mandatory filters. A valid token for org A cannot read data belonging to org B.
- **MongoDB is only reachable from Lambda.** The Atlas cluster IP allowlist contains only the Lambda VPC NAT gateway IPs (or Lambda IP ranges). No direct access from the internet or from the iOS app.
- **No secrets in code.** `MONGODB_URI`, `JWT_SECRET`, and `AGENT_JWT_SECRET` are injected at deploy time via environment variables sourced from AWS Systems Manager Parameter Store / Secrets Manager. The `.env.example` file contains placeholder values only and is the only `.env` file committed.
- **Agent tokens have explicit scopes.** Agent JWTs are signed with a separate secret (`AGENT_JWT_SECRET`) and must declare scopes (e.g., `agent:summaries:create`). A leaked user token cannot be used on agent-only endpoints, and vice-versa. Missing scopes are not granted implicitly.
- **External actions require explicit user approval.** The agent may propose follow-up drafts and approval requests, but no email, Slack message, or Jira comment is sent until the user approves through the iOS app. This approval is recorded with a timestamp in the `approvalRequests` collection.

---

## Data Flow

### Normal sync (user opens app)

```
iPhone app
  → GET /tasks (Bearer user JWT)
  → Lambda: verifyUserToken → extract userId + orgId from JWT
  → Lambda: taskRepo.list({ userId, orgId, ... })
  → MongoDB: db.tasks.find({ userId, orgId })
  → Lambda: serialise DTOs (ObjectId → string, Date → ISO-8601)
  → iPhone app: upsert into SwiftData local cache
  → SwiftUI renders from cache
```

### Agent run

```
GPT management agent
  → POST /agent/run-results (Bearer agent JWT)
  → Lambda: verifyAgentToken → extract userId + orgId + agentId + scopes
  → Lambda: requireScope(auth, 'agent:summaries:create')
  → Lambda: store summaries + task candidates under correct userId/orgId
  → Lambda: create AgentRunDoc for audit
  → iPhone app: next sync pulls new summaries
  → User reviews task candidates, taps Accept
  → POST /summaries/{id}/accept-tasks
  → Lambda: promotes candidates to real TaskDoc entries
```

### Task completion and follow-up

```
User marks task done in iOS app
  → POST /tasks/{id}/mark-done (Bearer user JWT)
  → Lambda: sets status=done, doneAt=now
  → Lambda: agent (or system) creates FollowUpDraftDoc (status=draft)
  → iPhone app: SyncService pulls new draft
  → User reviews draft body and recipient
  → User taps Approve
  → POST /followups/{id}/approve (Bearer user JWT)
  → Lambda: sets status=approved, approvedAt=now
  → Phase 2: ApprovalRequest executed → external message sent
```

---

## MongoDB Collections

The backend uses a single `taskflow` database containing the following nine collections:

| Collection | Description |
|---|---|
| `tasks` | Core task documents. Each task is owned by a `userId` + `orgId` pair. Tracks the full lifecycle from `new` through `done`/`archived`. |
| `summaries` | Summaries produced by the agent or entered manually. Hold structured extraction, task candidates, and links to accepted tasks. |
| `followupDrafts` | Draft follow-up messages (email, Slack, Jira comment). Created on task completion; require explicit user approval before any external send. |
| `approvalRequests` | Records of pending and executed approval actions. Provides an auditable gate before any external side-effect is performed. |
| `auditEvents` | Append-only log of all mutations. Every create/update/approve action writes a sanitised before/after snapshot. |
| `agentRuns` | One document per agent run. Records run type, sources checked, summaries created, tasks created, and final status. |
| `sourceRefs` | Raw content fetched from external sources (email bodies, Slack threads). Stored as sensitive data; not logged or exposed in list endpoints. |
| `users` | User profile and role information. `userId` and `orgId` are the primary identity fields on all cross-collection references. |
| `sessions` | (Reserved for Phase 2) Refresh token tracking and device session management. |

---

## Agent Integration

The GPT management agent is an external process that communicates with TaskFlow exclusively through the Lambda API. It has **no direct database access**.

**Authentication:** The agent presents a JWT signed with `AGENT_JWT_SECRET` (distinct from the user JWT secret). The token payload contains `userId`, `orgId`, `agentId`, and an explicit `scopes` array.

**Agent-specific endpoints:**

| Method | Path | Required scope | Purpose |
|---|---|---|---|
| `POST` | `/agent/run-results` | `agent:summaries:create` | Submit summaries and task candidates after a run |
| `GET` | `/agent/pending-review` | `agent:tasks:read` | Fetch tasks awaiting user review |
| `GET` | `/agent/changes` | `agent:tasks:read` | Fetch tasks updated since a given timestamp |
| `POST` | `/agent/followup-drafts` | `agent:drafts:create` | Create follow-up draft proposals |
| `POST` | `/agent/approval-requests` | `agent:approvals:create` | Propose approval requests for external actions |

**Data ownership:** All documents created through agent endpoints are stamped with the `userId` and `orgId` from the verified agent JWT, not from request body fields.

**Approval gate:** The agent never sends external messages directly. It creates `FollowUpDraftDoc` and `ApprovalRequestDoc` entries; the user must approve each one through the iOS app before any external action occurs.
