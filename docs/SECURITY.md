# Security Guide

This document covers the security model, controls, and best practices for the Daily Workflow Management App. Read this before deploying to a production environment or inviting real users.

---

## A. Secrets Management

### Rules

- **Never commit `.env` files.** The `.gitignore` excludes `.env`, `.env.local`, `.env.development`, `.env.staging`, and `.env.production`.
- **Never commit API keys.** This includes OpenAI keys, Anthropic keys, GitHub tokens, Slack tokens, Jira tokens, or any other credential.
- **Never commit the Supabase service role key.** It bypasses Row-Level Security. It belongs only in server-side environments.
- **Never commit OAuth refresh tokens** for Gmail, Slack, Jira, GitHub, or any other integration.
- **Never expose backend secrets to Expo public variables.** `EXPO_PUBLIC_*` variables are bundled into the client app and visible to anyone who inspects it.

### What is safe to expose (and why)

| Variable | Safe to expose? | Reason |
|----------|----------------|--------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Public project URL; RLS restricts access |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Designed for client use; restricted by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **Never** | Bypasses RLS; grants full database access |
| `OPENAI_API_KEY` | **Never** | Grants access to your OpenAI account |
| `AGENT_TOKEN` | **Never** | Grants agent access to a specific user's data |
| OAuth tokens | **Never** | Grants access to connected accounts |

### Where secrets belong

| Secret | Where to store it |
|--------|-------------------|
| Supabase service role key | Supabase project secrets (injected into Edge Functions automatically) |
| Agent connection tokens | User's agent runtime environment variables |
| OpenAI / Anthropic API keys | Agent runtime environment variables or secrets manager |
| OAuth tokens | Supabase Vault (not in the database directly) |
| Build secrets (`.p12`, `AuthKey_*.p8`) | EAS Secrets, GitHub Actions secrets |

---

## B. Supabase Security

### Row-Level Security (RLS)

RLS is enabled on all 10 user-owned tables. Every policy enforces:

```sql
auth.uid() = user_id
```

This means:

- Users can only SELECT, INSERT, and UPDATE their own rows.
- Even if application code attempts to access another user's data, Postgres silently filters it out.
- No DELETE policies exist — rows are archived or revoked, not deleted.
- `task_events` and `audit_logs` are append-only (no UPDATE or DELETE policies).

**Never disable RLS** on a user-owned table without an explicit alternative ownership enforcement strategy reviewed by a security engineer.

### Verifying RLS is enabled

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

All tables should return `rowsecurity = true`.

### Using the anon key vs service role key

| Key | Use in | RLS enforcement |
|-----|--------|----------------|
| Anon key | Mobile app | Yes — RLS restricts access |
| Service role key | Edge Functions only | No — bypasses RLS; requires explicit ownership checks in code |

Edge Functions using the service role key must perform explicit ownership verification in application code:

```typescript
// Always do this in Edge Functions — do NOT rely on RLS with service role
const { data: task } = await serviceClient.from('tasks').select('user_id').eq('id', taskId).single();
if (task.user_id !== resolvedUserId) {
  return errorResponse(403, 'Forbidden');
}
```

### Avoid overly broad policies

These are dangerous and must not appear in your schema:

```sql
-- BAD: allows any authenticated user to read all rows
CREATE POLICY "allow_all" ON tasks FOR SELECT USING (auth.role() = 'authenticated');

-- GOOD: restricts to own rows
CREATE POLICY "own_rows" ON tasks FOR SELECT USING (auth.uid() = user_id);
```

---

## C. Agent Security

### Minimum required permissions

Give the agent access only to what it needs:

- The agent token authorises access to **one user's data only**.
- The agent calls only the three read/write Edge Functions (`agent-context`, `agent-write`, `agent-update-task`).
- The agent does not have direct Postgres access.
- The agent does not see the service role key.

### Data minimisation

- Prefer storing **summaries and references** over raw sensitive content.
- Do not store full email bodies, raw Slack message history, or raw Jira content in the database unless the user explicitly wants this and understands the privacy implications.
- Audit snapshots (`audit_logs`) should contain only status, priority, and count values — not raw text content.

### Agent action approval

- The agent can propose tasks and write summaries.
- The agent cannot send emails, post Slack messages, or comment on Jira without explicit user approval through the mobile app.
- Any future external action capability must go through an approval flow.

### Review generated tasks

AI-generated tasks can be incorrect, irrelevant, or duplicative. Users should review suggested tasks before accepting or acting on them.

### Log agent actions

- Every agent write is recorded in `audit_logs` (action, entity type, entity ID, timestamp).
- Every task mutation is recorded in `task_events` (actor, event type, status change, timestamp).
- These logs are readable by the owning user.

---

## D. Token Security

### Agent connection tokens

1. Generated: 32 bytes, cryptographically random (hex-encoded = 64 characters).
2. Stored: only SHA-256 hash in `agent_connections.token_hash`.
3. Shown: raw token displayed once at creation; never stored or logged.
4. Used: hashed on every request; looked up in database; `user_id` read from row.
5. Revoked: `status = 'revoked'` immediately invalidates all subsequent requests.

If you suspect a token is compromised: revoke it in the app (Settings → Agent Connections → Revoke) and generate a new one.

### Session tokens (mobile app)

- Stored in `expo-secure-store` (iOS Keychain / Android Keystore).
- Hardware-backed; excluded from device backups by default.
- Large JWT payloads (>1800 bytes) are chunked across multiple SecureStore keys.
- Never written to AsyncStorage or other unencrypted storage.

---

## E. Before Open-Source Release — Security Scan

Before releasing this repository publicly, scan for:

### Secrets and credentials

```bash
# Run the security scan script
bash scripts/security-scan.sh

# Or run manually
rg -n "ghp_|sk-[a-zA-Z]|xoxb-|xoxp-|xoxa-|AIza|AKIA|eyJ" . \
  --glob '!*.lock' --glob '!node_modules/**'

rg -in "service_role|api[_-]?key|api[_-]?secret|private[_-]?key|client[_-]?secret|refresh[_-]?token|password|bearer" . \
  --glob '!*.lock' --glob '!node_modules/**' \
  --glob '!docs/**' --glob '!*.md'
```

### Naming and privacy

```bash
# Check for any company-specific naming that should not be public
rg -in "\bCTO\b" .

# Check for real email addresses
rg -n "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(com|org|net|io)" . \
  --glob '!*.lock' --glob '!node_modules/**'

# Check for internal URLs
rg -n "https?://[a-zA-Z0-9.-]+\.(internal|corp|local)" .
```

### What is safe to have

| Finding | Safe? | Notes |
|---------|-------|-------|
| `example.com` emails | Yes | Generic placeholder domain |
| `your-project.supabase.co` | Yes | Clearly a placeholder |
| `EXPO_PUBLIC_SUPABASE_URL=https://...supabase.co` | **Check** | Must be a placeholder, not a real project URL |
| `supabase.co` in documentation | Yes | OK in docs as an example |
| JWT pattern `eyJ...` in `.env.example` | **No** | Replace with `your-supabase-anon-key` |
| Real email addresses | **No** | Replace with `user@example.com` |
| Real Supabase project refs | **No** | Replace with `your-project-ref` |

### Recommended scanning tools

| Tool | Purpose | Install |
|------|---------|---------|
| [gitleaks](https://github.com/gitleaks/gitleaks) | Scans git history for secrets | `brew install gitleaks` |
| [trufflehog](https://github.com/trufflesecurity/trufflehog) | Deep git history secret scanning | `brew install trufflehog` |
| [git-secrets](https://github.com/awslabs/git-secrets) | Pre-commit secret prevention | `brew install git-secrets` |
| `npm audit` | Dependency vulnerability check | Built into npm |
| GitHub Secret Scanning | Automatic on public repos | Enabled by default on GitHub |

```bash
# Run gitleaks (scans entire git history)
gitleaks detect --source . --verbose

# Run trufflehog
trufflehog git file://. --only-verified

# Run npm audit
cd app && npm audit
```

---

## F. HTTPS Only

All traffic between the mobile app and Supabase, and between the agent and Edge Functions, travels over HTTPS (TLS 1.2+). Supabase enforces HTTPS for all hosted endpoints.

- The `EXPO_PUBLIC_SUPABASE_URL` must always use `https://` in staging and production.
- Plain HTTP is only acceptable for local development against `127.0.0.1` or `localhost`.

---

## G. Multi-Tenant Isolation

This app enforces per-user data isolation:

- Every user-owned table has `user_id NOT NULL` with no database DEFAULT.
- RLS policies restrict every SELECT, INSERT, and UPDATE to rows where `auth.uid() = user_id`.
- The agent token maps to exactly one `user_id` — an agent token for user A cannot access user B's data.
- Edge Functions verify `user_id` ownership in application code before every write (defence in depth alongside RLS).

Public open-source users bring their own Supabase project. No shared database exists.

---

## H. Future Improvements

- **Field-level encryption** for highest-sensitivity fields (`summaries.content`, `agent_messages.content`) using Supabase Vault or a KMS-backed approach.
- **Rate limiting** on Edge Function endpoints to prevent abuse.
- **Token expiry enforcement** — `agent_connections.expires_at` is stored but expiry checking should be verified in Edge Functions.
- **Push notification security** — when added in a future phase, ensure notification payloads do not contain sensitive data.
- **Integration OAuth token rotation** — when Gmail/Slack/Jira integrations are added, implement proper token refresh and storage in Supabase Vault.
