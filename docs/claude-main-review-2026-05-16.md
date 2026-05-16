# Claude Main Merge Review — 2026-05-16

This review covers Claude's merged TaskFlow implementation currently on `main` (merge commit `662576c`, reviewed from branch `work` after the architecture-plan commit). It is intended as a concrete fix list for Claude before the user approves additional implementation.

## Executive summary

Claude made strong progress by creating the monorepo, iOS SwiftUI app, Lambda handlers, MongoDB repositories, schemas, shared contracts, and docs. However, the merge should not be treated as security- or TestFlight-ready. The highest-risk issues are:

1. User-only approval/review endpoints can still be called with agent tokens because most handlers use generic `withAuth` without `requireUser`.
2. The backend response contract does not match `docs/api.md` or the iOS `APIClient`, so sync will fail against several list and single-resource endpoints.
3. Agent run-results currently promote task candidates directly into real task documents instead of preserving them as user-reviewable candidates.
4. Audit sanitization is caller-dependent and not centrally enforced.
5. The iOS app still stores bearer tokens in `UserDefaults` and uses a placeholder UUID for synced follow-up draft task linkage.
6. Build/dependency reproducibility is weak: there is no committed backend lockfile and `.gitignore` does not ignore backend dependency/build artifacts.

## Required Claude fix issues

### CTF-001 — Block agent tokens from human approval/review endpoints

**Severity:** Critical security/design issue

**Problem:** `withAuth` accepts either a user JWT or an agent JWT. `requireUser` exists, but many human-only endpoints do not call it before database access. In particular, `/followups/{id}/approve`, `/followups/{id}/mark-reviewed`, `/approval-requests/{id}/approve`, `/approval-requests/{id}/reject`, and `/approval-requests/{id}/mark-executed` can be reached by a valid agent token for the same `userId`/`orgId` because they never assert a human actor.

**Why it matters:** Non-negotiable rule: external actions require explicit user approval. Even if these handlers do not send externally yet, letting an agent mark drafts/approval requests approved or executed breaks the approval trust boundary.

**Claude prompt:**

> Add `requireUser(auth)` to every human/iOS endpoint before database access, especially follow-up review/approval/archive and approval approve/reject/mark-executed. Keep `/agent/*` endpoints scope-limited with `requireScope`. Add tests proving agent tokens cannot approve drafts, approve/reject/execute approval requests, mark tasks done, archive resources, or read audit events.

**Acceptance criteria:**

- Agent token on human-only endpoints returns 403.
- User token on `/agent/*` endpoints returns 403.
- Missing agent scope returns 403.
- Tests fail if any human approval endpoint omits `requireUser`.

### CTF-002 — Align backend response envelopes with API docs and iOS decoding

**Severity:** Critical functional issue

**Problem:** `docs/api.md` defines list responses as `{ "items": [...], "total": 42 }` and single-object responses as the object directly. The iOS `APIClient` decodes list responses using `APIListResponse<T>` with `items`. Backend handlers currently return shapes like `{ tasks: [...] }`, `{ summaries: [...] }`, `{ followups: [...] }`, `{ approvals: [...] }`, `{ auditEvents: [...] }`, and single-object wrappers like `{ task: ... }`.

**Why it matters:** Sync and API calls will fail to decode or require per-endpoint wrapper workarounds. This also means docs are not a reliable contract for the GPT agent or iOS app.

**Claude prompt:**

> Choose one API response contract and make docs, backend, and iOS match. Recommended: keep docs/iOS list shape `{ items, total }`; return raw DTO objects for single-object endpoints or update iOS/docs consistently if wrappers are retained. Update all handlers and add decoding tests for tasks, summaries, follow-ups, approvals, audit events, and agent endpoints.

**Acceptance criteria:**

- All list endpoints return `{ items, total }`.
- iOS `fetchTasks`, `fetchSummaries`, `fetchDrafts`, and future approval/audit calls decode successfully.
- `docs/api.md` examples match actual handler output.

### CTF-003 — Preserve agent task candidates instead of auto-creating accepted tasks

**Severity:** High product/design issue

**Problem:** `/agent/run-results` loops over `summaryPayload.taskCandidates` and inserts each candidate as a real `TaskDoc`. The intended flow is that agent output creates summaries and task candidates, then the user reviews/accepts candidates before real task cards are created.

**Why it matters:** The CTO loses the explicit review/accept step, which is core to the product and security model. Agent-suggested work can appear as actual tasks prematurely.

**Claude prompt:**

> Refactor agent run-results so task candidates are persisted as candidate subdocuments or a dedicated candidate collection linked to the summary, not as accepted `TaskDoc` records. Update `/summaries/{id}/task-candidates` and `/summaries/{id}/accept-tasks` so the user explicitly promotes selected candidates to tasks. Keep audit events for agent candidate creation and user acceptance.

**Acceptance criteria:**

- Agent candidates are visible for review but are not normal tasks until accepted by the user.
- Accepted tasks are created by a user action and audited as `summary.acceptTasks` plus `task.create`.
- Existing task board does not mix unaccepted candidates with accepted tasks unless a separate candidate/review section intentionally displays them.

### CTF-004 — Centralize audit sanitization before exposing audit events

**Severity:** High security/privacy issue

**Problem:** Audit docs and code state that callers must sanitize `before`/`after` snapshots, but there is no central sanitizer. Audit reads include snapshots directly. This is fragile because future handlers can accidentally persist `rawText`, follow-up body text, recipients, approval payload secrets, or raw source content.

**Why it matters:** Audit logs are often long-lived and broadly inspected. They must not become a secondary store of sensitive emails, Slack content, Jira payloads, tokens, or PII.

**Claude prompt:**

> Add a central audit sanitizer used by `insertAuditEvent` or the audit service itself. Redact sensitive keys recursively: `rawText`, `body`, `recipientOrTarget`, `payload`, `rawContent`, `token`, `secret`, `password`, `authorization`, and credential-like fields. Add tests proving sensitive fields are redacted before insertion and never returned by `/audit-events`.

**Acceptance criteria:**

- Sanitization is enforced centrally, not only by caller convention.
- Audit event snapshots cannot contain raw summary text, draft bodies, recipients, tokens, credentials, or raw source content.
- Audit events for key mutation paths remain useful with non-sensitive metadata.

### CTF-005 — Validate follow-up and approval state transitions

**Severity:** High workflow integrity issue

**Problem:** Approval request handlers validate some transitions, but they are not user-only yet. Follow-up draft status handlers do not validate legal transitions; for example, a draft can be approved without first being reviewed, and an agent token can currently hit the same endpoint if it maps to the same user/org.

**Why it matters:** The product relies on clear review/approval semantics before any external action. Invalid or skipped transitions reduce audit trust.

**Claude prompt:**

> Implement explicit state-transition guards for follow-up drafts and approval requests. Draft approval should require an allowed prior state (`reviewed` unless product decision says otherwise). Execution should require approved status and a human user. Rejected, expired, archived, or already executed records must not be executable. Add tests for every invalid transition.

**Acceptance criteria:**

- Invalid transitions return 400 or 409 without mutation.
- Draft approval and approval execution are human-only.
- All successful and rejected/failed transition attempts are audited as appropriate.

### CTF-006 — Fix iOS token storage and production URL policy before TestFlight

**Severity:** High TestFlight/security issue

**Problem:** `TokenStorage` persists bearer tokens in `UserDefaults`. `APIConfig.baseURL` defaults to `http://localhost:3000`. These are acceptable only for early local development, not for TestFlight with real CTO data.

**Why it matters:** Bearer tokens should be protected by Keychain. Production/TestFlight should require HTTPS and should not silently target localhost.

**Claude prompt:**

> Replace token persistence with Keychain using `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, preserving the `TokenStorage` API. Add a one-time migration/removal for any existing `UserDefaults` token. Add build-environment handling so TestFlight/Release requires an HTTPS API base URL and does not default to localhost.

**Acceptance criteria:**

- Tokens are no longer stored in `UserDefaults`.
- Token values are never logged.
- TestFlight/Release builds reject or clearly block non-HTTPS backend URLs except explicit debug/local configurations.

### CTF-007 — Fix synced follow-up draft task linkage on iOS

**Severity:** Medium-high UX/data integrity issue

**Problem:** `SyncService.syncDrafts` creates a local `FollowUpDraft` with `taskID: UUID()` as a placeholder. It does not reconcile `apiDraft.taskId` to the local task with the matching remote ID.

**Why it matters:** Follow-up review is task-centric. Placeholder linkage breaks navigation, review context, and future approval workflows.

**Claude prompt:**

> Store the backend `taskId` on local follow-up drafts or reconcile it to the local `TaskItem.remoteId`. Remove placeholder UUID linkage. Draft detail/list views should show task context when synced and display a recoverable “task not synced yet” state if missing.

**Acceptance criteria:**

- Remote draft `taskId` links to the correct local task when available.
- No placeholder task IDs are created for backend drafts.
- Missing task references do not crash and are surfaced as sync state.

### CTF-008 — Add backend tests for tenant isolation, auth type, and response contracts

**Severity:** High quality/security issue

**Problem:** The backend has Jest dependencies but no visible tests. The most important invariants are only comments today.

**Why it matters:** Tenant isolation and approval gating are non-negotiable and easy to regress when adding endpoints.

**Claude prompt:**

> Add Jest tests for repository/handler security invariants: every read/update/archive/status query is scoped by `userId` and `orgId`; agent tokens cannot call user endpoints; user tokens cannot call agent endpoints; missing scopes fail; list/single response shapes match docs; approval/follow-up transition guards work.

**Acceptance criteria:**

- `npm test` runs in CI/local dev.
- Cross-user ID guessing returns 404/no mutation.
- Response-contract tests would fail on `{ tasks: [...] }` when `{ items: [...] }` is expected.

### CTF-009 — Make dependency/build artifacts reproducible and ignored correctly

**Severity:** Medium operational issue

**Problem:** `backend/package.json` exists, but no backend lockfile is committed. `.gitignore` does not currently ignore `node_modules/` or backend TypeScript output such as `backend/dist/`, so local installs/builds create untracked noise and make reviews error-prone.

**Why it matters:** Claude and Codex need reproducible builds and clean diffs. Test/deploy automation should use a lockfile.

**Claude prompt:**

> Add a backend lockfile generated from the approved package manager. Update `.gitignore` to ignore `node_modules/`, `backend/node_modules/`, `backend/dist/`, and other generated backend artifacts while still committing the lockfile. Document whether the backend uses `npm ci` or another package manager in `docs/deployment.md`.

**Acceptance criteria:**

- Fresh checkout can run the documented install/build commands reproducibly.
- Generated dependency/build folders do not appear in `git status`.
- Lockfile is committed unless the team explicitly chooses a different reproducibility mechanism.

### CTF-010 — Connect AWS secret documentation to actual Serverless config

**Severity:** Medium deployment/security issue

**Problem:** The docs say secrets should come from AWS Secrets Manager/SSM, and the IAM role allows `secretsmanager:GetSecretValue`, but `serverless.yml` injects `MONGODB_URI`, `JWT_SECRET`, and `AGENT_JWT_SECRET` directly from deploy-time environment variables.

**Why it matters:** This can be secure if CI injects variables safely, but it does not match the documented architecture. The deploy path must be explicit so secrets are not accidentally committed or exposed in shell history.

**Claude prompt:**

> Either wire `serverless.yml` to Secrets Manager/SSM parameters directly or update deployment docs to state that CI/CD injects env vars from a secret store. Remove unused IAM permissions if not needed. Add `.env.example` with placeholders only.

**Acceptance criteria:**

- Secret source is unambiguous and matches docs.
- No real URI/secret is committed.
- Deployment instructions can be followed without pasting production secrets into source-controlled files.

## Suggested priority order for Claude

1. CTF-001, CTF-002, CTF-008: auth boundaries, API contract, and tests.
2. CTF-003, CTF-004, CTF-005: candidate acceptance, audit sanitization, and approval transition correctness.
3. CTF-006, CTF-007: iOS TestFlight security and sync integrity.
4. CTF-009, CTF-010: reproducible builds and deployment-secret clarity.

## Reviewer note

Do not approve external integrations, TestFlight distribution with real data, or agent write access expansion until CTF-001 through CTF-008 are fixed and tested.
