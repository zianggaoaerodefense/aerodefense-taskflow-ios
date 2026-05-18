# Agent Setup Guide

This guide explains how to configure an AI agent to interact with the Daily Workflow Management App. The agent is a **separate runtime** from the mobile app — it reads context from your work tools, generates summaries and tasks, and writes structured data into Supabase via Edge Functions.

---

## Overview

The agent's job is to:

1. Collect context from user-authorised sources (email, calendar, Jira, Slack, GitHub, notes, etc.)
2. Read the current workflow state (open tasks, recent summaries, completed tasks, user feedback)
3. Summarise important updates
4. Extract actionable tasks
5. Write structured records into Supabase via Edge Functions
6. Avoid duplicating tasks that already exist
7. Respect user feedback from the app (rejected tasks, comments, completions)

---

## Supported Agent Runtimes

This app is not tied to any specific AI provider or runtime. You can use:

| Runtime | Notes |
|---------|-------|
| **ChatGPT Custom GPT** | Configure GPT Actions to call the Edge Functions |
| **Claude (Anthropic)** | Use the API directly or via a script |
| **OpenAI API** | Use function calling or a simple script |
| **Custom Python/Node.js script** | Full control, runs on any scheduler |
| **GitHub Actions** | Triggered on a schedule (`cron`) |
| **AWS Lambda** | Scheduled via EventBridge |
| **Supabase Edge Functions** | Can call external APIs and write to the database |
| **Any HTTP-capable scheduler** | As long as it can make authenticated HTTPS requests |

---

## Step 1: Generate an Agent Connection Token

The agent authenticates with a per-user token that you generate inside the mobile app.

1. Open the mobile app and sign in.
2. Go to **Settings → Connect Agent → New Connection**.
3. Give the connection a label (e.g., "Morning workflow agent").
4. Copy the token shown once — it will not be displayed again.
5. Store the token securely in your agent's environment variables or secrets store.

> The raw token is never stored by the app. Only its SHA-256 hash is kept in the database. If you lose the token, revoke the connection and generate a new one.

---

## Step 2: Configure Your Agent Runtime

Set the following in your agent's environment:

```env
# Your Supabase project URL
SUPABASE_URL=https://your-project-ref.supabase.co

# The agent connection token you generated in step 1
AGENT_TOKEN=your-agent-connection-token
```

**Never** put these in the mobile app's environment or commit them to the repository.

---

## Step 3: Edge Function Endpoints

All agent communication goes through Supabase Edge Functions. The base URL for all endpoints is:

```
https://your-project-ref.supabase.co/functions/v1/
```

Authentication for all agent requests: include the token in the `X-Agent-Token` header.

### GET `/functions/v1/agent-context`

Returns the current workflow state for the authenticated user.

**Request:**
```
GET /functions/v1/agent-context
X-Agent-Token: your-agent-token
```

**Response includes:**
- Open tasks (up to 50)
- Recently completed tasks (last 30 days, up to 20)
- Recent task events (last 7 days, up to 50)
- Active workflows (up to 20)
- Recent summaries (last 30 days, up to 10)
- Recent agent messages (up to 20)

### POST `/functions/v1/agent-write`

Write summaries, tasks, and agent messages.

**Request:**
```
POST /functions/v1/agent-write
X-Agent-Token: your-agent-token
Content-Type: application/json

{
  "summary": { ... },
  "tasks": [ ... ],
  "agent_message": { ... }
}
```

### POST `/functions/v1/agent-update-task`

Update an existing task.

**Request:**
```
POST /functions/v1/agent-update-task
X-Agent-Token: your-agent-token
Content-Type: application/json

{
  "task_id": "uuid-of-task",
  "status": "done",
  "description": "Updated description"
}
```

---

## Expected Agent Payload Format

The `agent-write` endpoint accepts this JSON structure:

```json
{
  "summary": {
    "title": "Daily Workflow Summary — 2024-01-15",
    "content": "Short overview of today's work context and highlights.",
    "workflow_id": null
  },
  "tasks": [
    {
      "title": "Follow up on project update",
      "description": "Send a short status update to the team by end of day.",
      "priority": "medium",
      "status": "open",
      "source": "agent",
      "due_at": null,
      "workflow_id": null
    },
    {
      "title": "Review open pull requests",
      "description": "Three PRs are waiting for review in the main repo.",
      "priority": "high",
      "status": "open",
      "source": "agent",
      "due_at": "2024-01-15T17:00:00Z",
      "workflow_id": null
    }
  ],
  "agent_message": {
    "content": "Morning workflow complete. Created 2 tasks based on email and GitHub activity.",
    "role": "agent"
  }
}
```

**Field notes:**

- `user_id` must NOT be included in the payload — it is resolved server-side from the agent token.
- `priority`: `low`, `medium`, `high`, or `critical`
- `status`: typically `open` or `suggested` for new agent-created tasks
- `due_at`: ISO 8601 datetime string or `null`
- All string fields have maximum lengths enforced by the Edge Function

---

## Agent Inputs (What the Agent Should Read)

Before generating output, the agent should call `agent-context` and read:

| Input | Where it comes from |
|-------|-------------------|
| Previous open tasks | `open_tasks` in agent-context response |
| Recently completed tasks | `recently_completed_tasks` in agent-context response |
| Recent task events | `recent_task_events` in agent-context response (user feedback, status changes) |
| Active workflows | `active_workflows` in agent-context response |
| Recent summaries | `recent_summaries` in agent-context response |
| Email | Your email integration (Gmail API, IMAP, etc.) |
| Calendar events | Google Calendar, Outlook, etc. |
| Jira issues | Jira REST API |
| Slack messages | Slack API |
| GitHub PRs/issues | GitHub API |
| Manual notes | Provided by user or read from a notes file |

---

## Agent Integration Patterns

### Option A: Agent writes through Edge Functions (recommended)

The agent authenticates with an agent token and calls Edge Functions directly. The service role key stays inside the Edge Functions — the agent never sees it.

```
Agent → X-Agent-Token → Edge Function → service role → Postgres
```

This is the pattern implemented in this repository.

### Option B: Agent writes via a backend API

You can build a backend API that the agent calls, which then uses the Supabase service role key to write to the database. Useful if you want to add additional validation or rate limiting.

### Option C: Manual JSON import

For testing or one-off use, the agent creates a JSON file that the user pastes into the **Import** screen in the mobile app. The app validates and imports the payload using `agentImport.ts`. See `agent/examples/` for example payloads.

---

## Security Rules for Agent Integration

- **Do not put the Supabase service role key in the mobile app.** It belongs only in server-side environments.
- **Do not expose private OAuth tokens in the repository.** Store them in environment variables or a secrets manager.
- **Do not hard-code user IDs.** `user_id` is always resolved server-side from the agent token.
- **Prefer storing summaries and references over raw sensitive content.** Do not store full email bodies, raw Slack message history, or raw Jira content unless the user explicitly wants that and understands the privacy implications.
- **Give the agent minimum required permissions.** Only authorise the integrations you actually need.
- **Review generated tasks before acting on them.** The agent can hallucinate or create low-quality tasks.
- **Avoid auto-sending emails or changing external systems** without explicit user approval in the mobile app.
- **Log agent actions.** The `audit_logs` table captures all agent writes and task updates.

---

## Example: ChatGPT Custom GPT Configuration

If you are using a ChatGPT Custom GPT as your agent runtime:

1. In the ChatGPT Custom GPT editor, go to **Actions**.
2. Import the OpenAPI schema from `docs/chatgpt-agent-actions.md` (or `docs/gpt-actions-openapi.yaml` if present).
3. Set the authentication method to **Custom Header**.
4. Header name: `X-Agent-Token`
5. Header value: your agent connection token from step 1.

The GPT will then be able to call `agent-context`, `agent-write`, and `agent-update-task` on your behalf.

---

## Example: Simple Python Script

```python
import os
import requests
from datetime import date

SUPABASE_URL = os.environ["SUPABASE_URL"]
AGENT_TOKEN = os.environ["AGENT_TOKEN"]

headers = {
    "X-Agent-Token": AGENT_TOKEN,
    "Content-Type": "application/json",
}

# 1. Read current context
context_resp = requests.get(
    f"{SUPABASE_URL}/functions/v1/agent-context",
    headers=headers,
)
context = context_resp.json()
open_tasks = context.get("open_tasks", [])

# 2. (Your AI logic here — call OpenAI, Claude, etc. to generate summary + tasks)
# summary_text = call_llm(open_tasks, ...)
# new_tasks = extract_tasks(summary_text)

# 3. Write back to Supabase
payload = {
    "summary": {
        "title": f"Daily Workflow Summary — {date.today()}",
        "content": "Example summary content.",
    },
    "tasks": [
        {
            "title": "Example task from agent",
            "priority": "medium",
            "status": "open",
            "source": "agent",
        }
    ],
}

write_resp = requests.post(
    f"{SUPABASE_URL}/functions/v1/agent-write",
    headers=headers,
    json=payload,
)
print(write_resp.json())
```

---

## Scheduling the Agent

For persistent daily workflow automation, you need an external scheduler. Options:

| Scheduler | How |
|-----------|-----|
| **cron (Linux/macOS)** | `0 8 * * 1-5 /path/to/your/agent-script.sh` |
| **GitHub Actions** | `on: schedule: - cron: '0 8 * * 1-5'` |
| **AWS EventBridge** | Trigger a Lambda function on a schedule |
| **Supabase Edge Functions** | Use pg_cron or an external trigger |
| **Zapier / Make** | No-code workflow automation |
| **Hosted agent platform** | Various commercial options |

---

## Workflow Skills

The `agent/skills/` directory documents reusable workflow instruction packages. See `agent/skills/README.md` for the full list and how to use them.

Example prompt files in `agent/prompts/`:

- `daily_summary.md` — instructions for generating a daily workflow summary
- `task_extraction.md` — instructions for extracting actionable tasks
- `workflow_update.md` — instructions for updating workflow state
- `security_rules.md` — mandatory security constraints for the agent
