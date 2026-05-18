# Supabase API — Direct API Mode

This document describes the Direct API Mode for the workflow-app-supabase skill. Use it when an HTTP/API tool is available in the agent runtime and a secure `agent_connection_token` is provided by the runtime connection.

---

## When to Use Direct API Mode

Use Direct API Mode when:

- An HTTP or API tool is available in the agent runtime (e.g., a GPT Action, a Langchain tool, an OpenAI function tool, a Claude tool)
- A valid `agent_connection_token` has been provided securely by the runtime connection (e.g., as a stored GPT Action credential)
- The token has not been revoked

Fall back to Import JSON Mode (see `references/import-json-format.md`) when:

- No HTTP tool is available
- No token is available
- The API returns a 401 or 403 response

---

## Base URL

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1
```

Replace `YOUR_PROJECT_REF` with your Supabase project reference (found in the Supabase dashboard under Settings → API).

---

## Authentication

All requests must include:

```
X-Agent-Token: <agent_connection_token>
Content-Type: application/json
```

The `agent_connection_token` is generated in the workflow app under **Settings → Connect Agent → New Connection**. It is shown once and must be stored securely in the agent runtime's secret management (e.g., as a GPT Action credential). It must never appear in:

- The skill file
- The system prompt
- Any agent output
- Any log or audit record visible outside the app

---

## Endpoints

### GET /agent-context

Read the current app state for the authenticated user.

**Request:** No body required.

**Response (example):**

```json
{
  "open_tasks": [
    {
      "id": "uuid",
      "title": "Follow up with vendor on proposal",
      "status": "open",
      "priority": "medium",
      "due_at": null,
      "workflow_id": "uuid"
    }
  ],
  "recently_completed_tasks": [...],
  "recent_task_events": [...],
  "recent_summaries": [...],
  "active_workflows": [
    {
      "id": "uuid",
      "name": "Customer Follow-Up Triage",
      "status": "active"
    }
  ]
}
```

**Always call this endpoint before creating tasks or summaries.** It provides the data needed to prevent duplicates and ground your output in real state.

---

### POST /agent-write

Create summaries, tasks, agent messages, and workflow runs.

**Request body:**

```json
{
  "summaries": [
    {
      "title": "Daily Planning — YYYY-MM-DD",
      "content": "Operational briefing content here.",
      "workflow_id": null
    }
  ],
  "tasks": [
    {
      "title": "Investigate staging pipeline failure",
      "description": "Pipeline failing since yesterday. Check recent deploys and infra logs.",
      "priority": "high",
      "due_at": null,
      "workflow_id": "uuid-of-workflow-if-known"
    }
  ],
  "agent_messages": [
    {
      "content": "Daily planning complete. Created 2 tasks and 1 summary.",
      "role": "agent"
    }
  ],
  "workflow_runs": [
    {
      "workflow_id": "uuid-of-workflow",
      "status": "completed",
      "output": {
        "tasks_created": 2,
        "summaries_created": 1
      }
    }
  ]
}
```

**Notes:**
- All arrays are optional. Omit any array you have nothing to write for.
- `user_id` must never be included in the body — it is resolved server-side from the token.
- `workflow_id` for tasks/summaries should come from the `agent-context` response, not from memory.
- Task `status` is always set to `open` server-side regardless of what the body says.

**Response (example):**

```json
{
  "summaries": [{ "id": "uuid", "title": "...", "created_at": "..." }],
  "tasks": [{ "id": "uuid", "title": "...", "status": "open", "priority": "high", "created_at": "..." }],
  "agent_messages": [{ "id": "uuid", "role": "agent", "created_at": "..." }]
}
```

Confirm the write only when the response returns record IDs. If the response does not include IDs, do not tell the user the records were saved.

---

### POST /agent-update-task

Update an existing task's status, priority, or description.

**Request body:**

```json
{
  "task_id": "uuid-of-existing-task",
  "status": "done",
  "priority": "high",
  "description": "Updated: confirmed complete after code review."
}
```

**Notes:**
- `task_id` must come from the `agent-context` response (from `open_tasks[].id`). Do not guess or construct task IDs.
- Only include fields you want to update. Omitted fields are not changed.
- Do not update `user_id`, `source`, or `created_at`.
- Valid `status` values: `open`, `in_progress`, `done`, `waiting`, `archived`.
- Valid `priority` values: `low`, `medium`, `high`, `critical`.

**Response (example):**

```json
{
  "task": { "id": "uuid", "title": "...", "status": "done", "updated_at": "..." }
}
```

---

## Error Handling

| HTTP Status | Meaning | Agent action |
|-------------|---------|--------------|
| `200` / `201` | Success | Confirm write using returned IDs |
| `400` | Bad request — invalid body | Check payload format; do not retry with the same payload |
| `401` | Unauthorized — token invalid or missing | Do not retry; fall back to Import JSON Mode and inform the user |
| `403` | Forbidden — token revoked or insufficient scope | Do not retry; inform the user the connection may need to be re-established |
| `404` | Endpoint not found | Check the base URL; do not retry |
| `500` | Server error | May retry once after a brief pause; if it fails again, fall back to Import JSON Mode |

---

## Security Rules

These rules are non-negotiable:

1. **The token must never appear in skill files, system prompts, or agent output.** It must be provided and stored by the runtime's secret management only.

2. **Never ask the user for the service role key.** The agent never needs it and must never request it. The service role key lives in Edge Function environment variables only.

3. **Never infer or construct `user_id`.** The server resolves it from the token. Any body-supplied `user_id` is ignored.

4. **Never imply success without explicit API confirmation.** If the API does not return success with record IDs, tell the user the write may not have succeeded.

5. **Fall back to Import JSON Mode when direct API mode is unavailable or fails.** Import JSON Mode is always the safe fallback — it never risks a partial or incorrect write.

6. **Never retry a 401 or 403 response.** These indicate an authentication problem that requires the user to regenerate the connection token.
