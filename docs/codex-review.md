# Codex Review Guide

This document is written for Codex (the repo-based auditor). It describes
what to look for, where to find it, and the current state of the codebase.

---

## Role boundaries

| Role | Responsibility |
|------|---------------|
| **Claude Code** (implementer) | Write code, maintain the repo, respond to Codex findings |
| **Codex** (auditor) | Inspect branches/PRs, produce gap lists, request changes |

Codex should NOT implement changes. It should produce clear, specific findings
with file + line references. Claude Code will implement the fixes.

---

## Review checklist

### 1. Security — userId/orgId scoping

**Most critical.** Every MongoDB query must be scoped by both `userId` AND
`orgId`. The correct pattern is in every repository file.

Look for:
- Any `findOne({ _id: ... })` without `userId` in the filter → **bug**
- Any `findOne({ userId: req.body.userId })` → **critical bug** (trusting body)
- Any insert that does not overwrite `userId`/`orgId` from `auth` → **bug**

Files to check:
- `backend/src/db/repositories/*.ts` — all five repo files
- Look for `userFilter(auth, ...)` usage in every public function

Expected pattern:
```typescript
function userFilter(auth: AuthContext, extra?: Partial<T>): Filter<T> {
  return { userId: auth.userId, orgId: auth.orgId, ...(extra as Filter<T>) };
}
```

### 2. Security — agent scope enforcement

Every agent endpoint must call `requireScope(auth, AGENT_SCOPES.X)` as its
first statement before accessing any data.

Files to check:
- `backend/src/handlers/agent.ts` — all five handler functions

Look for any handler that:
- Does not call `requireScope`
- Calls `requireScope` after data access has already started
- Accepts a user token without throwing (agent endpoints should reject users)

### 3. Security — approval request invariants

Approval requests must always enter with `status: 'pending'`. The agent cannot
create pre-approved or auto-executed requests.

Files to check:
- `backend/src/db/repositories/approvalRepo.ts` — `insertApproval` should
  hardcode `status: 'pending'`
- `backend/src/handlers/agent.ts` — `createApprovalRequests`
- `backend/src/handlers/approvals.ts` — `markExecuted` should guard
  `status === 'approved'` before executing

### 4. Security — no secrets in code or logs

Search for hardcoded values:
```bash
grep -r "mongodb+srv" backend/src/
grep -r "JWT_SECRET\s*=" backend/src/
grep -r "password" backend/src/
grep -r "console.log" backend/src/  # check for token/userId logging
```

Expected: only `process.env.MONGODB_URI`, `process.env.JWT_SECRET`,
`process.env.AGENT_JWT_SECRET` in connection/auth files.

### 5. iOS — no MongoDB credentials

```bash
grep -r "mongodb" ios/
grep -r "MONGO" ios/
```

Expected: zero results.

### 6. iOS — no secrets committed

```bash
grep -rn "password\|secret\|token\|apiKey\|MONGO" ios/TaskFlow/
```

Expected: only placeholder labels in SettingsView, never hardcoded values.

### 7. Audit logging

Every mutating handler should emit at least one `insertAuditEvent` call.

Files to check: all handlers in `backend/src/handlers/`.

Actions that must have audit events:
- `task.create`
- `task.update`
- `task.markReviewed`, `task.markActionNeeded`, `task.markWaiting`, `task.markDone`, `task.archive`
- `summary.create`, `summary.update`, `summary.acceptTasks`, `summary.archive`
- `followup.create`, `followup.update`, `followup.markReviewed`, `followup.approve`, `followup.archive`
- `approval.create`, `approval.approve`, `approval.reject`, `approval.markExecuted`
- `agent.runCompleted`, `agent.createFollowupDraft`, `agent.createApprovalRequest`
- `followup.autoCreate` (when markDone auto-creates a draft)

### 8. Backend tests

Run: `cd backend && npm test`

Expected test coverage:
- `__tests__/repos/taskRepo.test.ts` — userId scoping, cross-tenant isolation
- `__tests__/handlers/tasks.test.ts` — mark-done lifecycle, audit, follow-up draft
- `__tests__/handlers/agent.test.ts` — scope enforcement, approval invariants
- `__tests__/middleware/withAuth.test.ts` — token verification

All tests should pass. If any fail, report the failure message and which
invariant is violated.

### 9. iOS/backend contract alignment

The shared JSON schemas in `shared/schemas/` define the cross-layer contract.
Check that:
- API response shapes in handlers match the DTO types in `models/types.ts`
- iOS `APIClient.swift` DTO structs match the backend response fields
- Status and priority enums match across both layers

Key mismatches to look for:
- iOS `TaskStatus` enum vs `TaskStatus` in `models/types.ts`
- iOS `ChannelType` vs backend `ChannelType`
- `followUpDraftId` field present in both `TaskDoc` and `APITask`

### 10. Serverless.yml completeness

Check that every handler function in `handlers/*.ts` is wired up in
`backend/serverless.yml` with the correct HTTP method and path.

Missing routes mean the endpoint exists in code but is unreachable in production.

---

## Known gaps (current state)

| Gap | Severity | Notes |
|-----|----------|-------|
| External send not implemented | Low (by design) | Phase 3. `approve` and `markExecuted` have TODO comments. |
| iOS XCTest suite missing | Medium | No automated UI or model tests yet |
| Keychain for token storage | Medium | Currently UserDefaults. Phase 3 TODO in `APIClient.swift`. |
| `findTasks` lacks priority filter in repo | Low | Handler does post-fetch filter instead |
| `GET /agent/changes` fetches all then filters | Low | Should use `{ updatedAt: { $gte: since } }` index query |
| No MongoDB indexes defined | Medium | Need index on `(userId, orgId, status)` for tasks; `(userId, orgId, updatedAt)` for changes |
| No rate limiting on agent endpoints | Medium | Phase 3 / API Gateway configuration |
| CORS configuration in serverless.yml | Low | Placeholder only |

---

## How to report findings

Use this format in your review report:

```
FINDING: <severity> — <title>
File: backend/src/handlers/tasks.ts:142
Description: findTaskById called without userId in filter
Impact: Cross-tenant read access possible
Fix: Use userFilter(auth, { _id: toObjectId(id) }) instead of { _id: id }
```

Severities:
- **CRITICAL** — security violation (cross-tenant access, secret exposure)
- **HIGH** — correctness bug affecting data integrity
- **MEDIUM** — missing test coverage, minor security hygiene
- **LOW** — code quality, performance, or Phase 3 gap

---

## Branch and PR workflow

- Development branch: `claude/create-dev-branch-IQpXj`
- All changes are made on this branch and pushed before requesting review
- Codex should inspect the branch, not `main`
- After Codex produces findings, Claude Code will implement fixes on the same
  branch and push again
