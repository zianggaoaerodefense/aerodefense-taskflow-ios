# Import JSON Format

This document defines the exact JSON contract for Import JSON Mode. When no HTTP/API tool is available, the agent returns a single JSON object in this format. The user imports it into the app's **Import** screen.

---

## Output Rules

- Output must be a **single valid JSON object**. No array at the top level.
- **No markdown wrapper** in pure import mode. Do not wrap the JSON in triple backticks or any other markup.
- **Do not claim a write occurred.** After returning the JSON, tell the user to import it via the app.
- **Persist the latest payload** to a memory location such as `imports/latest-import.json` so it can be referenced or re-submitted.
- All string values must be properly escaped. No trailing commas.

---

## Full Schema

```json
{
  "mode": "import_json",
  "version": "1.0",
  "source": "chatgpt_agent",
  "created_at": "<ISO 8601 datetime — e.g. 2024-01-15T09:00:00Z>",

  "summary": {
    "title": "Daily Planning — YYYY-MM-DD",
    "body": "A 2–4 paragraph operational briefing. What matters most today, carry-overs, blockers, and highlights.",
    "summary_date": "YYYY-MM-DD",
    "time_period": {
      "label": "today",
      "start_at": "<ISO datetime or null>",
      "end_at": "<ISO datetime or null>"
    },
    "source_coverage": ["email", "project_tracker", "chat", "calendar", "app_context"],
    "source_details": [
      {
        "source": "email",
        "coverage_note": "Reviewed inbox for the past 24 hours.",
        "items_reviewed": "12 messages"
      },
      {
        "source": "project_tracker",
        "coverage_note": "Checked open issues assigned to me and items in the current sprint.",
        "items_reviewed": "8 issues"
      }
    ],
    "priority_assessment": {
      "overall_priority": "high",
      "urgency": "high",
      "reason": "Two deadlines fall this week and one active blocker is unresolved."
    },
    "important_first": [
      {
        "title": "Unblock the staging deployment",
        "why_it_matters": "QA is blocked and the release date is Thursday.",
        "urgency": "high",
        "priority": "high",
        "source": "project_tracker",
        "source_ref": "Issue #142 — deployment pipeline failure",
        "recommended_action": "Investigate the pipeline failure and coordinate a fix with the infrastructure team."
      }
    ],
    "key_decisions": [
      "Agreed to push the feature freeze to next Monday to accommodate the new requirements."
    ],
    "blockers": [
      "Staging deployment pipeline is failing — blocking QA."
    ],
    "risks": [
      "If the deployment blocker is not resolved by Wednesday, the Thursday release date is at risk."
    ],
    "follow_ups": [
      "Follow up with TEAM_MEMBER on the vendor proposal by end of day."
    ],
    "next_actions": [
      "Investigate staging pipeline failure",
      "Confirm feature freeze date with the team",
      "Send follow-up to vendor"
    ]
  },

  "workflows": [
    {
      "name": "Product Release Planning",
      "objective": "Ship the Q2 product release on schedule.",
      "status": "active",
      "current_focus": "Unblocking QA and finalising the release candidate.",
      "cadence": "daily",
      "next_review_at": null
    }
  ],

  "tasks": [
    {
      "title": "Investigate staging pipeline failure",
      "description": "Pipeline has been failing since yesterday's deploy. Check recent changes and infra logs.",
      "priority": "high",
      "urgency": "high",
      "status": "open",
      "due_at": null,
      "workflow_name": "Product Release Planning",
      "source": "project_tracker",
      "source_ref": "Issue #142",
      "duplicate_check_note": "No existing open task with this title found in app context.",
      "why_now": "QA is blocked. Release date is Thursday."
    },
    {
      "title": "Follow up with TEAM_MEMBER on vendor proposal",
      "description": "Initial email sent yesterday. If no response by end of day, follow up directly.",
      "priority": "medium",
      "urgency": "medium",
      "status": "open",
      "due_at": "2024-01-15T17:00:00Z",
      "workflow_name": "Customer Follow-Up Triage",
      "source": "email",
      "source_ref": "Email thread: Proposal for PROJECT_NAME — sent 2024-01-14",
      "duplicate_check_note": "No existing open task with this title found in app context.",
      "why_now": "Proposal deadline is end of week."
    }
  ],

  "agent_message": {
    "content": "Daily planning complete. Created 2 tasks and 1 summary. Highest priority: staging pipeline failure is blocking QA ahead of Thursday's release. Import this JSON via the app's Import screen to save these records."
  }
}
```

---

## Field Reference

### Top-level fields

| Field | Required | Description |
|-------|----------|-------------|
| `mode` | yes | Always `"import_json"` in import mode. |
| `version` | yes | Always `"1.0"` for this schema version. |
| `source` | yes | The agent runtime that produced this payload. E.g., `"chatgpt_agent"`. |
| `created_at` | yes | ISO 8601 datetime when this payload was generated. |

### summary object

| Field | Required | Description |
|-------|----------|-------------|
| `title` | yes | Short descriptive title. |
| `body` | yes | 3–6 sentences of operational narrative. No raw content. |
| `summary_date` | yes | Date this summary covers. `YYYY-MM-DD`. |
| `time_period` | yes | `label`, `start_at`, `end_at`. Label: `today`, `this week`, or `custom`. |
| `source_coverage` | yes | Array of source categories reviewed. |
| `source_details` | no | Per-source coverage notes. Useful for transparency. |
| `priority_assessment` | yes | `overall_priority`, `urgency`, `reason`. |
| `important_first` | yes | Ordered array of the most important items. At least one entry. |
| `key_decisions` | no | Array of strings. Decisions made or needed. |
| `blockers` | no | Array of strings. Active blockers. |
| `risks` | no | Array of strings. Identified risks. |
| `follow_ups` | no | Array of strings. Items to follow up on. |
| `next_actions` | no | Array of strings. Recommended next steps. |

### important_first item

| Field | Required | Description |
|-------|----------|-------------|
| `title` | yes | Short title for the item. |
| `why_it_matters` | yes | One sentence explaining the significance. |
| `urgency` | yes | `low`, `medium`, or `high`. |
| `priority` | yes | `low`, `medium`, or `high`. |
| `source` | yes | Which source category surfaced this. |
| `source_ref` | no | Brief reference (subject line, issue number, thread title). |
| `recommended_action` | no | What the agent recommends doing. |

### workflows array item

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Exact workflow name. Will be matched against existing workflows on import. |
| `objective` | no | What this workflow is trying to achieve. |
| `status` | yes | `active`, `paused`, or `completed`. |
| `current_focus` | no | What is being worked on right now. |
| `cadence` | no | `daily`, `weekly`, or `ad_hoc`. |
| `next_review_at` | no | ISO datetime or null. |

### tasks array item

| Field | Required | Description |
|-------|----------|-------------|
| `title` | yes | Under 80 characters. Specific action. |
| `description` | no | Under 300 characters. No raw email/chat content. |
| `priority` | yes | `low`, `medium`, or `high`. Default: `medium`. |
| `urgency` | no | `low`, `medium`, or `high`. |
| `status` | yes | Always `open` for agent-created tasks. |
| `due_at` | no | ISO datetime or null. Only when evidence supports a deadline. |
| `workflow_name` | no | Exact workflow name for linking. |
| `source` | yes | `email`, `project_tracker`, `chat`, `calendar`, `chatgpt_agent`, or `app_context`. |
| `source_ref` | no | Brief reference to the source item. |
| `duplicate_check_note` | no | Confirmation that no duplicate was found. |
| `why_now` | no | One sentence explaining why this task is relevant now. |

### agent_message object

| Field | Required | Description |
|-------|----------|-------------|
| `content` | yes | Concise message. No raw sensitive content. Tells the user what was prepared and reminds them to import. |

---

## Omitting Sections

- If there are no workflows to create or update, omit the `"workflows"` array or set it to `[]`.
- If there are no tasks (for example, all items are already open in the app), set `"tasks"` to `[]` and explain in `agent_message.content`.
- The `"summary"` object is required for daily and weekly planning runs. It may be omitted for pure task-only triage runs.

---

## What Not to Include

Never include these fields anywhere in the JSON output:

- `user_id`
- `token` / `api_key` / `auth_token` / `access_token` / `refresh_token`
- `password` / `secret` / `service_role_key` / `private_key`
- Raw email bodies, raw chat messages, raw issue descriptions
- Personal names or company-specific identifiers (use generic references like `TEAM_MEMBER`, `PROJECT_NAME`)
