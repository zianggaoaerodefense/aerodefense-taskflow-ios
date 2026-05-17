# Workflow Update Skill

This skill instructs the agent to update existing workflow state — carry-over tasks, stale tasks, and end-of-day summaries.

---

## Goal

Review the current open tasks and update their state based on:

- What the user has completed (visible in `recently_completed_tasks` and `recent_task_events`)
- What has been deferred or is blocked
- What is stale and should be re-prioritised or archived
- What should be carried over to tomorrow with updated context

---

## Context to Read First

Call `GET /functions/v1/agent-context` and read all fields:

- `open_tasks` — what is still open
- `recently_completed_tasks` — what was finished
- `recent_task_events` — user feedback, status changes, comments
- `recent_summaries` — prior context
- `active_workflows` — named workflows to link tasks to

---

## Decision Logic

For each open task, decide:

| Condition | Action |
|-----------|--------|
| User completed it outside the app (you know from email/Jira/GitHub) | Call `agent-update-task` to set `status: "done"` |
| Task is stale (no activity in 3+ days, still open) | Optionally update description with a note; do not archive without user confirmation |
| Task priority has changed based on new context | Call `agent-update-task` to update `priority` |
| Task is clearly blocked | Call `agent-update-task` to set `status: "waiting"` with a description update |
| Task description needs updated context | Call `agent-update-task` to update `description` |

Do not archive or delete tasks — that is the user's decision.

---

## Expected Output

For tasks that need updating, call `POST /functions/v1/agent-update-task`:

```json
{
  "task_id": "uuid-of-existing-task",
  "status": "done",
  "description": "Updated: completed in code review session this afternoon."
}
```

You may also write a workflow update agent message:

```json
{
  "agent_message": {
    "content": "End-of-day update: 3 tasks completed, 2 carried over to tomorrow. Main blocker: waiting on design review for the settings screen.",
    "role": "agent"
  }
}
```

---

## End-of-Day Wrap-Up

When running as an end-of-day workflow update:

1. Review completed tasks and note what was accomplished.
2. Identify carry-over tasks — update their descriptions if context has changed.
3. Note any blockers that remain unresolved.
4. Identify what should be followed up on tomorrow.
5. Write a brief end-of-day `agent_message` summarising the day.

---

## Constraints

Apply all rules from `security_rules.md`. In particular:

- Do not mark tasks as done unless you are confident the work is actually complete.
- Do not create new tasks in this skill — use the task extraction skill for that.
- Do not archive tasks without strong evidence that they are no longer needed.
- Never update `user_id` or any credential field.
