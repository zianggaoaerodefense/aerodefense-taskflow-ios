# TaskFlow — Codebase Guide for Claude Code and Codex

## What this project is

TaskFlow is a private CTO workflow system. It converts email threads, Slack
messages, Jira tickets, meeting notes, and GPT summaries into structured task
cards with a full review → action → done workflow. The iPhone app is the
primary UI; an autonomous GPT management agent is the intelligence layer.

## Repo layout

```
/ios/TaskFlow/              SwiftUI iPhone app (iOS 17+, SwiftData)
/backend/src/               AWS Lambda backend (Node.js / TypeScript)
  handlers/                 One file per route group
  db/repositories/          MongoDB access — always scoped by userId + orgId
  auth/                     JWT verification, AuthContext types
  middleware/               withAuth(), requireScope(), requireUser()
  models/types.ts           All TypeScript interfaces and DTO types
  schemas/validation.ts     Single source of truth for all Zod schemas
  services/auditService.ts  Thin audit wrapper (derives actorId from AuthContext)
  __tests__/                All tests (jest + mongodb-memory-server)
/shared/schemas/            JSON Schema (draft-07) cross-layer contracts
/docs/                      Architecture, API, security, deployment, agent workflow
```

## Running the backend locally

```bash
cd backend
npm install
cp .env.example .env     # fill in JWT_SECRET, AGENT_JWT_SECRET, MONGODB_URI
npm run dev              # ts-node src/local/server.ts on :3000
npm test                 # jest with mongodb-memory-server (no external DB needed)
npm run build            # tsc
```

## Running the iOS app

Open `ios/TaskFlow.xcodeproj` in Xcode, select a simulator (iOS 17+), press ⌘R.
In the Settings tab set the API URL to `http://localhost:3000` for local dev.

## Most important security rules — never violate these

1. **userId is NEVER read from the request body.** It always comes from the
   verified JWT via `auth.userId` in the `AuthContext`.
2. **Every MongoDB query includes `userId` and `orgId`.** All repos enforce
   this through the internal `userFilter(auth, extra)` helper. Never bypass it.
3. **The iOS app and GPT agent never connect to MongoDB directly.** All access
   goes through Lambda.
4. **Agent endpoints require explicit scope checking.** Call
   `requireScope(auth, AGENT_SCOPES.X)` at the top of every agent handler.
5. **Approval requests are never auto-executed.** The agent creates
   `approval_requests` with `status='pending'`; execution requires explicit CTO
   action via `/approval-requests/:id/approve` + `/mark-executed`.
6. **No secrets committed.** `.env` is in `.gitignore`. Use `.env.example` as
   the template.

## Key patterns to follow

### Repository pattern
Every MongoDB collection has a dedicated repo file under
`backend/src/db/repositories/`. Each public function takes `(db, auth, ...)`.
The `userFilter(auth, extra)` helper always injects `userId` and `orgId`:

```typescript
function userFilter(auth: AuthContext, extra?: Partial<T>): Filter<T> {
  return { userId: auth.userId, orgId: auth.orgId, ...(extra as Filter<T>) };
}
```

On **insert**: `userId` and `orgId` are overwritten from `auth` unconditionally.
On **update**: `userId`, `orgId`, and `_id` are stripped from the update payload.

### Auth middleware
Handlers are wrapped with `withAuth(handler)`. The handler receives a typed
`AuthContext` — either `UserAuthContext` or `AgentAuthContext`. Never read
`userId` from the event body or query string.

### Audit logging
Every mutation calls `insertAuditEvent(db, auth, { actor, actorId, action,
entityType, entityId, before?, after? })`. The `after` snapshot must contain
only safe fields — never tokens, passwords, or full PII.

### Zod validation
All schemas live in `backend/src/schemas/validation.ts`. Import from there;
do not create parallel schema files for the same resource.

### DTOs vs. Docs
`*Doc` types (e.g. `TaskDoc`) are MongoDB documents. `*DTO` types (e.g.
`TaskDTO`) are what the API returns to clients. The handler maps Doc → DTO
using a `toXxxDTO()` function. DTOs convert `_id` (ObjectId) to a string `id`,
and `Date` fields to ISO-8601 strings.

## Test structure

All tests live under `backend/src/__tests__/`.

```
__tests__/
  helpers/
    authHelper.ts    — JWT factories and pre-built AuthContext fixtures
    dbHelper.ts      — MongoMemoryServer start/stop/clear lifecycle
    eventHelper.ts   — APIGatewayProxyEvent factories
  repos/
    taskRepo.test.ts — userId scoping, cross-tenant isolation, insertTask auth
  handlers/
    tasks.test.ts    — mark-done lifecycle, follow-up draft creation, audit
    agent.test.ts    — scope enforcement, approval status invariants
  middleware/
    withAuth.test.ts — token verification, expired/invalid/missing tokens
```

Run tests: `cd backend && npm test`

Tests use `mongodb-memory-server` — no external MongoDB required. Every test
file calls `clearDb()` in `afterEach` for isolation.

## Task status flow

```
new → reviewNeeded → actionNeeded → done → archived
                           ↓
                         waiting
```

`mark-reviewed` transitions to `actionNeeded` and stamps `reviewedAt`.
`mark-done` stamps `doneAt` + `actualCompletionDate` and auto-creates a
follow-up draft if `followUpDraftId` is not already set.

## Agent workflow summary

1. Agent calls `POST /agent/run-results` (scope: `agent:summaries:create`).
2. Lambda inserts summaries and task candidates (status=`reviewNeeded`).
3. iPhone app syncs → shows items in Summaries tab with `reviewNeeded` flag.
4. User accepts task candidates via `POST /summaries/:id/accept-tasks`.
5. Agent polls `GET /agent/pending-review` to see what needs attention.
6. Agent drafts follow-ups via `POST /agent/followup-drafts`.
7. User approves follow-up draft in Follow-ups tab.
8. Agent creates approval request via `POST /agent/approval-requests`.
9. User approves request via UI → status transitions to `approved`.
10. Phase 3: approved request triggers actual external send (not yet built).

Full details: `docs/agent-workflow.md`.

## Codex review notes

See `docs/codex-review.md` for the current review checklist and known gaps.

## What is NOT yet built

- External send (email, Slack, Jira) — Phase 3. All endpoints exist but the
  actual send logic is a TODO comment.
- iOS tests — XCTest suite not yet written.
- Keychain token storage — currently UserDefaults (Phase 3 TODO in APIClient.swift).
- Push notifications — Phase 3.
- iCloud sync — Phase 3.
- CI/CD pipeline — skeleton only (see `docs/deployment.md`).
