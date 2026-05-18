# Task Management Agent — Setup Guide

This document explains the architecture, workflow, and setup process for connecting an AI agent to a Supabase-backed workflow app. It is written for open-source adopters who want to reproduce the same agent design in their own environment.

---

## What the Agent Does

The Task Management Agent is a reasoning and planning layer that sits between your work tools and your workflow app. It reads context from connected sources — email, chat, calendar, project tracker, and memory — and produces structured output: summaries, tasks, workflow updates, and agent messages.

The agent does not run automatically inside the mobile or web app. It is a separate runtime (a Custom GPT, a Claude agent, a script, or any HTTP-capable scheduler) that writes into Supabase through authenticated Edge Functions.

---

## What Problems It Solves

- **Context overload.** Work is scattered across email, Slack, Jira, GitHub, and calendar. The agent reads all of it and distills what matters.
- **Task sprawl.** Without a central task list, things fall through the cracks. The agent extracts commitments, blockers, deadlines, and follow-ups into structured tasks.
- **Planning overhead.** Daily and weekly planning is manual and time-consuming. The agent drafts your plan with grounded evidence from real context.
- **Stale workflow state.** Workflows drift when no one keeps them up to date. The agent reviews carry-over items and proposes updates.

---

## Supported Workflows

| Workflow | Description |
|----------|-------------|
| Daily planning | Morning summary, 3–7 tasks, prioritised by urgency and impact |
| Weekly planning | Broader review, cross-workflow priorities, upcoming deadlines |
| Triage | Process email, chat, and project tracker to surface clear asks and blockers |
| Context refresh | Reload the current state of open tasks, workflows, and recent activity |
| Workflow summary | Narrative briefing for a specific ongoing project stream |
| Working-memory maintenance | Update the agent's understanding of standing priorities and commitments |
| Ad-hoc task capture | Turn a quick note or message into a structured task |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Connected Sources (optional, based on what you enable)     │
│  email · chat · calendar · project tracker · memory / notes │
└────────────────────────┬────────────────────────────────────┘
                         │ context
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  AI Agent Runtime                                           │
│  ChatGPT Custom GPT · Claude agent · custom script · etc.  │
│                                                             │
│  Skills:                                                    │
│    workflow-app-supabase  (this skill package)              │
│    daily_summary · task_extraction · workflow_update        │
└──────────┬───────────────────────────┬──────────────────────┘
           │ HTTP tool available        │ no HTTP tool
           ▼                           ▼
┌──────────────────────┐   ┌──────────────────────────────────┐
│  Direct API Mode     │   │  Import JSON Mode                │
│                      │   │                                  │
│  POST /agent-write   │   │  Returns a single JSON object    │
│  POST /agent-context │   │  ready for manual or scripted    │
│  POST /agent-update  │   │  import into the app             │
└──────────┬───────────┘   └──────────────────────────────────┘
           │                                    │
           └──────────────┬─────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase Edge Functions  (server-side only)                │
│  agent-context · agent-write · agent-update-task           │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase Postgres  (Row-Level Security enforced)           │
│  tasks · summaries · workflows · workflow_runs              │
│  task_events · agent_messages · audit_logs                  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Mobile or Web Workflow App                                 │
│  Task list · Summaries · Workflows · Settings               │
└─────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Role |
|-------|------|
| Connected sources | Raw work context: emails, threads, events, issues, documents |
| Agent runtime | Reasoning and planning — reads context, produces structured output |
| Skills | Reusable instruction packages loaded into the agent's system prompt |
| Edge Functions | Authenticated API gateway — the only path for agent database access |
| Supabase Postgres | System of record — all data lives here |
| Workflow app | User-facing interface — read tasks, mark complete, review summaries |

---

## How Connected Sources Work

The agent reads context from whatever tools you connect to it. The skill package is tool-category-based, not vendor-locked:

| Category | What the agent uses it for |
|----------|---------------------------|
| `app_context` | Current open tasks, recent summaries, workflow state (from `agent-context` endpoint) |
| `email` | Commitments, asks, follow-ups, deadlines |
| `chat` | Decisions, blockers, open threads needing a reply |
| `calendar` | Upcoming meetings, prep required, deadlines |
| `project_tracker` | Assigned issues, open PRs, sprint board updates |
| `memory` / `notes` | Standing priorities, key contacts, recurring commitments |

See `docs/connectors.md` for how to map these categories to your actual tools.

---

## How Direct Supabase Writes Work

When the agent has an HTTP/API tool available (for example, a GPT Action or a Langchain/OpenAI function tool), it calls your Supabase Edge Functions directly.

The agent sends requests to:

```
POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/agent-write
POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/agent-update-task
GET  https://YOUR_PROJECT_REF.supabase.co/functions/v1/agent-context
```

Authentication uses an `agent_connection_token` generated in the app:

```
Authorization: Bearer <agent_connection_token>
```

The Edge Function:
1. Validates the token (checks hash, checks revocation).
2. Resolves the `user_id` from the token — never from the request body.
3. Writes the payload scoped to that `user_id`.
4. Writes an `audit_logs` entry.
5. Returns the created record IDs.

The agent confirms the write only when it receives a success response with record IDs.

**Security invariants:**
- The agent never sends or receives a `user_id` directly.
- The agent never receives the Supabase service role key.
- The agent token is generated in the app, shown once, and hashed before storage.
- Revoked tokens fail immediately.

---

## How Import JSON Fallback Works

When no HTTP/API tool is available, the agent produces a single, valid JSON object in the import format defined in `skills/hermes/workflow-app-supabase/references/import-json-format.md`.

You paste or upload this JSON into the app's **Import** screen. The app validates and writes it to Supabase on your behalf.

The agent must:
- Return one valid JSON object only — no markdown wrapper, no explanation text mixed in.
- Never claim the database was updated in import mode.
- Persist the latest payload to a memory location (e.g., `imports/latest-import.json`) so it can be referenced or re-submitted.

---

## Safety Rules

The agent must follow these rules at all times:

1. **Do not invent facts.** Only report what is actually present in the context you have been given.
2. **Never include `user_id` in output.** User identity is resolved server-side.
3. **Never include credentials, tokens, API keys, or secrets in output.**
4. **Prefer summaries over raw content.** Do not reproduce raw email bodies, chat messages, or issue descriptions.
5. **Do not take external actions** (send email, post to Slack, comment on issues) without explicit user approval.
6. **Confirm writes only when confirmed by the API.** Do not tell the user something was saved unless you received a success response.
7. **Respect user feedback.** Do not recreate tasks the user has rejected or archived.
8. **Check for duplicates.** Before creating a task, verify it does not already exist in open tasks.

---

## How to Adapt This to Your Stack

### Step 1 — Set up Supabase

1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Apply the schema from `supabase/migrations/`.
3. Deploy the Edge Functions from `supabase/functions/`.
4. Set the `SUPABASE_SERVICE_ROLE_KEY` secret on the Edge Functions only — never in the app.

### Step 2 — Configure the app

1. Copy `app/.env.example` to `app/.env`.
2. Fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
3. Start the app and create a user account.

### Step 3 — Generate an agent connection token

1. In the app, go to **Settings → Connect Agent → New Connection**.
2. Copy the token (shown once only).
3. Store it securely in your agent runtime's secret management.

### Step 4 — Configure the agent

Choose your agent runtime and load the skill:

- **ChatGPT Custom GPT:** Paste `skills/hermes/workflow-app-supabase/SKILL.md` and the security rules into the system prompt. Configure a GPT Action pointing at your Edge Function base URL.
- **Claude agent / API:** Load the skill files into the system prompt. Use Anthropic's tool use to call the Edge Functions.
- **Custom script:** Read the skill files and send them as the system message. Use any HTTP library to call the Edge Functions.

### Step 5 — Choose your execution mode

| Mode | When to use |
|------|-------------|
| Direct API | Agent runtime has an HTTP/API tool and can call the Edge Functions directly |
| Import JSON | Agent runtime cannot make HTTP calls; you import the JSON manually in the app |

See `skills/hermes/workflow-app-supabase/SKILL.md` for the full execution mode instructions.

### Step 6 — Connect your sources

Map the tool categories in `docs/connectors.md` to the tools you actually use. Connect them to your agent runtime using your provider's native integrations or OAuth flows.

---

## File Map for This Setup

```
skills/hermes/workflow-app-supabase/
├── SKILL.md                          # Main skill instructions (load into agent)
├── agents/openai.yaml                # Descriptor for OpenAI Custom GPT
└── references/
    ├── record-schemas.md             # Database record concepts and field rules
    ├── import-json-format.md         # Import JSON contract and field definitions
    ├── source-triage-rules.md        # Source order and extraction behaviour
    └── supabase-api.md               # Direct API mode documentation

docs/
├── task-management-agent-setup.md   # This file
├── connectors.md                    # Tool category mapping
└── open-source-sanitization.md      # Sanitization rules for contributors

templates/
└── AGENTS.task-management-agent.md  # Reusable agent behaviour template
```
