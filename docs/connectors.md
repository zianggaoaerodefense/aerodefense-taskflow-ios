# Connectors — Tool Category Mapping

The open-source Task Management Agent setup is **tool-category-based, not vendor-locked**. The agent works with abstract source categories rather than specific tool names. You map these categories to the tools you actually use.

This means the skill package works regardless of whether you use Slack or Teams, Gmail or Outlook, Jira or Linear — you just map the category to your tool.

---

## Source Categories

| Category | What it provides | Example tools |
|----------|-----------------|---------------|
| `app_context` | Current task state, recent summaries, active workflows | The workflow app itself (via `agent-context` endpoint) |
| `email` | Inbox, commitments, asks, follow-ups, deadlines | Gmail, Outlook, any IMAP/SMTP provider |
| `chat` | Messages, decisions, open threads, blockers | Slack, Microsoft Teams, Discord, Mattermost |
| `calendar` | Meetings, events, prep requirements, event-linked deadlines | Google Calendar, Outlook Calendar, CalDAV providers |
| `project_tracker` | Issues, PRs, sprint boards, assigned work | Jira, Linear, Asana, ClickUp, GitHub Issues, GitLab Issues, Shortcut |
| `memory` / `notes` | Standing priorities, key contacts, recurring commitments | Notion, Google Drive, Obsidian, Bear, Apple Notes, any document store |

---

## Mapping Examples

Here are some common tool combinations and how to map them:

### Example A — Startup stack

| Category | Tool |
|----------|------|
| `app_context` | This app (workflow app + Supabase) |
| `email` | Gmail (via Google Workspace) |
| `chat` | Slack |
| `calendar` | Google Calendar |
| `project_tracker` | Linear |
| `memory` | Notion |

### Example B — Enterprise stack

| Category | Tool |
|----------|------|
| `app_context` | This app (workflow app + Supabase) |
| `email` | Outlook (Microsoft 365) |
| `chat` | Microsoft Teams |
| `calendar` | Outlook Calendar |
| `project_tracker` | Jira |
| `memory` | SharePoint / Confluence |

### Example C — Engineering team stack

| Category | Tool |
|----------|------|
| `app_context` | This app (workflow app + Supabase) |
| `email` | Gmail |
| `chat` | Slack |
| `calendar` | Google Calendar |
| `project_tracker` | GitHub Issues + pull requests |
| `memory` | GitHub Wiki / markdown files in repo |

### Example D — Minimal setup (no integrations)

| Category | Tool |
|----------|------|
| `app_context` | This app (workflow app + Supabase) |
| `email` | None connected — user pastes relevant emails manually |
| `chat` | None connected |
| `calendar` | None connected |
| `project_tracker` | None connected |
| `memory` | None connected |

In the minimal setup, the agent still works — it reads app context and the user pastes any relevant context into the conversation manually. Import JSON Mode is the natural fit here.

---

## How to Connect a Tool

The method depends on your agent runtime:

### ChatGPT Custom GPT

Use the ChatGPT GPT configuration to connect tools via:
- **GPT Actions** — for tools with a REST API (including this app's Supabase Edge Functions)
- **File uploads** — for documents, exported notes, or context files
- **Built-in browsing** — for publicly accessible content

ChatGPT also offers native integrations for some tools (Google Drive, OneDrive, etc.) depending on your account type.

### Claude agent

Use Anthropic's tool use API or Claude agent integrations to connect:
- HTTP tools for REST APIs
- Computer use or browser tools for web-based tools
- File tools for document stores

### Custom script or automation

For custom runtimes (GitHub Actions, cron jobs, Langchain, etc.):
- Use OAuth 2.0 to connect email and calendar providers
- Use API tokens for project trackers
- Pass context as structured input to the agent's system message or prompt

---

## Privacy and Credential Rules

- Never expose OAuth tokens, API keys, or passwords in the agent's system prompt or output.
- Store all integration credentials in your runtime's secret management (environment variables, secrets manager, GPT Action credentials).
- The agent should receive summaries and excerpts from connected tools — not raw credential-containing payloads.
- Only grant the agent read access to the sources it needs. Write access to external tools (sending email, posting Slack, creating Jira issues) should require explicit user approval.

---

## Adapting the Skill for Your Tools

The skill's source triage rules in `skills/hermes/workflow-app-supabase/references/source-triage-rules.md` reference generic source categories (`email`, `chat`, `calendar`, `project_tracker`). If your agent runtime knows which specific tool you're using, you can add tool-specific notes to your system prompt, for example:

```
For the project_tracker category, read from Linear.
My workspace uses sprints of 2 weeks.
Issues assigned to me in the "In Progress" and "In Review" columns are active.
```

The skill will apply its extraction logic to whatever context you provide — the tool name does not need to change the core behaviour.
