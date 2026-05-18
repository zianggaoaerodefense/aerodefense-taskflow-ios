# Skill: workflow-app-supabase

**Name:** workflow-app-supabase
**Package:** skills/hermes/workflow-app-supabase
**Version:** 1.0

## Description

Create or update workflow-app tasks, summaries, workflows, workflow runs, and related records using direct Supabase API calls when available, or import-ready JSON when HTTP/API tools are unavailable.

This skill is the bridge between the agent's reasoning output and the Supabase-backed workflow app. It handles both execution modes transparently and enforces the security and quality rules required by the app's data model.

---

## Execution Modes

### Direct API Mode

**Use when:** an HTTP/API tool is available in the agent runtime AND a secure `agent_connection_token` has been provided by the runtime connection.

The agent calls Supabase Edge Functions directly over HTTPS. The token is passed in the `X-Agent-Token` request header. User identity is resolved server-side from the token; the agent never supplies or receives a `user_id`.

See `references/supabase-api.md` for endpoint details and security rules.

### Import JSON Mode

**Use when:** no HTTP/API tool is available, or when the agent runtime cannot make outbound HTTPS calls.

The agent produces one valid JSON object in the import format. The user pastes or uploads this JSON into the app's **Import** screen. The app validates and writes it to Supabase.

See `references/import-json-format.md` for the exact schema and field rules.

---

## Workflow

Follow these steps in order:

1. **Read current app context first** when a direct API tool is available. Call `GET /agent-context` and read `open_tasks`, `recently_completed_tasks`, `recent_task_events`, `recent_summaries`, and `active_workflows`. This prevents duplicate tasks and grounds all output in real state.

2. **Review email, project tracker, chat, and calendar** only when they are materially useful to the current request. Do not pull all sources for every operation. Use the triage rules in `references/source-triage-rules.md`.

3. **Extract commitments, blockers, decisions, deadlines, follow-ups, and likely next actions** from the reviewed sources.

4. **Create summaries for narrative context** — one summary per planning session. Summaries are operational briefings, not journals. See the summary rules below.

5. **Create tasks only for clear action items.** Do not create tasks for general awareness, completed work, or vague intentions. See the task rules below.

6. **Create or update workflows only for ongoing project streams.** Do not create a workflow for a one-off task or a short-lived item.

7. **Avoid duplicate tasks.** Before creating any task, check the `open_tasks` list from app context. If a similar task exists and is open, update it rather than creating a new one.

8. **Align records to app structure.** Use the record concepts and field rules in `references/record-schemas.md`.

9. **Choose execution mode:**
   - If an HTTP/API tool is available: use Direct API Mode.
   - Otherwise: use Import JSON Mode.

10. **In Import JSON Mode:** return one valid JSON object. Do not wrap it in markdown fences if operating in a pure import context. Persist the latest payload to a memory location (e.g., `imports/latest-import.json`) so it can be referenced or re-submitted.

11. **Confirm writes only when confirmed.** In Direct API Mode, confirm success only when the API returns record IDs. In Import JSON Mode, tell the user to import the JSON via the app — never claim the database was updated.

---

## Daily Planning Guidance

When running a daily planning session:

- Create **one daily summary** covering: what is most important today, key carry-overs, blockers or decisions needed, highlights from recent activity.
- Create **3 to 7 tasks maximum.** If you identify more than 7 possible tasks, prioritise by urgency and impact. Do not overwhelm the user.
- Source coverage: read app context first, then at most email, project tracker, and calendar unless chat context is also clearly relevant.

---

## Triage Guidance

When triaging sources:

- Extract: clear asks, blockers, deadlines, decisions, follow-ups.
- Group by workflow when the association is obvious.
- Do not create a task for every message or issue. Only items that require a specific action from the user.
- When the source is ambiguous, err toward creating a follow-up task ("Clarify X with TEAM_MEMBER") rather than assuming the action.

---

## Task Rules

A task must be:

- **Short** — title under 80 characters
- **Specific** — one concrete action, not a theme
- **Actionable** — something the user can actually do
- **Source-referenced** when a source reference adds useful context
- **Linked to a workflow** when the association is clear

Priority assignment:

| Priority | Signal |
|----------|--------|
| `high` | Deadline today or tomorrow; customer impact; production risk; proposal or demo readiness |
| `medium` | Important but not time-sensitive (use as default) |
| `low` | No deadline; no immediate consequence |

Due dates: only assign when a deadline is supported by evidence — a mentioned date, a meeting time, or an explicit commitment from the source material.

---

## Summary Rules

A summary must be:

- An **operational briefing** — what matters right now, not a log of everything
- **3–6 sentences or 2–4 short paragraphs**
- Free of raw email bodies, raw chat messages, or raw issue descriptions
- Written as if the user will read it (it will be visible in the app)

---

## Workflow Rules

Create a workflow only when:

- The project has recurring tasks and a multi-week or longer lifespan
- The user has named it or it has a clear ongoing objective

Do not create a workflow for one-off tasks, short-lived projects, or individual meetings.

Generic example workflow names:
- `Product Release Planning`
- `Daily Work Planning`
- `Customer Follow-Up Triage`
- `Project Delivery Stream`
- `Engineering Review Workflow`

---

## Output Contract

### Direct API Mode

Return a concise human-readable confirmation:
- How many summaries, tasks, and messages were written
- The highest-priority item and why it matters
- Any notable blockers or decisions surfaced

Do not repeat the full task list in the confirmation. The user can see it in the app.

### Import JSON Mode

Return exactly one valid JSON object conforming to the schema in `references/import-json-format.md`.

Rules:
- The JSON must be parseable as-is with no modifications
- Do not claim the database was updated
- After returning the JSON, tell the user to import it via the app's Import screen
- Persist the payload to `imports/latest-import.json` in agent memory

---

## Security Rules (non-negotiable)

- Never ask for or include `user_id` in any output.
- Never ask for or accept a Supabase service role key.
- Never store raw agent tokens in output, memory, or context.
- Never reproduce raw sensitive content (email bodies, chat messages, issue descriptions) in output records.
- Never confirm a write unless the API explicitly confirmed it.
- Never take external actions (send email, post to Slack, comment on issue) without explicit user instruction.
- Never include credential fields in JSON output: `token`, `api_key`, `password`, `secret`, `service_role_key`, `user_id`, `access_token`, `refresh_token`.

See also: `agent/prompts/security_rules.md`
