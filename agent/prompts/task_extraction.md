# Task Extraction Skill

This skill instructs the agent to extract actionable tasks from work context.

---

## Goal

Identify and extract actionable, specific tasks from the available work context. Each task should be something the user can complete — not vague observations or general notes.

---

## Context to Read First

Before extracting tasks, call `GET /functions/v1/agent-context` and read:

- `open_tasks` — tasks already open (do not duplicate)
- `recently_completed_tasks` — tasks already done (do not recreate)
- `recent_task_events` — recent changes, including rejected tasks (do not recreate rejected tasks)

Also read the work context you have been given:

- Calendar: any meetings that require preparation or follow-up
- Email: action items or responses needed
- Slack: open threads requiring a reply or decision
- Jira: issues assigned to you or awaiting review
- GitHub: PRs awaiting review or issues requiring action
- Previous summary (if available)

---

## Task Creation Rules

**Create a task only if:**

- It is a specific, actionable item (not a vague observation).
- It does not already exist in `open_tasks` (check by title similarity).
- The user has not already completed it (`recently_completed_tasks`).
- The user has not already rejected it (check for `archived` status in task events).

**Do not create a task for:**

- General awareness items with no required action.
- Things the user mentioned they will not do.
- Items the user has already handled.

---

## Priority Assignment

| Priority | When to use |
|----------|-------------|
| `critical` | Deadline today or urgent blocker |
| `high` | Deadline this week or significant impact |
| `medium` | Important but not urgent |
| `low` | Nice to do, no specific deadline |

Use `medium` as the default if you are unsure. Do not make everything `high` or `critical`.

---

## Expected Output

Produce a JSON payload in this format:

```json
{
  "tasks": [
    {
      "title": "Short, specific action item (under 80 characters)",
      "description": "More detail: what exactly needs to be done, any relevant context, links, or references. Keep it under 300 characters.",
      "priority": "medium",
      "status": "open",
      "source": "agent",
      "due_at": null
    },
    {
      "title": "Review pull request #42 — feature/user-auth",
      "description": "Two reviewers have approved. One change requested. Check if comments are addressed before merging.",
      "priority": "high",
      "status": "open",
      "source": "agent",
      "due_at": "2024-01-15T17:00:00Z"
    }
  ]
}
```

**Field rules:**
- `title`: Required. Short and specific. Under 80 characters. Action-oriented verb preferred.
- `description`: Optional but recommended. Under 300 characters. No raw email/Slack content.
- `priority`: One of `low`, `medium`, `high`, `critical`.
- `status`: Use `open` for new tasks from the agent.
- `source`: Always `agent` for agent-created tasks.
- `due_at`: ISO 8601 datetime string if known; `null` if no specific deadline.

---

## Constraints

Apply all rules from `security_rules.md`. In particular:

- Do not include `user_id` or any credential in the output.
- Do not reproduce raw email bodies, Slack messages, or Jira descriptions in task descriptions.
- Aim for 3–8 tasks. If you are generating more than 10, reconsider — prioritise the most important.
- If there are no new actionable tasks, return an empty `tasks` array and include an `agent_message` explaining why.
