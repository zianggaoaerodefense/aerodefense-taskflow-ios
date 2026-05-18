# Record Schemas — Workflow App

This document describes the record types the agent works with. Each record type has a distinct role in the data model. Understanding these roles is essential for creating correct, non-redundant records.

---

## Record Types

### tasks

A task is a single, concrete action item.

**When to create:** Only when you have identified a specific, actionable item that the user needs to do and that does not already exist in `open_tasks`.

**When not to create:**
- General awareness or observation items
- Things the user has already completed
- Things the user has rejected or archived
- Vague intentions without a clear next step
- Duplicates of existing open tasks (check by title similarity)

**Key fields:**

| Field | Type | Rules |
|-------|------|-------|
| `title` | string (required) | Under 80 characters. Action-oriented. Specific. |
| `description` | string (optional) | Under 300 characters. No raw email/chat bodies. |
| `priority` | enum | `low`, `medium`, `high`, `critical`. Default: `medium`. |
| `urgency` | enum | `low`, `medium`, `high`. Separate from priority. |
| `status` | enum | Always `open` when creating from the agent. |
| `due_at` | ISO datetime or null | Only set when evidence supports a specific deadline. |
| `workflow_name` | string or null | Exact workflow name when association is clear. |
| `source` | enum | `email`, `project_tracker`, `chat`, `calendar`, `chatgpt_agent`, `app_context` |
| `source_ref` | string or null | Brief reference to the source item (subject line, issue number, thread title). |

---

### summaries

A summary is a narrative or operational briefing. It is not a task list — it is the context that explains why the tasks matter.

**When to create:** Once per planning session (daily or weekly). Also useful for workflow-specific briefings.

**Key fields:**

| Field | Type | Rules |
|-------|------|-------|
| `title` | string (required) | Descriptive. E.g., "Daily Planning — YYYY-MM-DD". |
| `body` | string (required) | 3–6 sentences or 2–4 short paragraphs. No raw content. |
| `summary_date` | date | The date this summary covers. |
| `time_period` | object | `label`, `start_at`, `end_at` — the window of context covered. |
| `source_coverage` | array | Which sources were reviewed. |
| `priority_assessment` | object | Overall priority and urgency with a reason. |
| `important_first` | array | Ordered list of the most important items, each with a `why_it_matters`. |
| `key_decisions` | array | Decisions made or needed. |
| `blockers` | array | Active blockers. |
| `risks` | array | Identified risks. |
| `follow_ups` | array | Items to follow up on. |
| `next_actions` | array | Recommended next steps. |

---

### workflows

A workflow is an ongoing project stream — a named, multi-week effort with recurring tasks and a continuing objective.

**When to create:** Only for ongoing project streams. Not for one-off tasks, short-lived items, or individual meetings.

**When to update:** When the current focus, status, or next review date changes.

**Key fields:**

| Field | Type | Rules |
|-------|------|-------|
| `name` | string (required) | Short, descriptive. E.g., "Product Release Planning". |
| `objective` | string | What this workflow is trying to achieve. |
| `status` | enum | `active`, `paused`, `completed`. Default: `active`. |
| `current_focus` | string | What is being worked on right now. |
| `cadence` | enum | `daily`, `weekly`, `ad_hoc`. |
| `next_review_at` | ISO datetime or null | When this workflow should next be reviewed. |

---

### workflow_runs

A workflow run is a record of a single agent execution for a workflow. It links the agent's work to the workflow it was performed in context of.

**When to create:** Once per agent invocation, when the invocation was associated with a named workflow.

**Key fields:**

| Field | Type | Rules |
|-------|------|-------|
| `workflow_id` | UUID | The workflow this run belongs to. |
| `status` | enum | `running`, `completed`, `failed`. |
| `output` | JSON object or null | High-level summary of what the run produced (counts, not raw content). |

---

### task_events

Task events are the audit trail for task mutations. They are created automatically by the app and Edge Functions — the agent does not create them directly.

Each time a task is created or updated (by the agent or by the user), a `task_events` row is inserted. This table is append-only.

**Read** task events from `agent-context` to understand what the user has done to tasks (completed, commented, rejected, deferred).

---

### agent_messages

Agent messages are the agent's communications to the user, stored in the database. They appear in the app as messages from the agent.

**When to create:** After a planning session or triage run, write one `agent_message` summarising what was done and noting any important items.

**Key fields:**

| Field | Type | Rules |
|-------|------|-------|
| `content` | string (required) | Concise. No raw sensitive content. Written for the user to read. |
| `role` | enum | Always `agent` for agent-created messages. |

---

### audit_logs

Audit logs are written automatically by Edge Functions after every agent write operation. The agent does not create them directly.

Audit log payloads store counts and metadata only — never raw content, credentials, or PII.

---

## Duplication Rules

- Before creating a task, check `open_tasks` from `agent-context`. If a task with a similar title already exists and is open, update it instead of creating a new one.
- Before creating a workflow, check `active_workflows` from `agent-context`. Do not create a duplicate workflow.
- Only one summary per planning session. Do not create multiple daily summaries for the same date unless the user explicitly requests it.

---

## Due Date Rules

Only assign `due_at` when evidence supports a specific deadline:

- A date explicitly mentioned in the source material ("deadline Friday", "due by end of month")
- A meeting or event time that the task must be completed before
- An explicit commitment recorded in the source

Do not infer deadlines from general urgency. If a task is high-priority but has no specific deadline, leave `due_at` as null and set `priority: "high"`.
