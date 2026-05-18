# TaskFlow Architecture Review and Claude Implementation Plan

Date: 2026-05-16
Role: Codex architect/reviewer, with Claude as implementation coder and the user as final approval authority.

## 1. Architecture review

### Current repo shape

TaskFlow already has the desired top-level separation:

- `ios/TaskFlow/` contains the SwiftUI iPhone app, SwiftData local cache models, view models, sync service, and API client.
- `backend/` contains a TypeScript AWS Lambda backend with handlers, auth, middleware, repositories, schemas, and Serverless configuration.
- `shared/schemas/` contains JSON Schemas for cross-client contracts.
- `docs/` contains architecture, API, security, and deployment documentation.

This is directionally aligned with the target architecture: the iOS app should call Lambda only, Lambda should be the only MongoDB client, and MongoDB should remain the system of record.

### Backend architecture assessment

Strengths observed:

- Repository files document and generally implement the correct invariant: every public repository method accepts an authenticated context and builds filters with both `userId` and `orgId`.
- Insert paths generally overwrite ownership fields from auth context before persistence.
- JWT verification separates user JWTs from agent JWTs and models explicit agent scopes.
- Status, priority, resource type, draft status, and approval status enums exist in backend models and schemas.
- `mark-done` stamps `doneAt` and `actualCompletionDate` and creates a follow-up draft when absent.
- Audit event insertion exists for the major mutation paths and stamps `userId`/`orgId` from auth.
- Serverless routes cover the desired endpoint families.

Primary concerns:

- The backend currently does not compile under `npm run build`; TypeScript rejects the helper signatures used for path and query parameters with `APIGatewayProxyEvent`.
- API response envelopes are inconsistent with the documented contract and with the iOS client. Many list handlers return `{ tasks: [...] }`, `{ summaries: [...] }`, `{ followups: [...] }`, or `{ auditEvents: [...] }`, while docs and iOS expect `{ items: [...], total: N }`. Single-object handlers often return `{ task: ... }` while docs describe returning the object directly.
- Most user-facing endpoints are wrapped with generic `withAuth` but do not call `requireUser`. As a result, an agent token that verifies successfully may call some user endpoints unless a specific handler adds `requireScope`.
- Some direct agent-capable endpoints duplicate the dedicated `/agent/*` surface. Claude should either harden these with explicit scopes and document them or prefer the dedicated agent endpoints and make user endpoints user-only.
- Audit logging is best-effort and caller-sanitized. That is acceptable for an MVP, but Claude must add tests and a shared sanitizer before any sensitive fields are included in audit `before`/`after` snapshots.
- There are no backend unit/integration tests proving tenant isolation, token-type separation, approval gating, or audit logging.

### iOS architecture assessment

Strengths observed:

- The app uses SwiftData as a local cache rather than connecting to MongoDB.
- The API client attaches a bearer token and has comments warning not to send `userId` or `orgId` in request bodies.
- Sync state is modeled and sync errors are surfaced as `.offline`, `.notConfigured`, or `.error`.
- UX components and task statuses already include review/action-needed states.

Primary concerns:

- The API client currently expects the documented `{ items: [...] }` response envelope, but backend list handlers return resource-specific keys. Sync will fail until backend and iOS agree.
- Auth token storage is currently `UserDefaults`; that is explicitly marked as a future Keychain migration and must be completed before TestFlight with any real data.
- The default API base URL is `http://localhost:3000`. Production/TestFlight builds must require HTTPS backend configuration and must not silently use localhost.
- Follow-up drafts are cached with a placeholder UUID for `taskID`, which may break task-to-draft UX and review/approval flows.
- The app does not yet expose the full approval request lifecycle, audit visibility, or explicit approval gate for external actions.

### Documentation and schema assessment

Strengths observed:

- Docs clearly state that MongoDB is hidden behind Lambda, user ownership is derived from JWTs, and external actions require approval.
- Shared JSON Schemas exist for summaries, tasks, follow-ups, and agent run payloads.

Primary concerns:

- Docs appear ahead of implementation in several places, especially response envelopes, user-only endpoint policy, approval execution semantics, and deployment readiness.
- Shared JSON Schemas and backend Zod schemas are not currently verified against each other in tests.
- `docs/agent-workflow.md` is absent from the preferred documentation set and should be added before agent integration work expands.

## 2. Gap list versus desired architecture

### P0 gaps: must fix before Claude proceeds with feature work

1. **Backend build is red.** `npm run build` fails due to incompatible TypeScript helper parameter types for Lambda path/query params.
2. **API envelope mismatch.** Docs and iOS expect `{ items, total }`, but handlers return resource-specific collection names and single-object wrappers.
3. **Token-type policy is incomplete.** User endpoints should call `requireUser`; agent endpoints should call `requireScope` and remain scope-limited.
4. **No security regression tests.** There are no tests that prove every read/update/delete path is scoped by authenticated `userId`/`orgId`.
5. **Approval execution model is incomplete.** Approval records exist, but execution must remain disabled or explicitly out of scope until external send/write integrations are approval-gated and audited.

### P1 gaps: needed for a trustworthy MVP

1. **Audit coverage is not verified.** Mutation handlers create audit events, but coverage is not enforced by tests and snapshots rely on caller sanitization.
2. **Response contract is under-specified for iOS decoding.** Decide whether single-object responses are raw objects or wrapped; update docs, backend, and iOS consistently.
3. **Agent workflow docs are missing.** Add `docs/agent-workflow.md` with token scopes, allowed endpoints, run lifecycle, approval gate, and forbidden direct database access.
4. **iOS token storage is not production-safe.** Move auth tokens to Keychain before real TestFlight use.
5. **Sync model has placeholder relationships.** Follow-up drafts need stable remote task linking and local relationship reconciliation.
6. **Shared-schema parity is untested.** Backend Zod schemas and shared JSON Schemas can drift.

### P2 gaps: TestFlight and operational readiness

1. **Deployment docs need exact secret configuration.** Document AWS Secrets Manager/SSM wiring, Lambda environment variables, rotation expectations, and Atlas network restrictions.
2. **No explicit environment separation.** Define dev/staging/prod API URLs, JWT issuers/audiences, and MongoDB databases.
3. **No observability plan.** Add structured logging guidance that excludes sensitive content and tokens.
4. **No rate limiting/throttling plan.** Configure API Gateway throttles and agent run limits.
5. **No data retention plan.** Define retention/archive rules for raw summaries, source refs, audit events, and agent runs.

## 3. Phased implementation plan for Claude

### Phase 0 — Stabilize contracts and compile

Goal: create a green backend build and a single authoritative API contract.

Tasks:

- Fix Lambda request helper typings so `npm run build` passes.
- Standardize list responses to `{ items: [...], total: number }` or update iOS/docs if choosing another shape. Recommendation: keep `{ items, total }` because docs and iOS already expect it.
- Standardize single-object responses. Recommendation: return raw DTO objects from backend and update iOS only if a wrapper is intentionally retained. The docs currently say raw objects.
- Add a minimal test harness for handlers/repositories.

Exit criteria:

- `cd backend && npm run build` passes.
- iOS `APIClient` can decode list and single-object responses from backend contract.
- `docs/api.md` exactly matches actual response shapes.

### Phase 1 — Enforce auth boundaries and tenant isolation

Goal: make cross-tenant access and token-type confusion testably impossible.

Tasks:

- Add `requireUser(auth)` at every iOS/user endpoint: `/me`, non-agent summary CRUD/accept/archive, task CRUD/status/archive, follow-up list/get/update/review/approve/archive, approval list/create/approve/reject/mark-executed, and audit list.
- Keep `/agent/*` endpoints agent-only via `requireScope`.
- Decide whether non-`/agent` agent helper endpoints, such as summary task-candidate creation, should remain. If they remain, require explicit scopes and document them as agent-only.
- Add tests with two users in different orgs asserting that guessed IDs return 404 and no cross-tenant reads or writes occur.
- Add tests that agent tokens cannot call user endpoints and user tokens cannot call agent endpoints.

Exit criteria:

- All user endpoints reject agent tokens with 403.
- All agent endpoints reject user tokens with 403 and reject missing scopes with 403.
- Every repository query in tests includes `userId` and `orgId` from auth.

### Phase 2 — Audit, approval, and external-action safety

Goal: ensure the system can propose actions without performing external side effects until the user approves.

Tasks:

- Add a centralized audit sanitizer that strips or redacts `rawText`, follow-up `body`, `recipientOrTarget`, approval `payload` secrets/tokens, and source raw content.
- Add audit events for task creation, status changes, draft creation, draft review, draft approval, approval creation, approval approve/reject/execute, and agent-generated items.
- Ensure `mark-done` sets both `doneAt` and `actualCompletionDate`, creates or updates one follow-up draft idempotently, and links it to the task.
- Ensure `followups/:id/approve` only marks an internal draft approved; it must not send email/Slack/Jira.
- Ensure `approval-requests/:id/mark-executed` can only mark execution after approval and logs an audit event. External send/write integrations remain out of scope until separately reviewed.

Exit criteria:

- Tests prove audit events are written and sanitized.
- Tests prove no external-action endpoint sends or writes to third-party systems without an approved approval request.
- Done-task follow-up draft generation is idempotent.

### Phase 3 — iPhone daily workflow hardening

Goal: make the iPhone workflow fast, safe, and clear for a CTO daily review loop.

Tasks:

- Add/verify clear sections for Review Needed, Action Needed, Waiting, Today/Upcoming, Done, and Archived.
- Surface sync status and errors prominently without leaking sensitive content.
- Reconcile follow-up drafts to their remote task IDs instead of placeholder local UUIDs.
- Add approval-request screens with approve/reject affordances and a clear warning that approval authorizes a later external action.
- Move token storage from `UserDefaults` to Keychain before TestFlight.
- Ensure long summaries and landscape layouts are scroll-safe and do not truncate critical actions.

Exit criteria:

- A CTO can triage new agent items, accept task candidates, reprioritize tasks, mark tasks done, review a draft, approve/reject an approval request, and understand sync state from an iPhone.
- Tokens are stored in Keychain in TestFlight builds.

### Phase 4 — Deployment/TestFlight readiness

Goal: make the private MVP deployable without hidden security assumptions.

Tasks:

- Complete `docs/deployment.md` with AWS secret setup, Atlas allowlisting/VPC assumptions, Serverless deploy steps, environment separation, rollback, and log redaction rules.
- Add `.env.example` placeholders only; verify `.env`, build artifacts, node modules, and Xcode derived state are ignored.
- Configure API Gateway throttles and Lambda timeout/memory values appropriate to MongoDB calls.
- Add backend smoke tests for `/health` and authenticated `/me`.
- Add TestFlight checklist: HTTPS API URL, Keychain token storage, no analytics, no secrets, privacy text, and manual approval gate validation.

Exit criteria:

- Backend deploy steps are reproducible.
- TestFlight build has no local-only defaults or direct database connectivity.
- Security checklist is signed off before user approval.

## 4. Specific Claude task tickets/prompts

### Ticket 1 — Fix backend TypeScript build and response helpers

Prompt for Claude:

> Fix the backend TypeScript build without changing product behavior. Start with `backend/src/utils/response.ts`: update `getPathParam` and `getQueryParam` typings so they accept real `APIGatewayProxyEvent` shapes where path/query values may be `string | undefined`. Add safe handling for malformed `limit`/`skip` values where nearby code parses query params. Run `cd backend && npm run build`. Do not broaden auth or database access.

Acceptance criteria:

- `cd backend && npm run build` passes.
- Invalid/missing path params still produce safe errors.
- No endpoint starts reading `userId` or `orgId` from body/query/path.

### Ticket 2 — Align API response envelopes with docs and iOS

Prompt for Claude:

> Standardize backend API responses to match `docs/api.md` and `ios/TaskFlow/Services/APIClient.swift`. List endpoints must return `{ "items": [...], "total": N }`. Single-object endpoints should return the DTO object directly unless you update docs and iOS consistently. Update all handlers, update `APIClient` if needed, and update `docs/api.md` so there is one contract. Add decode/build tests where practical.

Acceptance criteria:

- `GET /tasks`, `/summaries`, `/followups`, `/approval-requests`, `/audit-events`, and agent list-style endpoints return `{ items, total }`.
- iOS `APIClient` decodes backend responses without wrappers mismatch.
- Docs match handler output exactly.

### Ticket 3 — Enforce user-only versus agent-only endpoints

Prompt for Claude:

> Harden auth boundaries. Import and call `requireUser(auth)` in every user/iOS endpoint before any database access. Keep `/agent/*` endpoints protected only by `requireScope`. For any non-`/agent` endpoint intended for agent use, document it and require an explicit agent scope. Add tests showing agent tokens cannot call user endpoints, user tokens cannot call agent endpoints, and missing agent scopes are rejected.

Acceptance criteria:

- User endpoints reject agent tokens with 403.
- Agent endpoints reject user tokens with 403.
- Missing scope returns 403.
- No database access occurs before the token type/scope check.

### Ticket 4 — Add tenant-isolation regression tests

Prompt for Claude:

> Add repository and/or handler tests for tenant isolation. Use two auth contexts with different `userId`/`orgId`. Verify list/get/update/status/archive operations cannot access a document owned by the other context. Tests must cover tasks, summaries, follow-ups, approvals, and audit reads. Prefer mocked MongoDB collections or an isolated test DB if already available.

Acceptance criteria:

- Cross-user `GET` returns null/404.
- Cross-user update/status/archive does not mutate the other user’s document.
- Cross-user list never includes the other user’s documents.
- Tests fail if a query omits `userId` or `orgId`.

### Ticket 5 — Centralize audit sanitization and verify audit coverage

Prompt for Claude:

> Implement an audit sanitizer service that redacts sensitive fields before audit snapshots are persisted: summary `rawText`, follow-up `body`, follow-up `recipientOrTarget`, approval `payload` secrets/tokens, and source raw content. Update handlers to use it for `before`/`after` snapshots. Add tests proving audit events are created for task creation/status changes, draft creation/review/approval, approval create/approve/reject/execute, and agent-generated items.

Acceptance criteria:

- No audit event contains raw summary text, draft body, recipient PII, credentials, or source raw content.
- Required mutation paths produce audit events.
- Audit insert failure remains non-fatal but is observable in sanitized logs.

### Ticket 6 — Lock external-action approval semantics

Prompt for Claude:

> Review follow-up and approval handlers to ensure no external side effect can happen without explicit user approval. In this phase, do not implement actual email/Slack/Jira sending. `followups/:id/approve` should only approve an internal draft. `approval-requests/:id/mark-executed` should require an approved request and should record execution metadata/audit only. Add tests for invalid transitions such as executing pending/rejected/expired requests.

Acceptance criteria:

- There is no code path that sends email, posts Slack, or writes Jira.
- Approval state transitions are validated.
- Execution cannot be marked before approval.
- All transitions are audited.

### Ticket 7 — Fix follow-up draft/task linkage in iOS sync

Prompt for Claude:

> Update iOS sync so follow-up drafts link to the local task that has the matching backend `taskId`. Extend local models if needed to store remote task IDs. Remove placeholder UUID linkage. Ensure draft list/detail views can navigate back to the source task when present and remain safe when the task is not yet synced.

Acceptance criteria:

- A synced draft links to the correct local task by backend task ID.
- No placeholder task IDs are created for remote drafts.
- Missing task references are shown as a recoverable sync state, not a crash.

### Ticket 8 — Move iOS token storage to Keychain for TestFlight

Prompt for Claude:

> Replace `TokenStorage` persistence from `UserDefaults` to Keychain using `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Preserve the existing API surface used by `APIClient` and `SyncService`. Add a small migration that deletes any existing UserDefaults token after moving it. Do not log token values.

Acceptance criteria:

- Tokens are stored in Keychain, not UserDefaults.
- Existing call sites keep working.
- Token values never appear in logs/errors.

### Ticket 9 — Add agent workflow documentation

Prompt for Claude:

> Create `docs/agent-workflow.md`. Document how the GPT management agent authenticates, required scopes, allowed endpoints, forbidden direct MongoDB access, run-results payload, pending-review/changes polling, follow-up draft creation, approval request creation, and the rule that external actions require explicit user approval. Cross-link from `docs/architecture.md`, `docs/api.md`, and `docs/security.md`.

Acceptance criteria:

- The doc exists and matches the implemented endpoint contract.
- It explicitly says ChatGPT memory is not the task database.
- It explicitly forbids direct MongoDB access by the agent.

## 5. Security review checklist

Claude must include this checklist in PR descriptions when touching backend auth, persistence, agent endpoints, approval flows, or iOS sync.

### Identity and auth

- [ ] `userId` and `orgId` are derived only from verified user JWTs or approved agent-token mapping.
- [ ] No request body, query string, or path parameter is trusted for ownership.
- [ ] User endpoints call `requireUser` before database access.
- [ ] Agent endpoints call `requireScope` before database access.
- [ ] User JWTs and agent JWTs use distinct secrets/issuers and cannot be substituted.
- [ ] Missing/invalid/expired tokens return 401; wrong token type or missing scope returns 403.

### Database isolation

- [ ] Every MongoDB document contains `userId` and `orgId` unless it is a global config document explicitly reviewed by Codex.
- [ ] Every read/update/delete query includes authenticated `userId` and `orgId`.
- [ ] No query uses `_id` alone for tenant-owned collections.
- [ ] Inserts overwrite ownership fields from auth context.
- [ ] Updates strip immutable ownership fields and `_id`.
- [ ] Tests cover cross-user and cross-org list/get/update/archive/status attempts.

### Agent boundaries

- [ ] The GPT management agent has no direct MongoDB access.
- [ ] Agent tokens contain only required scopes.
- [ ] Agent-created summaries, task candidates, drafts, approval requests, and run records are stamped with authenticated `userId`/`orgId`.
- [ ] Agent endpoints do not expose raw source content beyond what is necessary for the requested workflow.
- [ ] ChatGPT memory is not used as the database or source of record.

### External-action approval gate

- [ ] Email, Slack, Jira, GitHub, or document writes are never executed without explicit user approval.
- [ ] Draft approval is separate from external execution unless a reviewed design intentionally combines them.
- [ ] Approval requests validate legal status transitions.
- [ ] Execution requires `approved` status and records `executedAt`.
- [ ] Rejected, expired, archived, or pending approvals cannot be executed.

### Audit logging

- [ ] Task creation, task status changes, draft creation, draft review/approval, approval creation/approval/rejection/execution, and agent-generated items create audit events.
- [ ] Audit events include actor type and actor ID.
- [ ] Audit events are scoped by `userId` and `orgId`.
- [ ] Audit snapshots are sanitized before persistence.
- [ ] Audit insert failures do not leak secrets in logs.

### Secrets and deployment

- [ ] No secrets, tokens, credentials, MongoDB URIs, or real API keys are committed.
- [ ] MongoDB URI comes from AWS Secrets Manager/SSM or environment variables for local dev only.
- [ ] Lambda is the only MongoDB client in production architecture.
- [ ] Atlas network access is restricted to approved Lambda/VPC egress.
- [ ] Production/TestFlight uses HTTPS endpoints only.
- [ ] `.env`, build artifacts, node modules, DerivedData, and local credentials are ignored.

### iOS safety and UX

- [ ] iOS does not contain MongoDB drivers, credentials, or direct database URLs.
- [ ] Auth tokens are stored in Keychain before TestFlight with real data.
- [ ] Sync errors are visible and recoverable.
- [ ] Review Needed and Action Needed states are visually obvious.
- [ ] Long summaries and landscape layouts remain scroll-safe.
- [ ] Follow-up drafts link to the correct task and can be reviewed before approval.
- [ ] No analytics are added in the current phase.
