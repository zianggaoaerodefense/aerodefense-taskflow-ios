# TaskFlow Supabase MVP Architecture Review

Date: 2026-05-16
Reviewer role: Codex architect/reviewer
Implementation under review: Claude's merged implementation currently represented by this repo, which is still an iOS SwiftUI + AWS Lambda + MongoDB architecture.

## 1. Updated MVP target architecture

The MVP architecture has changed. Future implementation work must target this stack:

- **Mobile app:** Expo / React Native under `app/`.
- **Authentication:** Supabase Auth.
- **Database:** Supabase Postgres.
- **Authorization:** Supabase Row-Level Security (RLS) on all user-owned tables.
- **Backend logic:** Supabase Edge Functions under `supabase/functions/`.
- **Agent interface:** ChatGPT Custom GPT.
- **Agent execution:** GPT Actions calling Supabase Edge Functions only.
- **Shared types/contracts:** `packages/shared/` where practical.

The MVP must **not** continue with AWS Lambda, MongoDB Atlas, direct database access from ChatGPT, or any OpenAI/API/resource credentials inside the mobile app.

## 2. Current implementation verdict

Claude's current implementation is **not aligned** with the new MVP architecture. It may be useful as a reference for product concepts, statuses, and UX ideas, but it should not be extended as the production MVP foundation without a migration/refactor.

Current repo observations:

- App code lives under `ios/TaskFlow/` and uses SwiftUI/SwiftData, not Expo / React Native under `app/`.
- Backend logic lives under `backend/` with AWS Lambda handlers and `serverless.yml`, not Supabase Edge Functions under `supabase/functions/`.
- Persistence logic uses MongoDB repositories and a MongoDB connection, not Supabase Postgres migrations/RLS.
- Existing docs describe iPhone SwiftUI, AWS API Gateway/Lambda, and MongoDB as the intended architecture, which is now obsolete.
- Shared contracts live under `shared/schemas/`, not `packages/shared/`.
- No Supabase migration files, RLS policies, Edge Functions, GPT Actions OpenAPI document, or Expo app scaffold are present.

## 3. Architecture correctness review

### Required repo shape

Target structure:

```text
/app                         # Expo / React Native app
/supabase
  /migrations                # SQL schema + RLS policies
  /functions
    /agent-context
    /agent-write
    /agent-update-task
    /agent-connect
    /agent-revoke            # optional but recommended
/packages/shared             # shared TypeScript types/contracts
/docs
  supabase-architecture.md
  gpt-actions-openapi.yaml
  security.md
```

Current implementation gaps:

1. `app/` does not exist.
2. `supabase/` does not exist.
3. `packages/shared/` does not exist.
4. `backend/` and `ios/` are now legacy paths for the MVP and should not receive new feature work except removal/migration support.
5. Docs still describe the retired AWS/MongoDB architecture.

Required Claude action:

> Create the Supabase/Expo monorepo skeleton before continuing feature implementation. Mark the AWS/MongoDB/SwiftUI implementation as legacy or remove it after user approval. Update README and docs so the source of truth is the Supabase MVP architecture.

## 4. Security review

### RLS and table ownership

Required:

- Every user-owned table must include `user_id uuid not null references auth.users(id)`.
- RLS must be enabled on every user-owned table.
- Policies must restrict normal app access to `auth.uid() = user_id`.
- Tables that represent organization-level data should still include per-user ownership or a reviewed membership model; do not invent broad org access for the MVP without explicit design.

Current gaps:

- There are no Supabase migrations.
- There are no Postgres tables.
- There are no RLS policies.
- There are no tests or SQL assertions proving RLS is enabled.

Required Claude action:

> Add migration-based schema with RLS enabled for all required tables. Add policies for select/insert/update/delete using `auth.uid() = user_id` where user mutation is allowed. Add a migration/test script that fails if any user-owned table has RLS disabled.

### Edge Function identity and user ownership

Required:

- Edge Functions must derive the mobile user from the Supabase JWT, not from request body.
- Agent Edge Functions must authenticate an agent token and map it to exactly one `user_id` through `agent_connections`.
- Agent write/update functions must ignore or reject body-supplied `user_id`.
- Edge Functions using service-role privileges must re-apply ownership checks manually because service-role bypasses RLS.

Current gaps:

- Existing Lambda auth derives identity from custom JWTs and MongoDB repositories, which does not apply to Supabase Auth/RLS.
- No agent-token mapping table exists.
- No Edge Function code exists to enforce ownership when using service-role access.

Required Claude action:

> Implement Supabase Edge Function auth helpers: `getMobileUser(req)`, `getAgentConnection(req)`, and `assertUserScopedPayload(payload, userId)`. If service-role is used inside Edge Functions, every query must include the mapped `user_id` explicitly.

### Agent token storage

Required:

- Raw agent tokens must never be stored.
- Store only a salted hash, token prefix, created/revoked timestamps, and last-used metadata in `agent_connections`.
- Token issuance should show the raw token once to the user and never again.
- Revocation must disable the token immediately.

Current gaps:

- `agent_connections` does not exist.
- No token hashing/verification flow exists.
- The mobile app has no Connect ChatGPT Agent or revoke flow.

Required Claude action:

> Add `agent_connections` with `token_hash`, `token_prefix`, `created_at`, `last_used_at`, `revoked_at`, and `scopes`. Implement connect/revoke Edge Functions and mobile screens. Never persist raw tokens.

### Secret exposure

Required:

- Mobile app may contain only Supabase URL and anon key.
- Mobile app must not contain service-role key, OpenAI API keys, Slack tokens, Gmail credentials, Jira tokens, or resource credentials.
- ChatGPT must not receive database credentials.
- GPT Actions must call Edge Functions over HTTPS.

Current gaps/risks:

- Existing iOS app stores a backend auth token locally and calls a custom API client; this flow is not the Supabase Auth client flow.
- Existing AWS/MongoDB docs and backend env vars are obsolete for the MVP.
- No Supabase secret-management documentation exists for Edge Function secrets.

Required Claude action:

> Move all privileged secrets to Supabase project secrets / Edge Function environment. Add explicit checks and docs: Expo app only gets `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

## 5. Required Supabase data model

Claude must implement these tables through migrations:

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

### Minimum ownership and audit requirements

All ten tables should include:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id)` unless explicitly justified and reviewed
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()` where mutable

Recommended table-specific notes:

- `profiles`: one row per auth user; policy `user_id = auth.uid()` or `id = auth.uid()` depending on chosen key.
- `workflows`: user-owned workflow definitions.
- `workflow_runs`: linked to `workflows`; records agent/manual runs and run status.
- `summaries`: linked to workflow runs and optional source metadata; avoid storing raw external content unless explicitly needed.
- `tasks`: task cards with status/priority/resource type constraints.
- `task_events`: append-only log for app task interactions and status changes.
- `agent_messages`: append-only record of agent requests/responses/decisions, sanitized.
- `agent_connections`: hashed agent tokens, scopes, revoked state, last-used metadata.
- `integration_connections`: OAuth/resource connection metadata only; tokens must be encrypted or stored in provider/Supabase secrets strategy, never in app.
- `audit_logs`: append-only audit records; sanitize sensitive payloads.

Required Claude action:

> Add `supabase/migrations/0001_initial_schema.sql` with tables, constraints, indexes, `updated_at` triggers, RLS enablement, and policies. Add follow-up migrations instead of editing applied migrations once reviewed.

## 6. Agent flow review

Target flow:

1. ChatGPT Custom GPT calls `agent-context` before deciding what to do.
2. `agent-context` validates the agent token, maps it to one `user_id`, and returns scoped pending tasks/summaries/workflows/context.
3. ChatGPT calls `agent-write` to create summaries/tasks/agent messages.
4. ChatGPT calls `agent-update-task` to update task status/details when allowed.
5. App task interactions create `task_events`.
6. The database is the bridge between ChatGPT and the app.
7. ChatGPT never connects directly to Supabase Postgres and never receives database credentials.

Current gaps:

- No `agent-context`, `agent-write`, or `agent-update-task` Edge Functions exist.
- No GPT Actions OpenAPI schema exists.
- Current agent implementation is AWS Lambda-based and MongoDB-oriented.
- Current agent run-results path can create tasks directly and does not reflect the new required Edge Function names/flow.

Required Claude action:

> Implement `supabase/functions/agent-context`, `agent-write`, and `agent-update-task`. Document them in an OpenAPI schema for GPT Actions. Add agent-message and audit logging for every call. Ensure the agent token maps to exactly one non-revoked `agent_connections` row and one `user_id`.

## 7. Mobile app flow review

Target app flow:

- Expo app authenticates with Supabase Auth.
- App reads tasks/summaries/workflows from Supabase using the anon key and the user's JWT; RLS enforces ownership.
- App writes task interactions to Supabase, especially `task_events`.
- App has a **Connect ChatGPT Agent** screen.
- App can revoke agent connections.
- App does not contain OpenAI/API/resource credentials or service-role key.

Current gaps:

- The app is SwiftUI under `ios/TaskFlow/`, not Expo / React Native under `app/`.
- It does not use Supabase Auth.
- It does not read/write Supabase tables directly through the Supabase client.
- It has no Connect ChatGPT Agent screen and no revocation UI.
- Existing local SwiftData sync assumptions should be revisited; Supabase Realtime/offline strategy should be designed separately.

Required Claude action:

> Scaffold Expo under `app/`, add Supabase client setup, implement auth/session screens, task/summary/workflow reads through Supabase, task interaction writes to `task_events`, and Connect/Revoke ChatGPT Agent screens. Keep privileged work in Edge Functions.

## 8. Maintainability review

Required:

- Backend logic lives in Supabase Edge Functions.
- Database schema is migration-based.
- GPT Actions OpenAPI schema is documented and versioned.
- Shared TypeScript types live in `packages/shared/` where practical.
- Edge Functions should share auth, response, and audit helpers instead of duplicating security-sensitive logic.

Current gaps:

- Backend logic is in AWS Lambda handlers.
- Database shape is TypeScript/MongoDB model definitions, not SQL migrations.
- No GPT Actions OpenAPI document exists.
- Shared schemas are JSON Schema files under `shared/schemas`, not TypeScript types under `packages/shared`.

Required Claude action:

> Move/replace backend logic with Supabase Edge Functions, add migrations, add `docs/gpt-actions-openapi.yaml`, and create `packages/shared` for generated or hand-maintained types used by Expo and Edge Functions.

## 9. Broken assumptions from the previous architecture

Claude must stop building on these assumptions:

- AWS Lambda is the API/security layer.
- MongoDB Atlas is the system of record.
- Custom JWT verification replaces Supabase Auth.
- User ownership is enforced only in repository filters instead of RLS.
- SwiftUI is the primary MVP app.
- GPT agent calls Lambda endpoints.
- Agent-created task candidates can be stored as MongoDB task documents before user acceptance.

Replacement assumptions:

- Supabase Auth identifies mobile users.
- Supabase Postgres is the system of record.
- RLS is the first line of user-data isolation.
- Supabase Edge Functions are the only privileged backend layer.
- ChatGPT uses GPT Actions against Edge Functions.
- Agent tokens map to exactly one `user_id` through hashed `agent_connections` records.
- Expo / React Native is the MVP mobile app.

## 10. Priority implementation plan for Claude

### Phase 0 — Freeze legacy path and update source-of-truth docs

- Stop extending `ios/` and `backend/` for the MVP.
- Add README notice for the Supabase MVP architecture.
- Add `docs/supabase-architecture.md` and mark AWS/MongoDB docs as legacy or remove them after user approval.

### Phase 1 — Supabase foundation

- Create `supabase/` project structure.
- Add migrations for required tables, constraints, indexes, triggers, and RLS policies.
- Add seed/dev setup if needed.
- Add RLS verification tests/scripts.

### Phase 2 — Edge Functions and agent contracts

- Implement shared Edge Function auth helpers.
- Implement `agent-context`, `agent-write`, and `agent-update-task`.
- Add `agent_connections` token issuance/revocation.
- Add `docs/gpt-actions-openapi.yaml`.

### Phase 3 — Expo mobile MVP

- Scaffold `app/` with Expo.
- Add Supabase Auth flow.
- Implement task/summary/workflow screens.
- Implement task interaction writes to `task_events`.
- Add Connect/Revoke ChatGPT Agent screens.

### Phase 4 — Hardening and review gates

- Add tests for RLS, Edge Function identity, agent token hashing/revocation, and no secret exposure.
- Add audit-log sanitization.
- Add deployment docs for Supabase environments and secrets.
- Review GPT Actions schema before connecting a real Custom GPT.

## 11. Claude task tickets

### SUPA-001 — Create Supabase/Expo monorepo skeleton

Prompt:

> Create `app/`, `supabase/`, and `packages/shared/`. Do not continue adding MVP features to `ios/` or `backend/`. Update README to state that the MVP architecture is Expo + Supabase and that AWS/MongoDB/SwiftUI code is legacy/reference unless explicitly revived.

Acceptance criteria:

- Repo has target directories.
- README no longer presents AWS Lambda/MongoDB as the active MVP architecture.
- No service-role or resource secrets are introduced.

### SUPA-002 — Add initial Supabase schema and RLS migration

Prompt:

> Add `supabase/migrations/0001_initial_schema.sql` with the required ten tables, ownership columns, constraints, indexes, updated-at triggers, RLS enablement, and policies. Policies must restrict user-owned access to `auth.uid() = user_id`.

Acceptance criteria:

- All required tables exist.
- RLS is enabled on all user-owned tables.
- Policies do not permit cross-user reads/writes.
- Migration is idempotent enough for local reset workflows.

### SUPA-003 — Implement agent connection token lifecycle

Prompt:

> Add Edge Functions and schema support for creating, listing, and revoking ChatGPT agent connections. Raw tokens must be shown once and stored only as salted hashes with a prefix. Revoked tokens must fail immediately.

Acceptance criteria:

- Raw tokens are never stored.
- Agent token maps to exactly one user.
- Revocation blocks all agent Edge Functions.

### SUPA-004 — Implement GPT Action Edge Functions

Prompt:

> Implement `agent-context`, `agent-write`, and `agent-update-task` under `supabase/functions/`. Each function must validate the agent token, map it to one user, ignore body-supplied `user_id`, query/write only that user's rows, and create `agent_messages` plus `audit_logs` records.

Acceptance criteria:

- ChatGPT can only call Edge Functions.
- No direct database credentials are exposed to ChatGPT.
- All agent writes are user-scoped and audited.

### SUPA-005 — Add GPT Actions OpenAPI document

Prompt:

> Add `docs/gpt-actions-openapi.yaml` describing `agent-context`, `agent-write`, and `agent-update-task`. Include auth header requirements, request/response schemas, and security notes forbidding direct DB access.

Acceptance criteria:

- OpenAPI document can be imported into a Custom GPT Action after endpoint URLs are configured.
- Schemas match Edge Function implementation.

### SUPA-006 — Scaffold Expo app with Supabase Auth

Prompt:

> Scaffold the Expo / React Native app under `app/`. Configure Supabase Auth using only public Supabase URL and anon key. Implement sign-in/sign-out/session handling and basic task/summary/workflow reads protected by RLS.

Acceptance criteria:

- Mobile app uses Supabase Auth.
- No service-role/resource/OpenAI secrets are present in app code.
- User can only read their own rows.

### SUPA-007 — Add task interaction event flow

Prompt:

> Implement task interaction writes from the app to `task_events`, and ensure task status changes either happen through RLS-safe client writes or a reviewed Edge Function. Every task event must include the authenticated user's `user_id` server-side/defaulted safely and be auditable.

Acceptance criteria:

- App task interactions create `task_events`.
- Cross-user event creation is blocked by RLS.
- Task changes are reflected in task state and audit logs.

### SUPA-008 — Add Connect/Revoke ChatGPT Agent screens

Prompt:

> Add app screens for connecting a ChatGPT agent, displaying the one-time token safely, listing active agent connections, and revoking connections. Warn the user that the token grants scoped agent access and should be pasted only into the intended Custom GPT Action auth config.

Acceptance criteria:

- User can create and revoke agent connections.
- Raw token is displayed once only.
- Revoked connections can no longer call agent Edge Functions.

## 12. Review checklist for future Claude PRs

- [ ] Does the PR avoid adding new MVP features to legacy AWS/MongoDB/SwiftUI paths?
- [ ] Are all schema changes in `supabase/migrations/`?
- [ ] Is RLS enabled for every user-owned table?
- [ ] Do RLS policies restrict access to `auth.uid() = user_id`?
- [ ] Do Edge Functions ignore/reject body-supplied `user_id`?
- [ ] If service-role is used, does every query explicitly scope by mapped `user_id`?
- [ ] Are raw agent tokens never stored?
- [ ] Does each agent token map to exactly one user and respect revocation?
- [ ] Is the service-role key absent from mobile app code and Expo config?
- [ ] Are OpenAI/API/resource secrets absent from mobile app code and Expo config?
- [ ] Does ChatGPT call only Edge Functions through GPT Actions?
- [ ] Are app task interactions recorded in `task_events`?
- [ ] Are agent calls recorded in `agent_messages` and `audit_logs`?
- [ ] Is sensitive audit data sanitized?
- [ ] Is the GPT Actions OpenAPI schema updated when Edge Function contracts change?
- [ ] Are shared types updated in `packages/shared/` when contracts change?
