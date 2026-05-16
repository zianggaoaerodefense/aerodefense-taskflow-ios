# TaskFlow Architecture

## Overview

TaskFlow is a three-layer system:

1. **iPhone SwiftUI app** — primary UI, local SwiftData cache for offline access and fast rendering
2. **Supabase** — hosted Postgres database, Auth, Row-Level Security, Edge Functions, Realtime
3. **ChatGPT Custom GPT** — agent interface that reads and writes through Edge Functions only

The iOS app never talks to the Postgres database directly. The ChatGPT agent never talks to the database directly. All reads and writes that originate from the agent go through Supabase Edge Functions, which verify the agent token and derive the user identity server-side.

---

## Security Principles

- **`user_id` is never trusted from the client or agent body.** The `user_id` written to any row is always derived from the authenticated Supabase session JWT (for app users) or looked up from the agent token hash (for the ChatGPT agent). Client-supplied `user_id` fields are silently ignored.
- **All queries are scoped by `user_id`.** Every Postgres query in the RLS policies includes `auth.uid() = user_id` as a mandatory filter. A valid token for user A cannot read data belonging to user B.
- **Postgres is only reachable via Supabase's managed access paths.** The iOS app uses the anon key + authenticated JWT (bound by RLS). Edge Functions use the service role key (server-side only, bypasses RLS with explicit ownership checks). No raw Postgres connection string is ever in the app or agent.
- **No secrets in code.** The Supabase service role key exists only as a Supabase project secret injected into Edge Functions at runtime. The iOS app contains only the anon key (safe for client-side use; restricted by RLS) and the project URL.
- **Agent tokens have explicit ownership.** Agent JWTs are not used. Instead, a connection token is generated per-user in the iOS app, stored as a SHA-256 hash in `agent_connections`, and passed as the `X-Agent-Token` header. The raw token is shown once and never stored.
- **External actions require explicit user approval.** The agent may propose tasks and summaries, but no external send (email, Slack, Jira) occurs without user approval through the iOS app.
- **Row-Level Security is enabled on all user-owned tables.** Policies ensure `auth.uid() = user_id` for all SELECT, INSERT, and UPDATE operations. Edge Functions using the service role key perform explicit ownership checks in application code.

---

## Data Flow

### Normal sync (user opens app)

```
iPhone app
  → Supabase anon client + authenticated JWT
  → RLS: auth.uid() = user_id filters all results
  → tasks / summaries / workflows returned
  → SwiftUI renders; Realtime subscription detects changes
```

### ChatGPT agent reads context

```
ChatGPT Custom GPT
  → GET /functions/v1/agent-context (X-Agent-Token header)
  → Edge Function: hash token → lookup agent_connections → resolve user_id
  → Query tasks, summaries, workflows, task_events for that user_id
  → Return JSON context to GPT
```

### ChatGPT agent creates tasks

```
GPT decision: create task
  → POST /functions/v1/agent-write { tasks: [...] }
  → Edge Function: authenticate token → derive user_id (not from body)
  → Insert tasks with user_id = resolved user_id, source = 'agent'
  → Insert task_events rows (actor='agent') for each created task
  → Insert audit_logs row
  → iOS Realtime subscription fires → app refreshes task list
```

### ChatGPT agent updates a task

```
GPT decision: mark task done
  → POST /functions/v1/agent-update-task { task_id: "...", status: "done" }
  → Edge Function: authenticate → verify task.user_id == resolved user_id
  → Update task row
  → Insert task_events row (actor='agent', event_type='status_changed')
  → Insert audit_logs row
  → iOS Realtime triggers refresh
```

### User changes a task in the app

```
User taps "Complete" on a task
  → SupabaseTaskService.completeTask()
  → UPDATE tasks SET status='done' (RLS enforces user scope)
  → INSERT task_events (actor='user', event_type='status_changed')
  → Next GPT context call sees the change in recently_completed_tasks
```

### User generates an agent connection token

```
User: Settings → Connect ChatGPT Agent → New Connection
  → App calls POST /functions/v1/create-agent-connection (app JWT)
  → Edge Function: generate 32-byte random token
  → Store SHA-256(token) in agent_connections
  → Return raw token once (never stored)
  → User pastes token into Custom GPT action header configuration
```

---

## Supabase Tables

| Table | Description |
|---|---|
| `profiles` | One row per auth.users entry. Created automatically on signup via trigger. |
| `workflows` | Named workflow definitions owned by a user. |
| `workflow_runs` | Individual execution records for a workflow. |
| `summaries` | Text summaries created by the agent or user. Source of record for analysis output. |
| `tasks` | Core task cards. Status flows: open → in_progress → waiting → done → archived. |
| `task_events` | Append-only event log for every task mutation. One row per change. |
| `agent_messages` | Structured messages the agent writes for the user's context. |
| `agent_connections` | Hashed agent connection tokens. Raw token never stored. |
| `integration_connections` | External integration links (Gmail, Slack, Jira). OAuth tokens stored in Supabase Vault, not here. |
| `audit_logs` | Append-only audit trail of all agent writes and task updates. Readable by the owning user. |

All tables have Row-Level Security enabled with `user_id`-scoped policies.

---

## Edge Functions

All Edge Functions are deployed to Supabase and run in Deno. The service role key is available as an environment variable at runtime and is never exposed outside the function sandbox.

| Function | Caller | Auth method | Purpose |
|---|---|---|---|
| `create-agent-connection` | iOS app | Supabase JWT (anon client) | Generate a new agent connection token |
| `revoke-agent-connection` | iOS app | Supabase JWT (anon client) | Revoke an existing agent connection |
| `agent-context` | ChatGPT GPT | `X-Agent-Token` | Return current workflow context |
| `agent-write` | ChatGPT GPT | `X-Agent-Token` | Write summaries, tasks, messages |
| `agent-update-task` | ChatGPT GPT | `X-Agent-Token` | Update a task and record the event |

---

## iOS App Integration

The iOS app uses the Supabase Swift SDK with the anon key. Sessions are stored in Keychain by the SDK. The app:

- Signs in users with Supabase Auth (email/password)
- Reads tasks, summaries, and workflows using authenticated queries (bound by RLS)
- Writes task mutations via `SupabaseTaskService`, which always also inserts a `task_events` row
- Calls Edge Functions directly for agent connection management (passing the session JWT)
- Subscribes to Realtime changes on `tasks` and `summaries` to refresh when the agent writes

The service role key is never present in the app.

---

## Realtime

Supabase Realtime is enabled on the `tasks` and `summaries` tables. The iOS app subscribes to `postgres_changes` events. When the ChatGPT agent inserts a task via `agent-write`, the Realtime event fires and the app refreshes automatically.

---

## Alternative Architecture (Future Option)

The `backend/` directory contains an AWS Lambda + MongoDB Atlas implementation. This was the original MVP design and is preserved as a reference. It is not the active production path. If scale requirements grow beyond Supabase's limits, migrating the Edge Functions to AWS Lambda (using the same RLS-equivalent logic) and the database to MongoDB Atlas or Aurora Postgres is a viable path.

Key differences from the Supabase MVP:
- Lambda requires VPC + NAT gateway for MongoDB Atlas IP allowlisting
- MongoDB replaces Postgres; the data model would need adapting
- Agent token auth logic would move to a Lambda middleware
- No managed Realtime — would require WebSocket infrastructure or polling
