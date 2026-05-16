# TaskFlow API Reference

Base URL: configured per environment (see `docs/deployment.md`).
All endpoints are served via AWS API Gateway HTTP API backed by AWS Lambda.
All request and response bodies are `application/json`.
All timestamps are ISO-8601 strings (`2024-01-15T10:30:00.000Z`).

---

## Authentication

### Token types

**User token** — issued to the iOS app after login. Signed with `JWT_SECRET`. JWT payload must contain:
- `sub` — the user's `userId`
- `orgId` — the user's organisation ID
- `roles` — array of role strings (e.g., `["member"]`)

**Agent token** — issued to the GPT management agent. Signed with `AGENT_JWT_SECRET` (separate secret). JWT payload must contain:
- `userId` — owning user's ID (agent acts on behalf of this user)
- `orgId` — organisation ID
- `agentId` — stable agent identifier
- `scopes` — array of permission strings (e.g., `["agent:summaries:create", "agent:tasks:read"]`)

### Usage

All protected endpoints require:

```
Authorization: Bearer <token>
```

A missing or invalid token returns `401 Unauthorized`. An agent token presented to a user-only endpoint (or vice-versa) returns `401`. A valid token lacking the required scope returns `403 Forbidden`.

---

## Response envelope

**Success — list:**
```json
{ "items": [...], "total": 42 }
```

**Success — single object:** the object directly (no envelope wrapper).

**Error:**
```json
{ "error": "Human-readable error message" }
```

---

## Endpoints

### Health

#### `GET /health`

No authentication required.

**Response `200`:**
```json
{ "status": "ok", "timestamp": "2024-01-15T10:30:00.000Z" }
```

---

### Auth / Identity

#### `GET /me`

Returns the authenticated user's profile. Requires user token.

**Response `200`:**
```json
{
  "userId": "usr_abc123",
  "orgId": "org_xyz",
  "displayName": "Jane Smith",
  "email": "jane@example.com",
  "roles": ["member"]
}
```

---

### Summaries

#### `GET /summaries`

List all summaries for the authenticated user. Requires user token.

Query params: `sourceType` (optional filter), `reviewNeeded=true` (optional filter).

**Response `200`:**
```json
{
  "items": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d1",
      "userId": "usr_abc123",
      "orgId": "org_xyz",
      "title": "Q4 planning email thread",
      "sourceType": "email",
      "rawText": "...",
      "structured": {
        "requester": "Bob Jones",
        "mainAsk": "Approve Q4 budget by Friday",
        "deadline": "2024-10-11",
        "risks": ["Vendor delays"],
        "dependencies": ["Finance sign-off"],
        "sections": [
          {
            "id": "sec_1",
            "heading": "Action Items",
            "body": "Approve budget, schedule kickoff",
            "extractedBullets": ["Approve budget", "Schedule kickoff"]
          }
        ]
      },
      "tags": ["budget", "q4"],
      "suggestedPriority": "high",
      "reviewNeeded": true,
      "actionNeeded": true,
      "taskCandidateIds": ["cand_001"],
      "linkedTaskIds": [],
      "createdAt": "2024-10-09T08:00:00.000Z",
      "updatedAt": "2024-10-09T08:00:00.000Z"
    }
  ],
  "total": 1
}
```

#### `POST /summaries`

Create a summary manually. Requires user token.

**Request body:**
```json
{
  "title": "Support ticket #4821",
  "sourceType": "jira",
  "rawText": "Customer reported ...",
  "tags": ["support"]
}
```

**Response `201`:** the created summary object.

#### `GET /summaries/{id}`

Fetch a single summary. Requires user token. Returns `404` if not found or belongs to another user/org.

#### `PATCH /summaries/{id}`

Update mutable fields (`title`, `tags`, `structured`). Requires user token.

**Request body** (all fields optional):
```json
{ "title": "Updated title", "tags": ["q4", "approved"] }
```

**Response `200`:** the updated summary object.

#### `POST /summaries/{id}/task-candidates`

Add agent-proposed task candidates to an existing summary. Requires agent token with scope `agent:summaries:create`.

**Request body:**
```json
{
  "taskCandidates": [
    {
      "title": "Approve Q4 budget",
      "priority": "high",
      "resourceType": "email",
      "requesterName": "Bob Jones"
    }
  ]
}
```

**Response `200`:** the updated summary object.

#### `POST /summaries/{id}/accept-tasks`

Promote task candidates to real task documents. Requires user token.

**Request body:**
```json
{
  "tasks": [
    {
      "title": "Approve Q4 budget",
      "priority": "high",
      "resourceType": "email"
    }
  ]
}
```

**Response `200`:**
```json
{ "items": [{ "id": "64f...", "title": "Approve Q4 budget", "status": "new", ... }], "total": 1 }
```

#### `POST /summaries/{id}/archive`

Archive a summary. Requires user token. Sets `archivedAt`.

**Response `200`:** the updated summary object.

---

### Tasks

#### `GET /tasks`

List tasks for the authenticated user. Requires user token.

Query params: `status` (optional filter, e.g., `?status=new`), `priority` (optional filter).

**Response `200`:**
```json
{
  "items": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d2",
      "userId": "usr_abc123",
      "orgId": "org_xyz",
      "summaryId": "64f1a2b3c4d5e6f7a8b9c0d1",
      "title": "Approve Q4 budget",
      "details": "Bob needs sign-off by Friday EOD",
      "status": "new",
      "priority": "high",
      "requesterName": "Bob Jones",
      "requesterContact": "bob@example.com",
      "resourceType": "email",
      "resourceLabel": "Re: Q4 planning",
      "resourceUrl": null,
      "targetCompletionDate": "2024-10-11T17:00:00.000Z",
      "actualCompletionDate": null,
      "reviewedAt": null,
      "doneAt": null,
      "notes": "",
      "followUpDraftId": null,
      "createdBy": "agent",
      "createdAt": "2024-10-09T08:01:00.000Z",
      "updatedAt": "2024-10-09T08:01:00.000Z"
    }
  ],
  "total": 1
}
```

#### `POST /tasks`

Create a task. Requires user token. `userId` and `orgId` are set from the JWT; any values in the body for those fields are ignored.

**Request body:**
```json
{
  "title": "Approve Q4 budget",
  "details": "Bob needs sign-off by Friday EOD",
  "priority": "high",
  "resourceType": "email",
  "requesterName": "Bob Jones"
}
```

**Response `201`:** the created task object.

#### `GET /tasks/{id}`

Fetch a single task. Requires user token. Returns `404` if not found or belongs to another user/org.

#### `PATCH /tasks/{id}`

Update mutable task fields. Requires user token.

**Request body** (all fields optional):
```json
{
  "title": "Updated title",
  "notes": "Spoke to Bob — extending deadline by one week",
  "priority": "urgent"
}
```

**Response `200`:** the updated task object.

#### `POST /tasks/{id}/mark-reviewed`

Transition task to `reviewNeeded` status. Sets `reviewedAt`. Requires user token.

**Response `200`:** the updated task object.

#### `POST /tasks/{id}/mark-action-needed`

Transition task to `actionNeeded` status. Requires user token.

**Response `200`:** the updated task object.

#### `POST /tasks/{id}/mark-waiting`

Transition task to `waiting` status. Requires user token.

**Response `200`:** the updated task object.

#### `POST /tasks/{id}/mark-done`

Transition task to `done` status. Sets `doneAt` and `actualCompletionDate`. May trigger auto-creation of a follow-up draft. Requires user token.

**Response `200`:** the updated task object.

#### `POST /tasks/{id}/archive`

Archive a task (status → `archived`). Requires user token.

**Response `200`:** the updated task object.

---

### Follow-ups

#### `GET /followups`

List follow-up drafts for the authenticated user. Requires user token.

Query params: `status` (optional filter, e.g., `?status=draft`).

**Response `200`:**
```json
{
  "items": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d3",
      "taskId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "channelType": "email",
      "recipientOrTarget": "bob@example.com",
      "subject": "Re: Q4 planning — update",
      "body": "Hi Bob, just wanted to let you know...",
      "status": "draft",
      "createdBy": "agent",
      "createdAt": "2024-10-09T09:00:00.000Z",
      "updatedAt": "2024-10-09T09:00:00.000Z"
    }
  ],
  "total": 1
}
```

#### `POST /followups`

Create a follow-up draft. Requires user token. The `recipientOrTarget` field is treated as sensitive PII and is not logged.

**Request body:**
```json
{
  "taskId": "64f1a2b3c4d5e6f7a8b9c0d2",
  "channelType": "email",
  "recipientOrTarget": "bob@example.com",
  "subject": "Re: Q4 planning",
  "body": "Hi Bob, ..."
}
```

**Response `201`:** the created draft object.

#### `GET /followups/{id}`

Fetch a single follow-up draft. Requires user token.

#### `PATCH /followups/{id}`

Update draft fields (`body`, `subject`, `recipientOrTarget`). Requires user token.

**Response `200`:** the updated draft object.

#### `POST /followups/{id}/mark-reviewed`

Transition draft to `reviewed` status. Requires user token.

**Response `200`:** the updated draft object.

#### `POST /followups/{id}/approve`

Approve a draft for external sending (status → `approved`, sets `approvedAt`). Requires user token. No external message is sent by this endpoint; execution happens via the approval request pipeline.

**Response `200`:** the updated draft object.

#### `POST /followups/{id}/archive`

Archive a draft. Requires user token.

**Response `200`:** the updated draft object.

---

### Approvals

#### `GET /approval-requests`

List approval requests for the authenticated user. Requires user token.

Query params: `status` (optional filter, e.g., `?status=pending`).

**Response `200`:**
```json
{
  "items": [
    {
      "id": "64f1a2b3c4d5e6f7a8b9c0d4",
      "taskId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "draftId": "64f1a2b3c4d5e6f7a8b9c0d3",
      "actionType": "send_email",
      "status": "pending",
      "payload": { "to": "bob@example.com", "subject": "Re: Q4 planning" },
      "createdBy": "agent",
      "createdAt": "2024-10-09T09:01:00.000Z",
      "approvedAt": null
    }
  ],
  "total": 1
}
```

#### `POST /approval-requests`

Create an approval request. Requires user token or agent token with scope `agent:approvals:create`.

#### `POST /approval-requests/{id}/approve`

Approve an approval request (status → `approved`). Requires user token.

**Response `200`:** the updated approval request object.

#### `POST /approval-requests/{id}/reject`

Reject an approval request (status → `rejected`). Requires user token.

**Response `200`:** the updated approval request object.

#### `POST /approval-requests/{id}/mark-executed`

Mark an approval request as executed after the external action is complete (status → `executed`). Requires agent token with scope `agent:approvals:create` or a system process.

**Response `200`:** the updated approval request object.

---

### Agent

All agent endpoints require an agent Bearer token. The `userId` and `orgId` written to any created documents are always taken from the verified token — never from the request body.

#### `POST /agent/run-results`

Required scope: `agent:summaries:create`.

Submit the results of an agent run. The body must conform to the `AgentRunResultsPayload` schema (`/shared/schemas/agent.schema.json`).

**Request body:**
```json
{
  "runType": "scheduled",
  "sourcesChecked": ["inbox:jane@example.com", "slack:C0ABC123"],
  "summaries": [
    {
      "title": "Q4 planning email thread",
      "sourceType": "email",
      "rawText": "...",
      "structured": {
        "requester": "Bob Jones",
        "mainAsk": "Approve Q4 budget",
        "risks": [],
        "dependencies": [],
        "sections": []
      },
      "tags": ["q4"],
      "suggestedPriority": "high",
      "reviewNeeded": true,
      "actionNeeded": true,
      "taskCandidates": [
        {
          "title": "Approve Q4 budget",
          "priority": "high",
          "resourceType": "email"
        }
      ]
    }
  ]
}
```

**Response `201`:**
```json
{ "agentRunId": "64f...", "summaryIds": ["64f..."], "taskCandidateCount": 1 }
```

#### `GET /agent/pending-review`

Required scope: `agent:tasks:read`. Returns tasks with status `reviewNeeded` or `actionNeeded`.

**Response `200`:** `{ "items": [...], "total": N }` — same shape as `GET /tasks`.

#### `GET /agent/changes`

Required scope: `agent:tasks:read`. Returns tasks updated after a given timestamp.

Query params: `since` (ISO-8601, required).

**Response `200`:** `{ "items": [...], "total": N }`.

#### `POST /agent/followup-drafts`

Required scope: `agent:drafts:create`. Create one or more follow-up draft proposals.

**Request body:**
```json
{
  "drafts": [
    {
      "taskId": "64f...",
      "channelType": "email",
      "recipientOrTarget": "bob@example.com",
      "subject": "Re: Q4 planning",
      "body": "Hi Bob, ..."
    }
  ]
}
```

**Response `201`:** `{ "items": [...], "total": N }`.

#### `POST /agent/approval-requests`

Required scope: `agent:approvals:create`. Propose approval requests for external actions.

**Response `201`:** `{ "items": [...], "total": N }`.

---

### Audit

#### `GET /audit-events`

List audit events for the authenticated user's org. Requires user token with `admin` role (or equivalent).

Query params: `entityType` (optional), `entityId` (optional), `from` / `to` (ISO-8601 date range).

**Response `200`:**
```json
{
  "items": [
    {
      "id": "64f...",
      "actor": "user",
      "actorId": "usr_abc123",
      "action": "task.markDone",
      "entityType": "task",
      "entityId": "64f1a2b3c4d5e6f7a8b9c0d2",
      "before": { "status": "actionNeeded" },
      "after": { "status": "done", "doneAt": "2024-10-09T10:00:00.000Z" },
      "createdAt": "2024-10-09T10:00:00.000Z"
    }
  ],
  "total": 1
}
```

---

## Error codes

| HTTP status | Meaning |
|---|---|
| 400 | Bad request — validation error. `error` field describes the problem. |
| 401 | Authentication required or token invalid/expired. |
| 403 | Authenticated but lacking required scope or role. |
| 404 | Resource not found, or belongs to a different user/org. |
| 409 | Conflict — e.g., trying to approve an already-approved draft. |
| 500 | Internal server error. Logged server-side; generic message returned to client. |
