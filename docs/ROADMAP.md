# Roadmap

This document describes the current development phase and planned future work for the Daily Workflow Management App.

---

## Current Phase — MVP (Phase 2)

The current codebase includes a complete MVP with the following capabilities:

| Feature | Status |
|---------|--------|
| Supabase Postgres schema with 10 tables | ✅ Done |
| Row-Level Security on all user-owned tables | ✅ Done |
| Supabase Auth (email/password) | ✅ Done |
| Expo React Native mobile app | ✅ Done |
| Expo Router tab navigation | ✅ Done |
| Task list screen | ✅ Done |
| Summaries screen | ✅ Done |
| Workflows screen | ✅ Done |
| Settings screen | ✅ Done |
| Agent connection management (create/revoke tokens) | ✅ Done |
| Supabase Edge Functions for agent | ✅ Done |
| Agent context endpoint | ✅ Done |
| Agent write endpoint (summaries, tasks, messages) | ✅ Done |
| Agent task update endpoint | ✅ Done |
| Supabase Realtime (live task refresh) | ✅ Done |
| SecureStore hardware-backed sessions | ✅ Done |
| Append-only audit logs and task events | ✅ Done |
| Agent JSON import/validation in app | ✅ Done |

---

## Phase 3 — External Integrations

The following features are planned for a future phase. Implementation requires additional OAuth setup, external API access, and server-side credential management.

| Feature | Notes |
|---------|-------|
| Gmail read integration | Read inbox, drafts, and threads for agent context |
| Gmail draft integration | Agent can propose email drafts for user approval |
| Google Calendar integration | Read upcoming events for daily planning |
| Slack read integration | Read relevant messages and threads |
| Slack draft integration | Agent proposes messages; user approves before sending |
| Jira read integration | Read assigned issues, sprint board, and comments |
| Jira comment integration | Agent can propose Jira comments; user approves |
| GitHub integration | Read PRs, issues, and review requests |
| Push notifications | Notify user when agent creates new tasks |
| TestFlight distribution | Beta app distribution via Apple TestFlight |

**Important:** All external send actions (email, Slack, Jira comments) will require explicit user approval before sending. The agent will propose drafts; the user must approve.

---

## Phase 4 — Production Hardening

| Feature | Notes |
|---------|-------|
| Field-level encryption | Encrypt `summaries.content` and `agent_messages.content` at rest using Supabase Vault |
| Rate limiting | Per-user rate limits on Edge Function endpoints |
| Token expiry enforcement | Enforce `expires_at` on agent connections |
| Push notification security | Ensure notification payloads contain no sensitive data |
| EAS Build configuration | Automated iOS and Android builds |
| App Store submission | Public or enterprise distribution |
| Performance monitoring | Optional: Sentry or similar (privacy-preserving) |

---

## Non-Goals

The following are explicitly not planned:

- **Public App Store release** as a managed service — this is an open-source self-hosted project.
- **Direct Postgres access** from the mobile app or AI agent.
- **Analytics or tracking** of user behaviour.
- **Automatic external sending** without explicit user approval.
- **Shared multi-tenant cloud hosting** — each user/organisation runs their own Supabase project.

---

## Contributing

See `docs/CONTRIBUTING.md` for how to contribute features, bug fixes, or documentation improvements.

Ideas for contributions:

- Additional agent prompt templates (`agent/prompts/`)
- Example integrations (Notion, Linear, Asana, etc.)
- Android-specific UI improvements
- Additional task filtering and sorting options
- Offline support with local caching
- Dark mode improvements
- Accessibility improvements

---

## Legacy Architecture

The repository also contains legacy reference implementations that are not the active development path:

- `ios/` — SwiftUI prototype (Phase 1). Preserved as reference for the native iOS implementation patterns.
- `backend/` — AWS Lambda + MongoDB Atlas implementation. Preserved as a reference for teams that need to scale beyond Supabase limits.

These are not maintained and may be removed in a future major version.
