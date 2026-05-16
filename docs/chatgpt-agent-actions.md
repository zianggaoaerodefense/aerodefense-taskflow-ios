# ChatGPT Agent Actions — Configuration Guide

This document describes how to configure the TaskFlow Custom GPT to interact with the Supabase Edge Function API.

---

## Overview

The ChatGPT agent communicates with TaskFlow exclusively through Supabase Edge Functions. It has no direct database access. All requests are authenticated with an agent connection token that the user generates in the iOS app.

**Data flow:**

```
ChatGPT Custom GPT
    ↓  X-Agent-Token header
Supabase Edge Function (HTTPS)
    ↓  service role (server-side only)
Supabase Postgres (row scoped to token owner)
    ↓  Realtime / pull
iOS app
```

---

## Authentication

Every agent request must include the `X-Agent-Token` header:

```
X-Agent-Token: <raw-token-from-ios-app>
```

The token is generated in the iOS app under **Settings → Connect ChatGPT Agent**. It maps to a specific user account. The Edge Function hashes the token with SHA-256 and looks it up in `agent_connections`. Only `active` tokens within their expiry are accepted.

**Never include a Supabase service role key or anon key in the GPT configuration.** Use only the `X-Agent-Token` mechanism.

---

## Base URL

```
https://<your-supabase-project-ref>.supabase.co/functions/v1
```

Replace `<your-supabase-project-ref>` with your actual Supabase project reference ID.

---

## GPT Interaction Rules

1. **Always call `agent-context` first** before making any task decisions or writes.
2. **Never invent task IDs.** All `task_id` values used in `agent-update-task` must come from `agent-context` response.
3. Use `agent-write` to create summaries, tasks, or messages.
4. Use `agent-update-task` to update the status or details of an existing task.

---

## OpenAPI Schema

Paste the following into your Custom GPT action configuration.

```yaml
openapi: "3.1.0"
info:
  title: TaskFlow Agent API
  description: |
    Supabase Edge Function API for the TaskFlow ChatGPT agent.
    All endpoints require the X-Agent-Token header.
    Always call /agent-context before writing or updating tasks.
  version: "1.0.0"

servers:
  - url: https://<your-supabase-project-ref>.supabase.co/functions/v1
    description: Supabase Edge Functions

components:
  securitySchemes:
    AgentToken:
      type: apiKey
      in: header
      name: X-Agent-Token

  schemas:
    Task:
      type: object
      properties:
        id:
          type: string
          format: uuid
        title:
          type: string
        description:
          type: string
          nullable: true
        status:
          type: string
          enum: [open, in_progress, waiting, done, archived]
        priority:
          type: string
          enum: [low, medium, high, critical]
        due_at:
          type: string
          format: date-time
          nullable: true
        created_at:
          type: string
          format: date-time
        updated_at:
          type: string
          format: date-time

    TaskEvent:
      type: object
      properties:
        id:
          type: string
          format: uuid
        task_id:
          type: string
          format: uuid
        actor:
          type: string
          enum: [user, agent, system]
        event_type:
          type: string
        previous_status:
          type: string
          nullable: true
        new_status:
          type: string
          nullable: true
        created_at:
          type: string
          format: date-time

    Summary:
      type: object
      properties:
        id:
          type: string
          format: uuid
        title:
          type: string
        content:
          type: string
        source:
          type: string
          nullable: true
        created_at:
          type: string
          format: date-time

    AgentMessage:
      type: object
      properties:
        id:
          type: string
          format: uuid
        role:
          type: string
          enum: [agent, system]
        content:
          type: string
        created_at:
          type: string
          format: date-time

    Workflow:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        description:
          type: string
          nullable: true
        status:
          type: string

    Error:
      type: object
      properties:
        error:
          type: string

security:
  - AgentToken: []

paths:
  /agent-context:
    get:
      operationId: getAgentContext
      summary: Get current workflow context
      description: |
        Returns the authenticated user's current workflow state:
        open tasks, recently completed tasks, recent task events,
        active workflows, recent summaries, and recent agent messages.
        Call this before making any task decisions or writes.
      responses:
        "200":
          description: Current workflow context
          content:
            application/json:
              schema:
                type: object
                properties:
                  as_of:
                    type: string
                    format: date-time
                  open_tasks:
                    type: array
                    items:
                      $ref: "#/components/schemas/Task"
                  recently_completed_tasks:
                    type: array
                    items:
                      $ref: "#/components/schemas/Task"
                  recent_task_events:
                    type: array
                    items:
                      $ref: "#/components/schemas/TaskEvent"
                  active_workflows:
                    type: array
                    items:
                      $ref: "#/components/schemas/Workflow"
                  recent_summaries:
                    type: array
                    items:
                      $ref: "#/components/schemas/Summary"
                  recent_agent_messages:
                    type: array
                    items:
                      $ref: "#/components/schemas/AgentMessage"
        "401":
          description: Unauthorized — invalid or expired agent token
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"

  /agent-write:
    post:
      operationId: agentWrite
      summary: Write summaries, tasks, messages, or workflow runs
      description: |
        Creates new records on behalf of the authenticated user.
        Accepts any combination of summaries, tasks, agent_messages,
        and workflow_runs. user_id is always derived from the agent
        token — never pass it in the request body.
        Every created task also receives a task_events record.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                summaries:
                  type: array
                  items:
                    type: object
                    required: [title, content]
                    properties:
                      title:
                        type: string
                        maxLength: 500
                      content:
                        type: string
                      workflow_id:
                        type: string
                        format: uuid
                tasks:
                  type: array
                  items:
                    type: object
                    required: [title]
                    properties:
                      title:
                        type: string
                        maxLength: 500
                      description:
                        type: string
                      priority:
                        type: string
                        enum: [low, medium, high, critical]
                        default: medium
                      due_at:
                        type: string
                        format: date-time
                      workflow_id:
                        type: string
                        format: uuid
                agent_messages:
                  type: array
                  items:
                    type: object
                    required: [content]
                    properties:
                      role:
                        type: string
                        enum: [agent, system]
                        default: agent
                      content:
                        type: string
                      context:
                        type: object
                workflow_runs:
                  type: array
                  items:
                    type: object
                    properties:
                      workflow_id:
                        type: string
                        format: uuid
                      status:
                        type: string
                        enum: [running, completed, failed]
                        default: completed
                      output:
                        type: object
      responses:
        "200":
          description: Created records
          content:
            application/json:
              schema:
                type: object
                properties:
                  summaries:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                        title:
                          type: string
                        created_at:
                          type: string
                  tasks:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: string
                        title:
                          type: string
                        status:
                          type: string
                        priority:
                          type: string
                        created_at:
                          type: string
                  agent_messages:
                    type: array
                    items:
                      type: object
                  workflow_runs:
                    type: array
                    items:
                      type: object
        "400":
          description: Invalid request body
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "401":
          description: Unauthorized
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"

  /agent-update-task:
    post:
      operationId: agentUpdateTask
      summary: Update an existing task
      description: |
        Updates the status or details of a task that belongs to the
        authenticated user. The task_id must be retrieved from
        agent-context — never guess or construct IDs.
        Also inserts a task_events row describing the change.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [task_id]
              properties:
                task_id:
                  type: string
                  format: uuid
                  description: Must come from agent-context response
                status:
                  type: string
                  enum: [open, in_progress, waiting, done, archived]
                title:
                  type: string
                  maxLength: 500
                description:
                  type: string
                priority:
                  type: string
                  enum: [low, medium, high, critical]
                due_at:
                  type: string
                  format: date-time
                  nullable: true
      responses:
        "200":
          description: Updated task
          content:
            application/json:
              schema:
                type: object
                properties:
                  task:
                    $ref: "#/components/schemas/Task"
        "400":
          description: Missing or invalid fields
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "401":
          description: Unauthorized
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "403":
          description: Task does not belong to the authenticated user
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "404":
          description: Task not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
```

---

## Custom GPT Setup Steps

1. Go to **ChatGPT → Explore GPTs → Create a GPT**.
2. In the **Configure** tab, fill in the GPT name and system prompt.
3. Under **Actions**, click **Create new action**.
4. Paste the OpenAPI schema above, replacing `<your-supabase-project-ref>`.
5. Under **Authentication**, select **API Key** and configure:
   - **Auth Type:** `Custom`
   - **Header name:** `X-Agent-Token`
   - **API Key:** the raw token from the iOS app (**Settings → Connect ChatGPT Agent**)
6. Save the action and test it.

---

## Suggested System Prompt Snippet

Add the following to your Custom GPT system prompt:

```
You are a workflow management assistant for [user name].
Before making any task decisions, always call getAgentContext to retrieve
the current state of open tasks, recent events, and active workflows.

Rules:
- Never invent or guess task IDs. Only use IDs returned by getAgentContext.
- When the user asks you to create a task, call agentWrite with the task details.
- When the user asks you to update a task, call agentUpdateTask with the task_id
  from context and only the fields that need to change.
- When summarising a meeting or document, call agentWrite with the summary.
- Do not attempt to read or write the database directly.
```

---

## Token Lifecycle

| Event | What happens |
|---|---|
| User generates token in iOS app | Raw token returned once; hash stored in `agent_connections` |
| GPT sends request with `X-Agent-Token` | Edge Function hashes the header value and looks it up |
| Token matches active, non-expired row | Request proceeds; `last_used_at` updated |
| User revokes in iOS app | `status` set to `revoked`; all subsequent requests return 401 |
| Token expires (`expires_at` in past) | Requests return 401; user must create a new connection |

---

## Security Notes

- The `X-Agent-Token` is equivalent to a password for the connected user's data. Treat it as a secret. Do not log it or include it in error messages.
- If a token is compromised, revoke it immediately in **Settings → Connect ChatGPT Agent**.
- The agent can only read and write data for the user whose token it holds.
- The agent cannot access another user's data even if it knows their `user_id`.
- All agent writes are recorded in `audit_logs` with `actor = 'agent'` and the `connection_id`.
