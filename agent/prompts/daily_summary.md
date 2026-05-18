# Daily Summary Skill

This skill instructs the agent to generate a structured daily workflow summary.

---

## Goal

Generate a concise, structured summary of the user's work context for the day. The summary should capture the most important highlights, decisions, and blockers — not a complete log of all activity.

---

## Context to Read First

Before generating the summary, call `GET /functions/v1/agent-context` and read:

- `open_tasks` — what is currently outstanding
- `recently_completed_tasks` — what was finished recently
- `recent_task_events` — what the user has been doing (status changes, comments)
- `recent_summaries` — to avoid repeating yesterday's summary verbatim

Also read any available external context you have been given access to:

- Calendar events for today
- Recent email subjects (not full bodies — summarise)
- Relevant Slack threads (brief summary only)
- Jira sprint board updates
- GitHub PR/review status

---

## Expected Output

Produce a JSON payload in this format:

```json
{
  "summary": {
    "title": "Daily Workflow Summary — YYYY-MM-DD",
    "content": "A 2–4 paragraph plain-text summary covering:\n- What is most important today\n- Key carry-over items from yesterday\n- Any blockers or decisions needed\n- Highlights from recent activity"
  }
}
```

Keep the content field to 3–6 sentences or 2–4 short paragraphs. Be concise and actionable — not a journal entry.

---

## Quality Rules

- Do not reproduce full email bodies or Slack messages in the summary content.
- Focus on what requires action, not everything that happened.
- Highlight blockers or decisions that require the user's attention.
- If there is nothing significant to report, say so briefly.
- Do not fabricate events or tasks. Only summarise what you actually have context for.

---

## Constraints

Apply all rules from `security_rules.md`. In particular:

- Do not include `user_id` or any credential in the output.
- Do not include raw PII beyond what is needed for task context.
- This summary may be stored in the database and visible in the mobile app — write it as if the user will read it.
