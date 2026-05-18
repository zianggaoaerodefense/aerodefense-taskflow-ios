# Daily Workflow Management App

An open-source daily workflow management system that connects an AI agent to a mobile task app via a shared database.

The agent collects context from your work tools — email, calendar, Jira, Slack, GitHub, documents, and notes — then generates daily summaries, suggested tasks, blockers, follow-ups, and prioritized work items. Those items are stored in Supabase and shown in the mobile app. You review, accept, complete, comment on, or reject tasks. The next agent run reads your feedback and continues from there.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  External Sources                                            │
│  (Email · Calendar · Jira · Slack · GitHub · Notes)         │
└──────────────────────────┬───────────────────────────────────┘
                           │ context input
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  AI Agent Runtime                                            │
│  (ChatGPT · Claude · custom script · GitHub Actions · etc.) │
│                                                              │
│  Reads prior state → Summarises → Extracts tasks → Writes   │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTPS (X-Agent-Token)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase Edge Functions  (server-side, service role only)   │
│  agent-context · agent-write · agent-update-task            │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase Postgres (Row-Level Security enforced)             │
│  tasks · summaries · workflows · task_events · audit_logs   │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTPS (anon key + JWT, bound by RLS)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Expo React Native Mobile App                                │
│  Task list · Summaries · Workflows · Settings               │
└──────────────────────────┬───────────────────────────────────┘
                           │ Supabase Realtime (live updates)
                           ▼
                     User reviews tasks,
                   marks complete, comments,
                  rejects, defers, prioritises
```

The mobile app and the AI agent **never connect to Postgres directly**. All agent reads/writes go through authenticated Supabase Edge Functions. All app reads/writes go through the Supabase client (anon key + authenticated JWT, restricted by RLS).

---

## High-Level Workflow

1. A scheduled or manually triggered agent reviews available work context.
2. The agent creates a daily summary.
3. The agent extracts tasks, decisions, blockers, and follow-ups.
4. The agent writes structured data into Supabase via Edge Functions.
5. The mobile app reads the user's data from Supabase.
6. The user reviews, edits, accepts, rejects, completes, or comments on tasks.
7. Those user actions are saved back to Supabase.
8. The next agent run reads the updated workflow state and continues from there.

---

## Major Components

| Component | Description |
|-----------|-------------|
| **Expo / React Native app** | Mobile task UI. Built with Expo Router. Sessions stored in hardware-backed SecureStore. |
| **Supabase Auth** | Email/password sign-up and sign-in. JWT sessions. |
| **Supabase Postgres** | System of record. 10 tables, all with Row-Level Security. |
| **Supabase RLS** | Every user-owned table enforces `auth.uid() = user_id`. Users can only access their own data. |
| **Supabase Edge Functions** | Deno/TypeScript server-side functions. The only path for agent reads/writes. Service role key lives here only. |
| **Agent runtime** | Pluggable — ChatGPT Custom GPT, Claude, Codex, custom script, GitHub Actions, AWS Lambda, or any HTTP-capable scheduler. |
| **Agent prompts / skills** | Reusable instruction files that tell the agent how to summarise, extract tasks, and update workflow state. |
| **Agent connection tokens** | Per-user tokens generated in the app. Only the SHA-256 hash is stored. Raw token shown once. |

---

## Open-Source Scope

This repository contains:

- The Expo React Native mobile app (`app/`)
- The Supabase schema, RLS policies, and Edge Functions (`supabase/`)
- Agent prompt templates and example payloads (`agent/`)
- A reusable Task Management Agent skill package (`skills/hermes/workflow-app-supabase/`)
- A reusable agent behaviour template (`templates/AGENTS.task-management-agent.md`)
- Full documentation (`docs/`)

**You must bring your own:**

- Supabase project (free tier works for development)
- AI model account (OpenAI, Anthropic, or self-hosted)
- Email/Jira/Slack/GitHub credentials (for integrations you want to enable)
- Agent runtime and scheduler (ChatGPT Custom GPT, cron job, GitHub Actions, cloud function, etc.)
- API keys for any external services

---

## Task Management Agent Setup

This repository includes a complete, open-source-safe agent setup that connects an AI agent to the workflow app. Here is what it does and how to adapt it.

### What the agent does

The Task Management Agent reads context from your work tools — email, chat, calendar, project tracker — and writes structured output (summaries, tasks, workflow updates) into Supabase. The workflow app displays this output. You review, accept, complete, or reject tasks. The next agent run reads your feedback and continues from there.

### Files to edit when customising

| File | What to edit |
|------|-------------|
| `skills/hermes/workflow-app-supabase/SKILL.md` | Main skill instructions — loaded into the agent's system prompt |
| `skills/hermes/workflow-app-supabase/agents/openai.yaml` | GPT Action configuration — update the base URL and endpoint paths |
| `templates/AGENTS.task-management-agent.md` | Full agent behaviour template — copy into your agent's system prompt and adapt |
| `agent/prompts/daily_summary.md` | Daily summary instructions |
| `agent/prompts/task_extraction.md` | Task extraction instructions |
| `agent/prompts/security_rules.md` | Security constraints — include in every agent prompt, do not modify |

### How to plug in your Supabase project

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Apply the schema: `supabase/migrations/20240101000000_initial_schema.sql`.
3. Deploy the Edge Functions: `supabase/functions/`.
4. In `skills/hermes/workflow-app-supabase/agents/openai.yaml`, replace `YOUR_PROJECT_REF` with your actual Supabase project reference.
5. In the app, go to **Settings → Connect Agent → New Connection** to generate your `agent_connection_token`.
6. Store the token securely in your agent runtime's secret management (e.g., as a GPT Action credential). Never hardcode it.

### Choosing between Direct API Mode and Import JSON Mode

| Mode | When to use | How it works |
|------|-------------|--------------|
| **Direct API Mode** | Your agent runtime has an HTTP/API tool (e.g., GPT Actions, Langchain tool, Claude tool) | Agent calls Edge Functions directly over HTTPS with a bearer token |
| **Import JSON Mode** | No HTTP tool available, or simpler setup preferred | Agent returns a JSON object; you paste it into the app's Import screen |

Both modes produce the same structured output. Direct API Mode is fully automated. Import JSON Mode is the safe fallback and requires one manual step.

See `skills/hermes/workflow-app-supabase/SKILL.md` for the full execution instructions.

### Security warning

> **You must provide your own secure authentication path. Never embed the `agent_connection_token`, Supabase service role key, or any other secret in prompts, skill files, documentation, or agent outputs.**

The agent token must be stored in the agent runtime's secret management only (e.g., a GPT Action's OAuth credential field, an environment variable, or a secrets manager). If you are using a ChatGPT Custom GPT, configure the token as a GPT Action bearer token credential — not in the system prompt.

See `docs/SECURITY.md` and `docs/open-source-sanitization.md` for the full security guide.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [npm](https://npmjs.com/) or [yarn](https://yarnpkg.com/)
- [Expo CLI](https://docs.expo.dev/more/expo-cli/): `npm install -g expo` (or use `npx expo`)
- [Expo Go](https://expo.dev/go) app on your phone (for development)
- [Supabase account](https://supabase.com) (free tier is fine)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (optional, for local development)

### 1. Clone the repo

```bash
git clone https://github.com/your-org/daily-workflow-app.git
cd daily-workflow-app
```

### 2. Install dependencies

```bash
cd app
npm install
```

### 3. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Wait for the project to finish provisioning (1–2 minutes).
3. In the Supabase dashboard, go to **Settings → API**.
4. Copy your **Project URL** and **anon public** key.

### 4. Configure environment variables

```bash
cp app/.env.example app/.env
# Edit app/.env and fill in your Supabase URL and anon key
```

Also copy the root `.env.example` if you plan to run server-side scripts or the agent:

```bash
cp .env.example .env
# Edit .env and fill in your Supabase service role key (server-side only)
```

### 5. Apply the database schema

**Option A — Supabase CLI (recommended for local dev):**

```bash
# Install Supabase CLI (macOS)
brew install supabase/tap/supabase

# Start local Supabase stack (Postgres + Studio + Edge Functions)
supabase start

# Apply migrations
supabase db reset

# In a separate terminal, serve Edge Functions
supabase functions serve --import-map supabase/functions/import_map.json
```

**Option B — Supabase dashboard (hosted project):**

1. In the Supabase dashboard, go to **SQL Editor**.
2. Copy the contents of `supabase/migrations/20240101000000_initial_schema.sql`.
3. Paste and run it.

### 6. Configure two required dashboard settings (hosted project only)

| Setting | Location | Required value |
|---------|----------|----------------|
| Exposed schemas | Settings → API → Exposed schemas | `public` must be listed |
| Email confirmation | Authentication → Providers → Email | Disable for development |

> **Exposed schemas:** If `public` is missing, every table query from the app fails silently.
> **Email confirmation:** With it enabled, `signInWithPassword` returns "Email not confirmed" until the verification link is clicked. Disable during development; re-enable before shipping to real users.

### 7. Start the Expo app

```bash
cd app
npx expo start
```

- Press `i` for iOS Simulator
- Press `a` for Android Emulator
- Scan the QR code with [Expo Go](https://expo.dev/go) on your phone

### 8. Create a test user

Open the app → tap **Sign up** → enter any email and password.

### 9. Load sample data

Run the seed script to insert example tasks and a summary:

```bash
# From the repo root (requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env)
cd app && npx ts-node ../scripts/seed-sample-data.ts
```

Or copy one of the example agent payloads from `agent/examples/` and use the **Import** screen in the app.

### 10. Connect an agent (optional)

1. In the app, go to **Settings → Connect Agent → New Connection**.
2. Copy the token shown once.
3. Configure your agent runtime to send `X-Agent-Token: <your-token>` to the Edge Function endpoints.
4. See `docs/SETUP_AGENT.md` for details.

---

## Repository Structure

```
/
├── README.md
├── LICENSE
├── .env.example                    # Root-level env reference (server + agent vars)
├── .gitignore
│
├── app/                            # Expo React Native mobile app
│   ├── app/                        # Expo Router routes
│   │   ├── (auth)/                 # Sign-in, sign-up screens
│   │   ├── (tabs)/                 # Tasks, Summaries, Workflows, Settings
│   │   └── agent-connections.tsx   # Agent connection management
│   ├── lib/supabase.ts             # Supabase client (SecureStore sessions)
│   ├── services/                   # tasks, summaries, workflows, agentConnections
│   ├── types/database.ts           # TypeScript types mirroring the schema
│   └── .env.example                # Client-side env vars (EXPO_PUBLIC_* only)
│
├── supabase/                       # Supabase project
│   ├── config.toml                 # Local dev config
│   ├── migrations/                 # SQL schema, RLS, indexes, triggers
│   ├── seed.sql                    # Safe sample data for development
│   └── functions/                  # Deno Edge Functions
│       ├── _shared/                # auth.ts, cors.ts (shared utilities)
│       ├── agent-context/          # GET — return workflow context to agent
│       ├── agent-write/            # POST — create summaries/tasks/messages
│       ├── agent-update-task/      # POST — update task + log event
│       ├── create-agent-connection/ # POST — generate agent token
│       └── revoke-agent-connection/ # POST — revoke agent token
│
├── agent/                          # Agent configuration and examples
│   ├── prompts/                    # Reusable prompt/instruction files
│   │   ├── daily_summary.md
│   │   ├── task_extraction.md
│   │   ├── workflow_update.md
│   │   └── security_rules.md
│   ├── skills/README.md            # Workflow skills documentation
│   └── examples/                   # Sample agent payloads
│       ├── sample_daily_summary.json
│       └── sample_tasks.json
│
├── scripts/                        # Development and maintenance scripts
│   ├── seed-sample-data.ts         # Insert safe sample data
│   ├── sanity-check.sh             # Verify setup is correct
│   └── security-scan.sh            # Scan for accidental secret leaks
│
├── packages/shared/                # Shared TypeScript types
│   └── src/types.ts
│
├── docs/                           # Full documentation
│   ├── ARCHITECTURE.md
│   ├── SETUP_APP.md
│   ├── SETUP_DATABASE.md
│   ├── SETUP_AGENT.md
│   ├── WORKFLOW.md
│   ├── SECURITY.md
│   ├── ENVIRONMENT_VARIABLES.md
│   ├── TROUBLESHOOTING.md
│   ├── ROADMAP.md
│   ├── CONTRIBUTING.md
│   └── OPEN_SOURCE_RELEASE_CHECKLIST.md
│
├── ios/                            # Legacy SwiftUI prototype (reference only)
└── backend/                        # Legacy AWS Lambda reference (not active)
```

---

## Security Model

| Rule | Implementation |
|------|---------------|
| `user_id` never trusted from client | App: derived from RLS (`auth.uid()`). Agent: resolved from token hash lookup, never from body. |
| All DB queries scoped by `user_id` | RLS policies on every table enforce `auth.uid() = user_id`. |
| Postgres accessible only via authenticated paths | App uses anon key + JWT (RLS-bound). Agent uses Edge Functions with service role. |
| Service role key never in the mobile app | Only available inside Edge Functions as a runtime environment variable. |
| Agent tokens hashed before storage | SHA-256 hash stored; raw token returned once and never persisted. |
| RLS enabled on all user-owned tables | Enabled on all 10 tables; no DELETE policies (rows are archived instead). |
| Every task mutation emits a task_events row | App and agent both insert a `task_events` row on every change. |
| Append-only audit log | `audit_logs` table records all agent writes and task updates. |
| Sessions in hardware-backed storage | expo-secure-store uses iOS Keychain / Android Keystore with chunking for large JWT payloads. |
| No secrets committed | `.gitignore` excludes `.env`, signing artifacts, and exported data files. |

---

## Limitations

- **The agent can hallucinate or create low-quality tasks.** Always review generated tasks before acting on them.
- **The app does not run the agent.** The agent is a separate runtime. The mobile app only reads/writes data; it does not execute the agent logic.
- **Expo Go is for development.** For production distribution use EAS Build, TestFlight, or the app store.
- **Persistent automation needs an external scheduler.** Cron jobs, GitHub Actions, cloud functions, or hosted agent runtimes are required. If your local computer stops, the local Expo dev server stops too.
- **Integrations need user-managed credentials.** Gmail, Jira, Slack, and GitHub each require you to configure your own API keys.
- **Security depends on correct RLS and secret handling.** Review `docs/SECURITY.md` before any production deployment.
- **This is an MVP/foundation, not a fully managed SaaS product.**

---

## Security Warning

> **Never commit real API keys, tokens, Supabase service role keys, user data, emails, Slack content, Jira content, or private company information.**

See `docs/SECURITY.md` for the full security guide.

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, data flow, Mermaid diagram |
| [docs/SETUP_APP.md](docs/SETUP_APP.md) | Expo app setup guide |
| [docs/SETUP_DATABASE.md](docs/SETUP_DATABASE.md) | Supabase schema, RLS, seed data |
| [docs/SETUP_AGENT.md](docs/SETUP_AGENT.md) | Agent configuration and integration |
| [docs/task-management-agent-setup.md](docs/task-management-agent-setup.md) | Open-source agent architecture and setup guide |
| [docs/connectors.md](docs/connectors.md) | Tool category mapping for connected sources |
| [docs/open-source-sanitization.md](docs/open-source-sanitization.md) | Sanitization rules for contributors |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | End-to-end daily workflow documentation |
| [docs/SECURITY.md](docs/SECURITY.md) | Security guide and best practices |
| [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) | All environment variables documented |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common problems and fixes |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Planned features and phases |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | How to contribute |

### Agent skill package

| File | Description |
|------|-------------|
| [skills/hermes/workflow-app-supabase/SKILL.md](skills/hermes/workflow-app-supabase/SKILL.md) | Main skill — load into agent system prompt |
| [skills/hermes/workflow-app-supabase/agents/openai.yaml](skills/hermes/workflow-app-supabase/agents/openai.yaml) | OpenAI Custom GPT descriptor |
| [skills/hermes/workflow-app-supabase/references/record-schemas.md](skills/hermes/workflow-app-supabase/references/record-schemas.md) | Record types and field rules |
| [skills/hermes/workflow-app-supabase/references/import-json-format.md](skills/hermes/workflow-app-supabase/references/import-json-format.md) | Import JSON schema and contract |
| [skills/hermes/workflow-app-supabase/references/source-triage-rules.md](skills/hermes/workflow-app-supabase/references/source-triage-rules.md) | Source order and extraction rules |
| [skills/hermes/workflow-app-supabase/references/supabase-api.md](skills/hermes/workflow-app-supabase/references/supabase-api.md) | Direct API mode documentation |
| [templates/AGENTS.task-management-agent.md](templates/AGENTS.task-management-agent.md) | Full reusable agent behaviour template |

---

## License

[MIT](LICENSE)
