# TaskFlow — Private CTO Workflow System

**Monorepo: Expo App + Supabase Backend + ChatGPT Agent**

A private, secure task-management system that turns meeting notes, GPT summaries, email, Slack, and Jira inputs into structured task cards with a full review-and-action workflow.

---

## Architecture

```
Expo React Native App (primary UI, expo-secure-store sessions)
        ↕ HTTPS (Supabase anon key + user JWT, bound by RLS)
Supabase Postgres (system of record, Row-Level Security)
        ↕ Realtime
Expo React Native App (auto-refresh on agent writes)

ChatGPT Custom GPT (agent interface)
        ↕ HTTPS (X-Agent-Token header)
Supabase Edge Functions (Deno, service role key — server-side only)
        ↕
Supabase Postgres (queries scoped to resolved user_id)
```

**The app and ChatGPT agent never connect to Postgres directly. All reads/writes go through the authenticated Supabase client (app) or Edge Functions (agent).**

---

## Repository Structure

```
/
├── ios/                              # SwiftUI app (legacy reference)
│   ├── TaskFlow.xcodeproj/
│   └── TaskFlow/
│       ├── Models/                   # SwiftData @Model classes
│       ├── Services/                 # SupabaseClient, AuthService, SupabaseTaskService, etc.
│       ├── ViewModels/               # @Observable / ObservableObject view models
│       ├── Views/                    # SwiftUI views
│       │   └── Settings/            # ConnectAgentView, SettingsView
│       └── Resources/               # SampleData
│
├── app/                              # Expo React Native app (MVP)
│   ├── app/                         # Expo Router routes
│   │   ├── (auth)/                  # Sign-in, sign-up
│   │   ├── (tabs)/                  # Tasks, Summaries, Workflows, Settings
│   │   └── agent-connections.tsx    # Agent connection management
│   ├── lib/                         # supabase.ts (SecureStore adapter)
│   ├── services/                    # tasks.ts, summaries.ts, workflows.ts, agentConnections.ts
│   └── types/                       # database.ts
│
├── supabase/                         # Supabase project
│   ├── config.toml                  # Local dev configuration
│   ├── migrations/                   # SQL migrations (schema, RLS, indexes)
│   └── functions/                   # Edge Functions (Deno/TypeScript)
│       ├── _shared/                 # cors.ts, auth.ts (shared utilities)
│       ├── agent-context/           # GET — return workflow context to ChatGPT
│       ├── agent-write/             # POST — create summaries/tasks/messages
│       ├── agent-update-task/       # POST — update task + insert event
│       ├── create-agent-connection/ # POST — generate agent token (app user only)
│       └── revoke-agent-connection/ # POST — revoke agent token (app user only)
│
├── packages/
│   └── shared/                      # TypeScript types (shared across tooling)
│       └── src/types.ts
│
├── backend/                          # AWS Lambda implementation (future option)
│   └── src/                         # Preserved as reference; not the active path
│
├── shared/
│   └── schemas/                      # JSON Schema definitions
│
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   ├── security.md
│   ├── chatgpt-agent-actions.md    # GPT Action OpenAPI schema + setup guide
│   └── api.md
│
└── README.md
```

---

## Quick Start

### Supabase (local dev)

```bash
# Install Supabase CLI (macOS)
brew install supabase/tap/supabase

# Start local Postgres + Studio + Edge Function runtime
supabase start

# Apply schema migrations
supabase db reset

# Serve Edge Functions locally
supabase functions serve --import-map supabase/functions/import_map.json
```

### Expo App

1. Copy the env file: `cp app/.env.example app/.env`
2. Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from **Supabase → Settings → API**.
3. Install dependencies: `cd app && npm install`
4. Start the dev server: `npx expo start`
5. Press `i` for iOS Simulator, `a` for Android Emulator, or scan the QR code with Expo Go.

---

## Security Model

| Rule | Implementation |
|------|---------------|
| `user_id` never trusted from client | App: derived from RLS (`auth.uid()`). Agent: resolved from token hash lookup, never from body |
| All DB queries scoped by `user_id` | RLS policies on every table enforce `auth.uid() = user_id` |
| Postgres only via authenticated paths | App uses anon key + JWT; agent uses Edge Functions with service role |
| Service role key never in the app | Only available inside Edge Functions as a runtime environment variable |
| Agent tokens hashed before storage | SHA-256 hash stored; raw token returned once and never persisted |
| RLS enabled on all user-owned tables | Enabled on all 10 tables; no DELETE policies |
| Every task mutation emits task_events | App and agent both insert a `task_events` row on every change |
| Audit log for agent writes and updates | `audit_logs` table; append-only; no raw content in snapshots |
| Expo sessions in SecureStore | expo-secure-store stores the Supabase JWT in hardware-backed Keychain (iOS) with chunking for large tokens |
| No secrets committed | `.gitignore` blocks `.env`, `*.p12`, `AuthKey_*.p8` |

---

## Data Flow

### ChatGPT agent reads context
1. GPT calls `GET /functions/v1/agent-context` with `X-Agent-Token` header.
2. Edge Function hashes the token, looks it up in `agent_connections`, resolves `user_id`.
3. Returns open tasks, recent events, summaries, workflows, and agent messages for that user.

### ChatGPT agent creates a task
1. GPT calls `POST /functions/v1/agent-write` with task details.
2. Edge Function resolves `user_id` from token (not from request body).
3. Inserts task with `source='agent'` and `user_id` from lookup.
4. Inserts `task_events` row: `actor='agent'`, `event_type='created'`.
5. Expo Realtime subscription fires → app refreshes.

### User changes a task in the app
1. User taps "Complete" → `completeTask() from the tasks service`.
2. Updates `tasks.status = 'done'` (RLS enforces scope).
3. Inserts `task_events` row: `actor='user'`, `event_type='status_changed'`.
4. Next GPT context call sees the task in `recently_completed_tasks`.

### User connects the ChatGPT agent
1. **Settings → Connect ChatGPT Agent → New Connection**.
2. App calls `create-agent-connection` with the user's Supabase session JWT.
3. Edge Function generates a random 32-byte token, stores its SHA-256 hash.
4. Raw token shown once — user copies it into Custom GPT action `X-Agent-Token` header.

---

## Supabase Tables

| Table | Purpose |
|-----------|---------|
| `profiles` | User display name and role |
| `workflows` | Named workflow definitions |
| `workflow_runs` | Individual workflow executions |
| `summaries` | Work summaries from agent or user |
| `tasks` | Task cards (system of record) |
| `task_events` | Append-only mutation log per task |
| `agent_messages` | Structured messages from the agent |
| `agent_connections` | Hashed agent tokens, one per user-GPT pairing |
| `integration_connections` | External integration links (Gmail, Slack, Jira) |
| `audit_logs` | Append-only audit trail for agent writes and task updates |

---

## Task Status Flow

```
open → in_progress → done → archived
         ↓
       waiting (snoozed)
```

---

## Phase Roadmap

| Feature | Phase |
|---------|-------|
| Local SwiftData cache (legacy SwiftUI) | ✅ Phase 1 |
| Face ID lock (legacy SwiftUI) | ✅ Phase 1 |
| JSON export/import (debug only) | ✅ Phase 1 |
| Supabase Postgres schema + RLS | ✅ Phase 2 (current) |
| Supabase Auth in Expo app | ✅ Phase 2 (current) |
| Supabase Edge Functions for agent | ✅ Phase 2 (current) |
| ChatGPT agent connection UI in Expo app | ✅ Phase 2 (current) |
| Supabase Realtime task refresh in Expo app | ✅ Phase 2 (current) |
| Gmail integration (read + draft) | Phase 3 |
| Slack integration (read + draft) | Phase 3 |
| Jira integration (read + comment) | Phase 3 |
| Email/Slack send via approval | Phase 3 |
| Push notifications | Phase 3 |
| TestFlight distribution | Phase 3 |
| App Store | Not planned |

---

## Non-Goals (Current Phase)

- No automatic external sending (email, Slack, Jira) — approval required
- No public App Store release
- No direct Postgres access from Expo app or ChatGPT agent
- No committed secrets (service role key, API keys, tokens)
- No analytics

---

## Security Notes

See `docs/security.md` for full details.

**Never commit:**
- `.env` files
- `*.p12` / `*.mobileprovision` / `AuthKey_*.p8` (applies to EAS/CI builds and any legacy iOS signing artifacts)
- Supabase service role key
- Agent connection tokens
- Exported task data JSON files (`taskflow-export*.json`)
