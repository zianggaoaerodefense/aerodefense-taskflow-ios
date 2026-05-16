# AGENTS.md — TaskFlow Agent Instructions

These instructions apply to the entire repository. Follow them before making or reviewing changes.

## Project role split

- **Codex** is the architect and reviewer. Codex should review architecture, security, data model, API/agent contracts, and TestFlight/MVP readiness.
- **Claude** is the primary implementation coder. Claude should implement code, tests, migrations, screens, Edge Functions, and docs according to Codex-reviewed tickets.
- **The user** is the final approval authority.

## Current source-of-truth architecture

The MVP architecture is now:

- **Mobile app:** Expo / React Native under `app/`.
- **Auth:** Supabase Auth.
- **Database:** Supabase Postgres.
- **Authorization:** Supabase Row-Level Security (RLS).
- **Backend logic:** Supabase Edge Functions under `supabase/functions/`.
- **Agent interface:** ChatGPT Custom GPT.
- **Agent calls:** GPT Actions calling Supabase Edge Functions.
- **Shared types/contracts:** `packages/shared/` where practical.

Do **not** continue implementing new MVP features in the legacy AWS Lambda / MongoDB / SwiftUI architecture unless the user explicitly asks for legacy support.

Legacy/reference paths from the previous architecture:

- `ios/` — SwiftUI prototype/reference only.
- `backend/` — AWS Lambda/MongoDB prototype/reference only.
- `shared/schemas/` — previous JSON Schema contracts; prefer `packages/shared/` for the Supabase/Expo MVP.

Target MVP paths:

- `app/` — Expo / React Native app.
- `supabase/migrations/` — SQL schema, constraints, indexes, triggers, RLS, policies.
- `supabase/functions/` — Edge Functions, especially GPT Action endpoints.
- `packages/shared/` — shared TypeScript types, constants, validation schemas, and API contracts.
- `docs/` — architecture, security, deployment, and GPT Actions OpenAPI docs.

## Non-negotiable security rules

### Supabase and RLS

- Enable RLS on every user-owned table.
- Every user-owned table must include `user_id uuid not null references auth.users(id)` unless Codex explicitly approves another ownership model.
- RLS policies must restrict user access to rows where `auth.uid() = user_id`.
- Do not rely only on client-side filtering for authorization.
- If an Edge Function uses the Supabase service-role key, every query must explicitly scope by the authenticated or agent-mapped `user_id` because service-role bypasses RLS.

### Identity and request trust

- Never trust `user_id` from request bodies, query strings, path params, GPT Action input, or mobile app state.
- Mobile user identity must come from the verified Supabase Auth JWT.
- Agent identity must come from a verified agent token mapped through `agent_connections` to exactly one user.
- Edge Functions must ignore or reject body-supplied `user_id`.

### Agent tokens

- Raw agent tokens must never be stored.
- Store only salted/peppered hashes, token prefixes, scopes, created/revoked timestamps, and last-used metadata.
- Show raw agent tokens once at creation time only.
- Revoked agent tokens must fail immediately.
- Agent tokens must map to exactly one `user_id`.

### Secrets

- The mobile app may contain only public Supabase URL and anon key values.
- Never expose Supabase service-role keys in `app/`, Expo config, client bundles, logs, or docs examples.
- Never expose OpenAI API keys, GPT credentials, Gmail/Slack/Jira/GitHub credentials, OAuth refresh tokens, or resource credentials in the mobile app.
- Store privileged secrets in Supabase project secrets / Edge Function environment only.
- Commit placeholder `.env.example` files only; never commit real `.env` files or secrets.

### ChatGPT / GPT Actions

- ChatGPT must never connect directly to Supabase Postgres.
- ChatGPT must never receive database credentials or resource credentials.
- ChatGPT may call only reviewed Supabase Edge Functions through GPT Actions.
- Document GPT Action contracts in `docs/gpt-actions-openapi.yaml`.

## Required MVP data model

Implement these tables through Supabase migrations:

1. `profiles`
2. `workflows`
3. `workflow_runs`
4. `summaries`
5. `tasks`
6. `task_events`
7. `agent_messages`
8. `agent_connections`
9. `integration_connections`
10. `audit_logs`

Minimum expectations:

- Use migrations in `supabase/migrations/`; do not hand-edit remote database state.
- Add constraints for statuses, priorities, resource types, and event/action types.
- Add useful indexes for `user_id`, status fields, foreign keys, and timestamps.
- Add `created_at` and `updated_at` columns where appropriate.
- Add `updated_at` triggers for mutable tables.
- Keep `task_events`, `agent_messages`, and `audit_logs` append-only unless Codex approves retention/archive behavior.
- Sanitize audit and agent-message payloads so raw emails, Slack content, Jira details, tokens, credentials, and PII are not unnecessarily duplicated.

## Required agent flow

The ChatGPT Custom GPT agent flow must be:

1. ChatGPT calls `agent-context` before deciding what to do.
2. `agent-context` validates the agent token, checks revocation, maps it to one `user_id`, and returns only that user's scoped context.
3. ChatGPT writes summaries/tasks/agent records through `agent-write`.
4. ChatGPT updates tasks through `agent-update-task`.
5. App task interactions create `task_events`.
6. The Supabase database is the bridge between ChatGPT and the app.
7. All agent calls create `agent_messages` and `audit_logs` entries.

## Required mobile app flow

The Expo app must:

- Authenticate with Supabase Auth.
- Read tasks, summaries, workflows, and related data from Supabase with the user's JWT and RLS.
- Write task interactions to `task_events`.
- Provide a **Connect ChatGPT Agent** screen.
- Provide agent connection listing and revocation.
- Avoid service-role keys, OpenAI keys, resource credentials, and raw agent-token storage.

## Implementation guidance

- Prefer TypeScript for Expo, Edge Functions, and shared packages.
- Put reusable constants/types/validation schemas in `packages/shared/` when practical.
- Keep Edge Function auth, response, audit, and error helpers shared to avoid duplicating security-critical logic.
- Add tests or SQL verification for RLS and policies when adding migrations.
- Keep generated artifacts, dependencies, build outputs, and local environment files out of git.
- Do not add analytics in the current MVP phase unless the user explicitly approves.

## Review checklist for every PR

Before marking a PR ready, verify:

- [ ] New MVP work is in `app/`, `supabase/`, `packages/shared/`, or `docs/`, not legacy `ios/` or `backend/` paths.
- [ ] All database changes are migration-based under `supabase/migrations/`.
- [ ] RLS is enabled for every user-owned table touched by the PR.
- [ ] Policies restrict user data access to `auth.uid() = user_id` or an explicitly reviewed ownership model.
- [ ] Edge Functions do not trust `user_id` from request input.
- [ ] Service-role queries are explicitly scoped by authenticated or agent-mapped `user_id`.
- [ ] Raw agent tokens are never stored or logged.
- [ ] Agent revocation is enforced.
- [ ] ChatGPT calls only reviewed Edge Functions and never direct database connections.
- [ ] App code contains no service-role key, OpenAI key, integration secret, OAuth refresh token, or resource credential.
- [ ] Task interactions create `task_events`.
- [ ] Agent calls create `agent_messages` and `audit_logs`.
- [ ] Sensitive audit/agent payloads are sanitized.
- [ ] GPT Actions OpenAPI docs are updated when Edge Function contracts change.
- [ ] Shared types/contracts are updated when schemas or API contracts change.
- [ ] Tests/checks were run and documented, or limitations are clearly explained.

## Documentation to keep aligned

When changing architecture, auth, data model, agent flow, or deployment, update the relevant docs:

- `docs/supabase-mvp-review.md`
- `docs/architecture.md` or replacement Supabase architecture doc
- `docs/security.md`
- `docs/deployment.md`
- `docs/gpt-actions-openapi.yaml`
- README
