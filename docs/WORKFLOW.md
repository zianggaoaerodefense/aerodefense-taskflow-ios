# Workflow Documentation

This document describes the end-to-end Daily Workflow Management process — how the agent, database, and mobile app work together across a typical day.

---

## Task Statuses

| Status | Description |
|--------|-------------|
| `suggested` | Created by the agent, awaiting user review |
| `open` | Accepted by the user, not yet started |
| `in_progress` | Actively being worked on |
| `waiting` | Snoozed or blocked on external input |
| `blocked` | Cannot proceed; a blocker is recorded |
| `done` | Completed |
| `archived` | Dismissed or no longer relevant |

### Status Flow

```
suggested ──→ open ──→ in_progress ──→ done ──→ archived
                           │
                           └──→ waiting ──→ (back to in_progress or done)
                           │
                           └──→ blocked ──→ (resolved, back to in_progress)
```

Rejected tasks move to `archived`. Snoozed tasks move to `waiting` with a `snoozed_until` timestamp.

---

## Morning Planning Flow

This is the primary daily workflow. Run this at the start of the day (or schedule it automatically).

1. **Agent reads prior context**
   - Calls `GET /functions/v1/agent-context`
   - Retrieves: open tasks, recently completed tasks, recent task events (user feedback, status changes), active workflows, recent summaries

2. **Agent reads available external context** (optional, based on your integrations)
   - Upcoming calendar events for the day
   - Unread email summaries
   - Slack threads or mentions
   - Jira issues assigned to you
   - GitHub PRs or issues awaiting action

3. **Agent generates a daily summary**
   - Identifies highlights, decisions, and blockers
   - Considers carry-over tasks from yesterday

4. **Agent extracts suggested tasks**
   - Creates task cards for actionable items
   - Assigns priority based on urgency and importance
   - Links tasks to workflows where applicable
   - Avoids duplicating tasks that are already open

5. **Agent writes to Supabase**
   - Calls `POST /functions/v1/agent-write` with the summary and tasks
   - Each new task triggers a `task_events` row (`actor='agent'`, `event_type='created'`)
   - An `audit_logs` entry records the agent write

6. **Mobile app refreshes**
   - Supabase Realtime fires when new tasks are inserted
   - The task list updates automatically

7. **User reviews suggested tasks in the app**
   - Accept: task moves to `open`
   - Start: task moves to `in_progress`
   - Reject: task moves to `archived`
   - Defer: task moves to `waiting` with a snooze time
   - Comment: user adds a note for context

---

## During-Day Flow

1. **User checks off completed tasks**
   - Tap "Complete" → status becomes `done`
   - A `task_events` row is inserted (`actor='user'`, `event_type='completed'`)

2. **User adds comments or updates**
   - Comments stored in `task_events` as details
   - Visible to the agent on the next context fetch

3. **User creates manual tasks**
   - Any task created in the app gets `source='user'`
   - Included in agent context on the next run

4. **Agent can run mid-day** (optional)
   - Calls `agent-context` to see what has changed
   - May create follow-up tasks or update existing ones via `agent-update-task`
   - All agent updates are logged in `task_events` and `audit_logs`

5. **Supabase Realtime keeps the app in sync**
   - Any agent write triggers a live update in the app
   - No manual refresh required

---

## End-of-Day Flow

1. **Agent reviews completed tasks**
   - Calls `agent-context` for `recently_completed_tasks`
   - Reviews `task_events` for user feedback and comments

2. **Agent generates an end-of-day summary**
   - Summarises what was accomplished
   - Notes what was deferred or blocked

3. **Agent identifies carry-over tasks**
   - Tasks still in `open` or `in_progress` status
   - Updates descriptions or priorities as needed via `agent-update-task`

4. **Agent creates tomorrow's suggested follow-ups**
   - Writes pre-planned tasks for the next day
   - These appear in the app for the user to review in the morning

---

## Agent Context Structure

The agent-context response includes:

```json
{
  "open_tasks": [
    {
      "id": "uuid",
      "title": "Review pull request",
      "description": "Three PRs need review",
      "status": "open",
      "priority": "high",
      "due_at": null,
      "created_at": "2024-01-15T08:00:00Z"
    }
  ],
  "recently_completed_tasks": [...],
  "recent_task_events": [
    {
      "task_id": "uuid",
      "actor": "user",
      "event_type": "status_changed",
      "previous_status": "open",
      "new_status": "done",
      "details": { "comment": "Done, PR merged" },
      "created_at": "2024-01-15T14:30:00Z"
    }
  ],
  "active_workflows": [...],
  "recent_summaries": [...],
  "recent_agent_messages": [...]
}
```

---

## Data Flow Diagram

```
External sources (email, calendar, Jira, Slack, GitHub, notes)
    │
    ▼
AI Agent reads context from agent-context endpoint
    │
    ├── Prior open tasks
    ├── Completed tasks
    ├── User feedback (task_events)
    └── Recent summaries
    │
    ▼
Agent generates summary + extracts tasks
    │
    ▼
Agent calls agent-write endpoint
    │
    ▼
Supabase Postgres stores summary + tasks
    │
    ├── task_events rows created (actor=agent)
    └── audit_logs row created
    │
    ▼
Supabase Realtime fires event
    │
    ▼
Mobile app updates task list
    │
    ▼
User reviews, accepts, completes, rejects tasks
    │
    ▼
App writes task updates + task_events (actor=user)
    │
    ▼
Next agent run reads updated state via agent-context
```

---

## Workflow Skills

A "workflow skill" is a reusable instruction package that tells the agent how to perform a specific part of the workflow. Skills are documented in `agent/skills/README.md` and implemented as prompt files in `agent/prompts/`.

Available skills:

| Skill | Description |
|-------|-------------|
| Daily summary | Summarise work context into a structured daily overview |
| Task extraction | Extract actionable tasks from messages, emails, and documents |
| Workflow update | Update existing workflow state based on completed actions |
| Blocker detection | Identify and flag items that are blocked |
| Priority review | Review and re-prioritise open tasks |
| End-of-day wrap-up | Summarise the day and prepare tomorrow's agenda |

---

## Task Event Types

| Event type | Triggered by | Description |
|-----------|-------------|-------------|
| `created` | Agent or user | New task created |
| `updated` | Agent or user | Task fields updated (title, description, priority) |
| `status_changed` | Agent or user | Status transition recorded |
| `snoozed` | User | Task snoozed until a future time |
| `completed` | User | Task marked done |
| `archived` | User | Task dismissed/archived |

---

## Privacy and Safety

- Task summaries and content may contain information from your work tools. Treat `summaries.content` as potentially sensitive.
- The agent should prefer storing summaries and references rather than raw email bodies, Slack messages, or Jira content.
- All agent writes are recorded in `audit_logs` for review.
- The user must explicitly approve any external action (email send, Jira comment, Slack message) before the agent takes it.
