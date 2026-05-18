# Database Setup Guide

This guide walks you through setting up Supabase as the database and backend for the Daily Workflow Management App.

---

## Prerequisites

- A [Supabase account](https://supabase.com) (free tier works for development)
- Optionally, the [Supabase CLI](https://supabase.com/docs/guides/cli) for local development

---

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and log in or create an account.
2. Click **New project**.
3. Choose an organisation, enter a project name, set a strong database password, and choose a region close to your users.
4. Wait for the project to finish provisioning (1–2 minutes).

---

## 2. Required Environment Variables

### Client-side (mobile app)

These values go in `app/.env`. They are safe for client-side use because Supabase Row-Level Security restricts what the anon key can access.

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Find these in the Supabase dashboard at **Settings → API**.

### Server-side only (Edge Functions, scripts, agent backend)

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

> **Critical warning:** The service role key bypasses Row-Level Security. It must **never** be used in the mobile app, never committed to the repository, and never exposed to any client. It belongs only in:
> - Supabase Edge Function runtime secrets (injected automatically)
> - Server-side environment variables that are never bundled into the client app

---

## 3. Apply the Database Schema

### Option A — Supabase CLI (recommended for local development)

```bash
# Install CLI (macOS)
brew install supabase/tap/supabase

# Start local Supabase stack (Postgres + Studio + Edge Functions + Auth)
supabase start

# Apply all migrations
supabase db reset

# Push to hosted project
supabase db push
```

### Option B — Supabase dashboard (hosted project)

1. In the Supabase dashboard, go to **SQL Editor**.
2. Open `supabase/migrations/20240101000000_initial_schema.sql`.
3. Copy and paste the entire file into the SQL Editor.
4. Click **Run**.

---

## 4. Required Tables

The migration creates 10 tables. All have Row-Level Security enabled.

### `profiles`

Created automatically on user signup via a database trigger.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, references auth.users(id) |
| `display_name` | text | Nullable |
| `org_id` | uuid | Nullable, for multi-tenant future use |
| `role` | text | Default `'user'` |
| `created_at` | timestamptz | Server default |
| `updated_at` | timestamptz | Updated by trigger |

### `tasks`

The core task entity.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK, gen_random_uuid() |
| `user_id` | uuid | FK auth.users, NOT NULL, no DEFAULT |
| `title` | text | NOT NULL |
| `description` | text | Nullable |
| `status` | text | open / in_progress / waiting / done / archived |
| `priority` | text | low / medium / high / critical |
| `source` | text | agent / user |
| `due_at` | timestamptz | Nullable |
| `snoozed_until` | timestamptz | Nullable |
| `workflow_id` | uuid | FK workflows, nullable |
| `summary_id` | uuid | FK summaries, nullable |
| `created_at` | timestamptz | Server default |
| `updated_at` | timestamptz | Updated by trigger |

### `summaries`

Daily summaries created by the agent or user.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | FK auth.users, NOT NULL |
| `title` | text | NOT NULL |
| `content` | text | Summary body (may be long) |
| `source` | text | agent / user / manual |
| `workflow_id` | uuid | FK workflows, nullable |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `task_events`

Append-only mutation log. One row per task change.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `task_id` | uuid | FK tasks |
| `user_id` | uuid | FK auth.users, NOT NULL |
| `actor` | text | user / agent / system |
| `event_type` | text | created / updated / status_changed / snoozed / completed / archived |
| `previous_status` | text | Nullable |
| `new_status` | text | Nullable |
| `details` | jsonb | Additional event data |
| `created_at` | timestamptz | |

No UPDATE or DELETE policies — append-only.

### `agent_connections`

Hashed agent tokens. Raw token is never stored.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `user_id` | uuid | FK auth.users, NOT NULL |
| `token_hash` | text | SHA-256 of raw token, UNIQUE |
| `label` | text | User-defined name for the connection |
| `status` | text | active / revoked |
| `expires_at` | timestamptz | Nullable |
| `last_used_at` | timestamptz | Updated on each agent request |
| `revoked_at` | timestamptz | Set on revocation |
| `created_at` | timestamptz | |

### Other tables

See `supabase/migrations/20240101000000_initial_schema.sql` for the full schema of:

- `workflows` — named workflow definitions
- `workflow_runs` — execution records
- `agent_messages` — structured agent output
- `integration_connections` — external integration links
- `audit_logs` — append-only audit trail (INSERT service role only)

---

## 5. Row-Level Security

RLS is enabled on all 10 tables. The core principle: users can only access their own rows.

### RLS policy pattern

```sql
-- SELECT
CREATE POLICY "users_select_own" ON tasks
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT
CREATE POLICY "users_insert_own" ON tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE
CREATE POLICY "users_update_own" ON tasks
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

No DELETE policies exist — rows are archived or revoked rather than deleted.

### Verify RLS is enabled

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

All tables should show `rowsecurity = true`.

### Test isolation

Sign up as two different test users and verify that user A cannot see user B's tasks:

```sql
-- Run as user A's JWT (use Supabase SQL Editor → "Run as user")
SELECT * FROM tasks; -- Should return only user A's rows
```

### Edge Functions and service role

Edge Functions use the service role key, which bypasses RLS. Every Edge Function performs explicit ownership checks in application code:

```typescript
// Example from agent-update-task
const { data: task } = await serviceClient.from('tasks').select('user_id').eq('id', taskId).single();
if (task.user_id !== resolvedUserId) {
  return errorResponse(403, 'Forbidden');
}
```

---

## 6. Two Required Dashboard Settings (Hosted Projects)

| Setting | Location | Required value |
|---------|----------|----------------|
| Exposed schemas | Settings → API → Exposed schemas | `public` must be listed |
| Email confirmation | Authentication → Providers → Email | Disable for development |

If `public` is not in the exposed schemas list, every table query from the app fails silently.

---

## 7. Deploy Edge Functions

```bash
# Deploy all functions
supabase functions deploy agent-context
supabase functions deploy agent-write
supabase functions deploy agent-update-task
supabase functions deploy create-agent-connection
supabase functions deploy revoke-agent-connection
```

The `SUPABASE_SERVICE_ROLE_KEY` is automatically available inside Edge Functions as an environment variable. You do not need to set it manually.

For any additional secrets your Edge Functions need:

```bash
supabase secrets set MY_SECRET=value
```

---

## 8. Seed Sample Data

Insert safe sample data for development and testing:

```bash
# Using the Supabase CLI
supabase db seed --file supabase/seed.sql

# Or run the TypeScript seed script (requires .env with service role key)
cd app && npx ts-node ../scripts/seed-sample-data.ts
```

The seed data contains only generic fictional examples. No real company data, emails, or customer information.

---

## 9. Sanity Check

Run these queries in the Supabase SQL Editor to verify your setup:

```sql
-- 1. All tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. RLS is enabled on all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 3. Policies exist
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;

-- 4. Profile trigger exists
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public';
```

Also run the sanity check script:

```bash
bash scripts/sanity-check.sh
```

---

## 10. Important Security Reminders

- The `SUPABASE_SERVICE_ROLE_KEY` must **never** appear in `app/.env`, `app/.env.example`, or any file committed to the repository.
- The anon key (`EXPO_PUBLIC_SUPABASE_ANON_KEY`) is safe for client-side use — it is restricted by RLS and is designed to be public.
- Do not disable RLS on any user-owned table.
- Do not create overly broad policies (e.g., `USING (true)`) unless intentional and reviewed.
- See `docs/SECURITY.md` for the full security guide.
