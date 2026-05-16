# TaskFlow — Private CTO Workflow System

**Monorepo: iOS App + AWS Lambda Backend + MongoDB**

A private, secure task-management system that turns email, Slack, Jira, meeting notes, and GPT summaries into structured task cards with a full review-and-action workflow.

---

## Architecture

```
iPhone SwiftUI App (primary UI, local cache)
        ↕ HTTPS
AWS API Gateway
        ↕
AWS Lambda (Node.js/TypeScript)
        ↕
MongoDB Cloud Database

GPT Management Agent
        ↕ HTTPS
AWS API Gateway  (same endpoint)
        ↕
AWS Lambda
        ↕
MongoDB Cloud Database
```

**The app and GPT agent never connect to MongoDB directly. All reads/writes go through Lambda.**

---

## Repository Structure

```
/
├── ios/                              # iPhone SwiftUI app
│   ├── TaskFlow.xcodeproj/
│   └── TaskFlow/
│       ├── Models/                   # SwiftData @Model classes
│       ├── Services/                 # APIClient, SyncService, SummaryParser, etc.
│       ├── ViewModels/               # @Observable view models
│       ├── Views/                    # SwiftUI views (4 tabs)
│       └── Resources/               # SampleData
│
├── backend/                          # AWS Lambda backend
│   ├── src/
│   │   ├── handlers/                 # Lambda function handlers
│   │   ├── services/                 # Audit service, business logic
│   │   ├── db/
│   │   │   ├── connection.ts         # MongoDB connection pooling
│   │   │   └── repositories/        # userId-scoped data access layer
│   │   ├── models/
│   │   │   └── types.ts             # TypeScript interfaces
│   │   ├── middleware/               # withAuth, requireScope
│   │   ├── auth/                     # JWT verification, AuthContext
│   │   ├── schemas/                  # Zod validation schemas
│   │   └── utils/                    # response helpers, error handling
│   ├── package.json
│   ├── tsconfig.json
│   ├── serverless.yml
│   └── .env.example
│
├── shared/
│   └── schemas/                      # JSON Schema (task, summary, followup, agent)
│
├── docs/
│   ├── architecture.md
│   ├── api.md
│   ├── security.md
│   └── deployment.md
│
└── README.md
```

---

## Quick Start

### Backend (local dev)

```bash
cd backend
npm install
cp .env.example .env
# Fill in MONGODB_URI and JWT_SECRET in .env
npm run dev
```

### iOS

```bash
open ios/TaskFlow.xcodeproj
# Select iPhone simulator (iOS 17+)
# In Settings tab, set API URL (default: http://localhost:3000 for dev)
# Press ⌘R
```

---

## Security Model

| Rule | Implementation |
|------|---------------|
| `userId` never trusted from client | Derived from verified JWT in every handler |
| All DB queries scoped by userId+orgId | Every repo method requires AuthContext |
| MongoDB only from Lambda | No DB credentials in app or agent |
| MongoDB URI in env vars | `.env` locally, AWS Secrets Manager in prod |
| Agent tokens have explicit scopes | Scopes checked via `requireScope()` |
| External actions require approval | `approval_requests` collection, status=pending until approved |
| No secrets committed | `.gitignore` blocks `.env`, `*.p12`, `AuthKey_*.p8` |
| Audit log for all mutations | `audit_events` collection via `auditService.ts` |
| Face ID / Passcode on iOS | `LocalAuthentication` in `SecurityLockService.swift` |

---

## Data Flow

### User adds a task
1. App inserts local SwiftData record (optimistic)
2. `SyncService.pushTaskUpdate()` calls `POST /tasks`
3. Lambda verifies token, inserts with `userId` from auth
4. Returns `remoteId` → stored on local record (`isSynced = true`)

### GPT agent submits a work summary
1. Agent calls `POST /agent/run-results` with agent JWT
2. Lambda verifies agent token + scope `agent:summaries:create`
3. Lambda inserts summaries and task candidates under correct `userId`/`orgId`
4. App syncs → shows new items in Summaries tab (reviewNeeded flag set)
5. User reviews task candidates, accepts selected ones
6. Accepted tasks move to task board

### Task marked Done
1. App calls `POST /tasks/:id/mark-done`
2. Lambda sets `doneAt`, `actualCompletionDate`, status=`done`
3. Lambda auto-generates follow-up draft from template
4. Draft returned to app, shown in Follow-ups tab
5. User reviews/approves draft (status=`approved`)
6. Phase 2: approved draft triggers `approval_request` → user confirms → external send

---

## MongoDB Collections

| Collection | Purpose |
|-----------|---------|
| `users` | User accounts and roles |
| `summaries` | Work summaries from all sources |
| `tasks` | Task cards (system of record) |
| `followup_drafts` | Generated follow-up drafts |
| `source_refs` | External source metadata (Slack threads, Jira tickets) |
| `agent_runs` | Agent run metadata and status |
| `approval_requests` | Pending external actions awaiting user approval |
| `audit_events` | Immutable audit trail for all mutations |
| `sync_events` | iOS/backend sync state tracking |

---

## API Overview

Full docs: `docs/api.md`

| Group | Endpoints |
|-------|----------|
| Health/Auth | `GET /health`, `GET /me` |
| Summaries | `GET/POST /summaries`, `GET/PATCH /summaries/:id`, `/accept-tasks`, `/archive` |
| Tasks | `GET/POST /tasks`, `GET/PATCH /tasks/:id`, `/mark-reviewed`, `/mark-action-needed`, `/mark-waiting`, `/mark-done`, `/archive` |
| Follow-ups | `GET/POST /followups`, `GET/PATCH /followups/:id`, `/mark-reviewed`, `/approve`, `/archive` |
| Approvals | `GET/POST /approval-requests`, `/:id/approve`, `/:id/reject`, `/:id/mark-executed` |
| Agent | `POST /agent/run-results`, `GET /agent/pending-review`, `GET /agent/changes`, `POST /agent/followup-drafts`, `POST /agent/approval-requests` |
| Audit | `GET /audit-events` |

### Agent scopes
```
agent:summaries:create
agent:tasks:read
agent:tasks:suggest
agent:followups:draft
agent:approvals:create
```

The agent cannot send externally. All external actions go through `approval_requests`.

---

## Task Status Flow

```
new → reviewNeeded → actionNeeded → done → archived
             ↓                ↓
           waiting          waiting
```

Status colors: new=blue, reviewNeeded=purple, actionNeeded=orange, waiting=yellow, done=green, archived=gray

---

## Phase Roadmap

| Feature | Phase |
|---------|-------|
| Local SwiftData cache | ✅ Phase 1 |
| AWS Lambda + MongoDB backend | ✅ Phase 2 (current) |
| Face ID lock | ✅ Phase 1 |
| JSON export/import (debug only) | ✅ Phase 1 |
| API sync (backend as source of truth) | ✅ Phase 2 (current) |
| Agent handoff via `/agent/run-results` | ✅ Phase 2 (current) |
| Gmail integration (read + draft) | Phase 3 |
| Slack integration (read + draft) | Phase 3 |
| Jira integration (read + comment) | Phase 3 |
| Email send via approval | Phase 3 |
| Slack send via approval | Phase 3 |
| Push notifications | Phase 3 |
| iCloud sync | Phase 3 |
| TestFlight distribution | Phase 3 |
| App Store | Not planned |

---

## Non-Goals (Current Phase)

- No automatic external sending (email, Slack, Jira) — approval required
- No public App Store release
- No direct MongoDB access from iOS app
- No direct MongoDB access from GPT agent
- No committed secrets
- No analytics
- No Supabase/Vercel
- No ChatGPT memory as database

---

## Security Notes

See `docs/security.md` for full details.

**Never commit:**
- `.env` files
- `*.p12` / `*.mobileprovision` / `AuthKey_*.p8`
- MongoDB credentials
- JWT secrets
- Exported task data JSON files (`taskflow-export*.json`)
