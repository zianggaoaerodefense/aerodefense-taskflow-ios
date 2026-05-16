# Agent Workflow

This document describes how the GPT management agent integrates with the
TaskFlow backend. It is written for both human reviewers and as a reference
for the agent's own system prompt.

---

## Overview

The agent is an autonomous process (currently a GPT-based scheduled job) that:

1. Reads approved external sources (Gmail, Slack, Jira, Drive, Calendar).
2. Produces structured work summaries with task candidates.
3. Submits those summaries to the Lambda backend.
4. Later reads pending review items or recent changes.
5. Drafts follow-up communications for CTO review.
6. Creates approval requests for actions that require CTO sign-off.

**The agent never sends anything externally without explicit CTO approval.**
All external-action capabilities are deferred to Phase 3 and gated behind
`approval_requests`.

---

## Authentication

The agent uses a dedicated JWT distinct from user JWTs:

```
Header: Authorization: Bearer <AGENT_JWT>
```

Agent tokens are signed with `AGENT_JWT_SECRET` (separate from `JWT_SECRET`).
The payload must include:

```json
{
  "userId": "<cto-user-id>",
  "orgId": "<org-id>",
  "agentId": "<agent-identifier>",
  "scopes": ["agent:summaries:create", "agent:tasks:read", ...]
}
```

`userId` identifies the CTO whose data the agent manages. The backend derives
this from the token — the agent must never send `userId` in request bodies.

### Issuing a token (local dev)

```bash
node -e "
const jwt = require('jsonwebtoken');
console.log(jwt.sign(
  { userId: 'USER_ID', orgId: 'ORG_ID', agentId: 'gpt-agent-v1',
    scopes: ['agent:summaries:create','agent:tasks:read','agent:tasks:suggest',
             'agent:followups:draft','agent:approvals:create'] },
  process.env.AGENT_JWT_SECRET,
  { expiresIn: '30d' }
));
"
```

---

## Scopes

| Scope | Endpoint | Description |
|-------|----------|-------------|
| `agent:summaries:create` | `POST /agent/run-results` | Submit summaries and task candidates |
| `agent:tasks:read` | `GET /agent/pending-review`, `GET /agent/changes` | Read tasks |
| `agent:tasks:suggest` | Reserved for future endpoint | Propose task edits |
| `agent:followups:draft` | `POST /agent/followup-drafts` | Create follow-up drafts |
| `agent:approvals:create` | `POST /agent/approval-requests` | Create approval requests |

The agent does **not** have `tasks:write`, `tasks:delete`, or any external-send scope.

---

## Endpoint Reference

### POST /agent/run-results

Submit the result of a scheduled or manual agent run. Creates summaries and
task candidates in MongoDB under the authenticated userId.

**Required scope:** `agent:summaries:create`

**Request body:**

```json
{
  "runType": "scheduled",
  "sourcesChecked": ["gmail", "slack"],
  "summaries": [
    {
      "title": "Q3 Finance Review — Email thread with Alice",
      "sourceType": "email",
      "rawText": "Alice asked for a status on the Q3 report...",
      "structured": {
        "requester": "Alice Chen",
        "requesterContact": "alice@example.com",
        "mainAsk": "Provide Q3 report status by Friday",
        "deadline": "2024-10-04",
        "risks": ["Budget overrun if delayed"],
        "dependencies": ["Finance team sign-off"],
        "sections": [
          {
            "id": "s1",
            "heading": "Main request",
            "body": "Alice needs the Q3 status report.",
            "extractedBullets": ["Send Q3 report by Friday", "CC finance team"]
          }
        ]
      },
      "tags": ["q3", "finance", "alice"],
      "suggestedPriority": "high",
      "taskCandidates": [
        {
          "title": "Send Q3 report to Alice",
          "details": "Alice Chen requested Q3 status by Friday 2024-10-04.",
          "status": "reviewNeeded",
          "priority": "high",
          "resourceType": "email",
          "requesterName": "Alice Chen",
          "requesterContact": "alice@example.com"
        }
      ]
    }
  ]
}
```

**Response (201):**

```json
{
  "runId": "...",
  "status": "completed",
  "summariesCreated": 1,
  "tasksCreated": 1,
  "summaryIds": ["..."],
  "taskIds": ["..."]
}
```

**Behaviour:**
- Creates an `AgentRun` document (started → completed).
- Inserts each summary with `reviewNeeded: true`.
- Inserts task candidates with `status: reviewNeeded` and `createdBy: 'agent'`.
- Emits audit events for each summary and task.

---

### GET /agent/pending-review

Returns tasks with `status: reviewNeeded` that are waiting for CTO action.

**Required scope:** `agent:tasks:read`

**Response (200):**

```json
{
  "tasks": [
    {
      "id": "...",
      "title": "Send Q3 report to Alice",
      "status": "reviewNeeded",
      "priority": "high",
      "updatedAt": "2024-10-01T10:00:00Z"
    }
  ]
}
```

---

### GET /agent/changes?since=<ISO-8601>

Returns tasks, follow-up drafts, and approval requests updated since the
given timestamp. Defaults to the last 24 hours.

**Required scope:** `agent:tasks:read`

**Query parameters:**
- `since` — ISO-8601 datetime (e.g. `2024-10-01T00:00:00Z`). Defaults to 24h ago.

**Response (200):**

```json
{
  "since": "2024-10-01T00:00:00Z",
  "tasks": [...],
  "followupDrafts": [...],
  "approvals": [...]
}
```

---

### POST /agent/followup-drafts

Creates a single follow-up draft for CTO review. The draft is NOT sent
externally — it enters status `draft` and waits for CTO approval.

**Required scope:** `agent:followups:draft`

**Request body:**

```json
{
  "taskId": "<task-id>",
  "channelType": "email",
  "recipientOrTarget": "alice@example.com",
  "subject": "Follow-up: Q3 report status",
  "body": "Hi Alice,\n\nI wanted to follow up..."
}
```

**Response (201):**

```json
{
  "followupDraft": {
    "id": "...",
    "taskId": "...",
    "channelType": "email",
    "status": "draft",
    "createdAt": "..."
  }
}
```

---

### POST /agent/approval-requests

Creates an approval request for an action that requires CTO sign-off.
The request is created with `status: pending` — the agent cannot approve
or execute it.

**Required scope:** `agent:approvals:create`

**Request body:**

```json
{
  "taskId": "<task-id>",
  "draftId": "<draft-id>",
  "actionType": "send_email",
  "payload": {
    "to": "alice@example.com",
    "subject": "Follow-up: Q3 report",
    "body": "Hi Alice..."
  }
}
```

**Response (201):**

```json
{
  "approvalRequest": {
    "id": "...",
    "actionType": "send_email",
    "status": "pending",
    "taskId": "...",
    "draftId": "...",
    "createdAt": "..."
  }
}
```

**Important:** `payload` must never contain credentials, tokens, or
authentication material. It is stored opaquely and validated at execution time.

---

## Typical run lifecycle

```
1. Agent wakes (scheduled or manual)
2. POST /agent/run-results          → summaries + tasks created (reviewNeeded)
3. GET  /agent/pending-review       → agent sees what needs attention
4. GET  /agent/changes?since=...    → agent sees recent updates
5. POST /agent/followup-drafts      → agent proposes follow-up text
6. POST /agent/approval-requests    → agent requests permission to send

7. CTO reviews in iPhone app:
   - Accepts/edits task candidates  → POST /summaries/:id/accept-tasks
   - Reviews follow-up draft        → POST /followups/:id/mark-reviewed
   - Approves draft                 → POST /followups/:id/approve
   - Approves external action       → POST /approval-requests/:id/approve
   - Marks executed (Phase 3)       → POST /approval-requests/:id/mark-executed
```

---

## Security constraints on the agent

| Constraint | Enforcement |
|-----------|-------------|
| Cannot read other users' data | Token carries `userId`; repo filters by `userId + orgId` |
| Cannot write tasks directly | No `tasks:write` scope; tasks come via `run-results` |
| Cannot approve its own requests | `insertApproval` hardcodes `status: 'pending'` |
| Cannot send externally | No send-scoped endpoints exist in current phase |
| Cannot escalate privileges | Scopes are read from the verified JWT payload only |

---

## Phase 3 additions (not yet built)

- Actual email send via SES after approval
- Actual Slack post via Slack API after approval
- Jira comment via Jira API after approval
- Agent read access to Gmail/Slack/Jira (OAuth integration)
- Webhook triggers instead of polling for changes
