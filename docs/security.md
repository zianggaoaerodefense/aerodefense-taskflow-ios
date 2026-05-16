# TaskFlow Security Notes

This document summarises the security controls in place across the TaskFlow system. It is intended as a concise reference for engineers, reviewers, and auditors. For the full architectural rationale see `docs/architecture.md`.

---

## Secrets management

**No secrets are committed to the repository.**

- `.env` files are listed in `.gitignore`. Only `.env.example` (containing placeholder values) is tracked.
- In production, `MONGODB_URI`, `JWT_SECRET`, and `AGENT_JWT_SECRET` are injected at deploy time. They are stored in AWS Systems Manager Parameter Store or AWS Secrets Manager under the `taskflow/` prefix.
- The Lambda execution role is granted only `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:*:*:secret:taskflow/*` — no broader IAM permissions.
- iOS build secrets (Apple Developer certificates, `.p12`, `.mobileprovision`, `AuthKey_*.p8`) must never be committed. CI/CD pipelines (Codemagic, GitHub Actions + Fastlane, or Xcode Cloud) must use their respective secret stores.

---

## userId scoping (never trust the client body)

Every API handler that reads or writes data enforces the following invariant:

> The `userId` and `orgId` written to any database document are always extracted from the cryptographically verified JWT. They are never accepted from the request body, URL parameters, or query string.

This is implemented in `backend/src/middleware/withAuth.ts` and propagated as an `AuthContext` object to every repository call. Repository functions (`taskRepo`, `summaryRepo`, etc.) always include `{ userId: auth.userId, orgId: auth.orgId }` as mandatory query filters — no query runs without both fields.

A valid token for user A in org X cannot read, write, or modify data belonging to user B or org Y, even if the client constructs a request body containing those IDs.

---

## Agent scopes

Agent tokens are signed with `AGENT_JWT_SECRET`, a secret entirely separate from the user `JWT_SECRET`. This means:

- A leaked user token cannot be used to call agent-only endpoints (the signature will fail against the wrong secret).
- A leaked agent token cannot be used to log in as a user or access user-only endpoints.

Agent JWT payloads must declare an explicit `scopes` array. The backend calls `requireScope(auth, 'scope:name')` at the top of each agent handler. Scopes are not inferred or defaulted — an agent token without a required scope returns `403`.

Defined scopes:

| Scope | Grants |
|---|---|
| `agent:summaries:create` | `POST /agent/run-results`, `POST /summaries/{id}/task-candidates` |
| `agent:tasks:read` | `GET /agent/pending-review`, `GET /agent/changes` |
| `agent:drafts:create` | `POST /agent/followup-drafts` |
| `agent:approvals:create` | `POST /agent/approval-requests`, `POST /approval-requests/{id}/mark-executed` |

---

## Approval model for external actions

No email, Slack message, Jira comment, or other external side-effect is ever triggered automatically without explicit user approval.

The flow is:

1. Agent (or system) creates a `FollowUpDraftDoc` with `status: draft`.
2. The iOS app surfaces the draft to the user for review.
3. User edits the draft if needed and taps Approve.
4. The backend sets `status: approved` and `approvedAt: <timestamp>`.
5. An `ApprovalRequestDoc` gates the actual send. No send occurs until the approval request reaches `status: executed` via an explicit `POST /approval-requests/{id}/mark-executed` call.

This means the agent can never unilaterally send messages. Every external action has a user-visible, timestamped approval record in the `approvalRequests` collection.

---

## Face ID on iOS

The iOS app uses Face ID (or device passcode fallback) to protect access to task and summary content. This is implemented in `SecurityLockService.swift` using `LocalAuthentication`.

- The app locks automatically after a configurable idle period.
- The lock screen is shown before any sensitive data is rendered.
- Authentication state is held only in memory — it is not persisted to disk or UserDefaults.

---

## HTTPS only

All traffic between the iOS app and the backend travels over HTTPS. The API Gateway HTTP API endpoint is HTTPS-only (TLS 1.2+). The iOS app's `APIConfig` reads the base URL from `UserDefaults` (configurable in Settings), but production and TestFlight builds should always use `https://` URLs. Plain HTTP is only acceptable for local development against `localhost`.

The backend sets `ALLOWED_ORIGINS` in the CORS configuration via the Serverless Framework environment variable. Only explicitly listed origins are permitted.

---

## Token storage on iOS

User tokens are currently stored in `UserDefaults` via `TokenStorage` (see `ios/TaskFlow/Services/APIClient.swift`). A `TODO` comment in that file marks the planned migration to Keychain for production builds. The Keychain provides hardware-backed encryption and prevents token exfiltration via backup or iCloud sync (when `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` is used).

Until the Keychain migration is complete:
- Tokens are scoped to the app's sandbox and are not accessible to other apps.
- iCloud backup of `UserDefaults` should be evaluated; consider excluding the token key from backup using `UserDefaults` domain exclusions.

---

## Audit logging

Every state-mutating API operation writes an `AuditEventDoc` to the `auditEvents` collection. Each event records:

- `actor` and `actorId` — who performed the action (user, agent, or system)
- `action` — the operation (e.g., `task.markDone`, `followup.approve`)
- `entityType` and `entityId` — what was affected
- `before` / `after` — sanitised snapshots of the document state (secrets and PII are excluded from these snapshots)
- `createdAt` — server timestamp

Audit events are append-only. The audit collection should have no delete or update permissions granted to the application user in MongoDB Atlas.

---

## Sensitive field handling

The following fields are treated as potentially sensitive and must not appear in logs, error messages, or audit snapshots:

| Field | Reason |
|---|---|
| `rawText` on summaries | May contain the full body of emails, Slack threads, or documents |
| `recipientOrTarget` on follow-up drafts | May contain email addresses or Slack handles (PII) |
| `body` on follow-up drafts | May contain sensitive operational content |
| `payload` on approval requests | Contains details of the external action to be taken |
| `sourceRefs[*].rawContent` | Raw external content fetched from email/Slack/Jira |

---

## Future: encryption at rest for sensitive fields

Currently all data is encrypted at rest by MongoDB Atlas (AES-256 at the volume level). A future phase should implement field-level encryption (FLE) for the highest-sensitivity fields listed above (`rawText`, `body`, `recipientOrTarget`) using MongoDB Client-Side Field Level Encryption (CSFLE) with AWS KMS as the key provider.

This would ensure that even a full database dump cannot be read without access to the KMS key, providing defence-in-depth against cloud storage compromise.
