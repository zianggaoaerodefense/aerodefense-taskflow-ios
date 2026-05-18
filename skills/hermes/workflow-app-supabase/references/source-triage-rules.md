# Source Triage Rules

This document defines the order in which the agent reads available sources and the extraction behaviour for each source category.

---

## Source Priority Order

Always read sources in this order. Stop reading when you have enough context to complete the current task.

| Order | Source | Category | Why first |
|-------|--------|----------|-----------|
| 1 | Workflow app | `app_context` | Ground truth for current task state. Prevents duplicates. Required for any write operation. |
| 2 | Email | `email` | High-signal source for commitments, asks, and deadlines. |
| 3 | Project tracker | `project_tracker` | Issues, PRs, sprint board — explicit assigned work. |
| 4 | Chat | `chat` | Decisions, blockers, open threads. Often contains the fastest-moving context. |
| 5 | Calendar | `calendar` | Upcoming meetings, prep required, event-linked deadlines. |
| 6 | Knowledge base / notes | `memory` | Standing priorities, key contacts, recurring commitments. Read when context is ambiguous. |

**Important:** Do not read all sources for every operation. Only read a source if it is materially relevant to the current request. For a quick task-only run, app context plus one or two sources is usually sufficient. For a full daily planning run, read all that are available.

---

## What to Extract

For every source reviewed, look for:

### Commitments

Something the user has promised to do, or that has been assigned to them.

- Signals: "I'll handle", "Can you", "Please review", "Assigned to you", "@mention with a request"
- Extract as: a task with `why_now` explaining the commitment source

### Blockers

Something that is preventing progress on a known task or project.

- Signals: "waiting on", "blocked by", "can't proceed until", "failing", "broken", "no response"
- Extract as: a task ("Unblock X") or a blocker entry in the summary
- Note: a blocker task has priority `high` or `critical`

### Decisions

A decision that was made, or a decision that needs to be made.

- Signals: "we decided", "agreed to", "need to decide", "your call", "waiting for your input"
- Decided: record in `summary.key_decisions`
- Pending: create a task ("Decide on X") with the deadline if known

### Deadlines

A date or time by which something must be done.

- Signals: explicit dates, "by end of week", "before the meeting", "EOD", "Thursday release"
- Extract as: `due_at` on the relevant task
- Only set `due_at` when the deadline is explicit — do not infer from urgency

### Follow-ups

An item the user said they would follow up on, or where someone is waiting for a response.

- Signals: "following up", "let me know", "waiting to hear back", "no response yet"
- Extract as: a task ("Follow up with TEAM_MEMBER on X") with a due date if mentioned

### Explicit asks

A direct request for the user to do something.

- Signals: "can you", "please", "I need you to", "could you review", "@mention + action"
- Extract as: a task if specific and actionable

### Likely next actions

Things the user will probably need to do based on context, even if not explicitly stated.

- Signals: a meeting just happened → follow-up likely needed; a PR was approved → merge needed; a proposal went out → follow-up needed
- Extract as: a task with `why_now` explaining the inference
- Label these clearly — do not present inferred actions as confirmed commitments

---

## Per-Source Extraction Guidance

### app_context

This is always the first source to read.

Extract:
- `open_tasks` — to prevent duplicates
- `recently_completed_tasks` — to understand what was done
- `recent_task_events` — to understand user feedback (rejections, comments, status changes)
- `recent_summaries` — to avoid repeating yesterday's summary
- `active_workflows` — to link new tasks to the correct workflow

Never create a task that already exists in `open_tasks`. Check by title similarity.
Never recreate a task the user has rejected or archived.

### email

Read subject lines and brief summaries only. Do not reproduce raw email bodies in task descriptions or summaries.

Look for:
- Explicit asks in subject or first line
- Commitments made by the user in sent mail
- Deadlines mentioned in thread subjects
- Unanswered threads that require a response

Skip:
- Newsletters, automated notifications, and FYI messages
- Threads the user is CC'd on with no action required
- Threads where a response has already been sent

### project_tracker (Jira, Linear, Asana, ClickUp, GitHub Issues, etc.)

Read issue titles and status only. Do not reproduce raw issue descriptions.

Look for:
- Issues assigned to the user that are open
- Issues in the current sprint that are blocked or stale
- PRs awaiting the user's review
- Issues where the user is mentioned and a response is expected

Skip:
- Issues assigned to others with no action required from this user
- Closed or resolved issues
- Backlog items not in the current sprint (unless the user asks for them)

### chat (Slack, Teams, etc.)

Read thread summaries only. Do not reproduce raw chat messages.

Look for:
- Open questions or requests directed at the user
- Decisions made in threads that affect tasks or workflows
- Blockers mentioned in channels the user monitors
- Follow-ups the user agreed to in a thread

Skip:
- General conversation with no action required
- Threads where the user has already responded and no further action is needed
- System notifications

### calendar

Read event titles and times. Do not read meeting notes or attachments unless specifically relevant.

Look for:
- Upcoming meetings that require preparation (agenda, materials, review)
- Recurring events with an output expected (weekly status, stand-up, review)
- Events that imply a deadline ("pre-launch review" → launch is coming)
- Events the user just attended that likely need follow-up

Skip:
- Events with no prep or follow-up required
- Events the user is merely observing (no action required)

---

## Grouping by Workflow

When extracting tasks from multiple sources, group them by workflow:

- If a task is clearly related to an active workflow (same project, same product area, same customer), link it to that workflow via `workflow_name`.
- If a task does not clearly belong to a workflow, leave `workflow_name` null.
- Do not create a new workflow just to link a task. Only create workflows for ongoing project streams.

---

## Volume Control

Triage should surface signal, not noise.

- **Daily planning:** 3–7 tasks maximum. If you identify more, prioritise by urgency and impact. Present the rest in `next_actions` in the summary.
- **Full triage run:** Up to 10 tasks. More than that suggests you are including items that should remain in the project tracker.
- **Quick triage:** 3–5 tasks. For a focused request ("what do I need to do this afternoon?").

When in doubt, create fewer tasks and make them more specific. A short, focused task list is more useful than a long, overwhelming one.
