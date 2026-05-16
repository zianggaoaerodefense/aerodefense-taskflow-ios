-- =============================================================================
-- TaskFlow initial schema
-- All user-owned tables have RLS enabled with user-scoped policies.
-- Edge Functions use the service role key, which bypasses RLS.
-- The app uses the anon key with a user JWT, which is bound by RLS.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles
-- One row per auth.users entry. Created automatically via trigger.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name   TEXT,
  org_id         TEXT,
  role           TEXT NOT NULL DEFAULT 'user',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- workflows
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workflows (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'archived')),
  config      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- workflow_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id  UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'completed', 'failed')),
  input        JSONB,
  output       JSONB,
  error        TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- summaries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.summaries (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  source      TEXT CHECK (source IN ('agent', 'user', 'manual')),
  source_ref  TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tasks (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id    UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  summary_id     UUID REFERENCES public.summaries(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'in_progress', 'waiting', 'done', 'archived')),
  priority       TEXT NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  due_at         TIMESTAMPTZ,
  snoozed_until  TIMESTAMPTZ,
  source         TEXT NOT NULL DEFAULT 'user'
                   CHECK (source IN ('agent', 'user')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- task_events
-- Append-only audit trail of all task mutations. No UPDATE or DELETE allowed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.task_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id         UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor           TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
  event_type      TEXT NOT NULL
                    CHECK (event_type IN (
                      'created', 'updated', 'status_changed',
                      'snoozed', 'completed', 'archived'
                    )),
  previous_status TEXT,
  new_status      TEXT,
  details         JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- agent_messages
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE SET NULL,
  role        TEXT NOT NULL DEFAULT 'agent'
                CHECK (role IN ('agent', 'system')),
  content     TEXT NOT NULL,
  context     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- agent_connections
-- Only the SHA-256 hash of the raw token is stored here.
-- The raw token is returned once on creation and never persisted.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_connections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL DEFAULT 'ChatGPT Agent',
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'revoked')),
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- integration_connections
-- Tracks external integration links (Gmail, Slack, Jira).
-- OAuth tokens must NOT be stored in this table; use Supabase Vault.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integration_connections (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'revoked', 'error')),
  scopes     TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- audit_logs
-- Append-only. App users may SELECT their own rows.
-- INSERT is done exclusively via Edge Functions using the service role.
-- Sensitive field values (rawText, body, tokens) must never appear here.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor           TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
  actor_id        TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  before_snapshot JSONB,
  after_snapshot  JSONB,
  ip_address      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Trigger: auto-create profile on user signup
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (new.id, split_part(new.email, '@', 1))
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-Level Security: enable on all user-owned tables
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.summaries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_connections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs            ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS Policies: profiles
-- ---------------------------------------------------------------------------

CREATE POLICY "profiles: select own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles: insert own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: update own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- RLS Policies: workflows
-- ---------------------------------------------------------------------------

CREATE POLICY "workflows: select own"
  ON public.workflows FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "workflows: insert own"
  ON public.workflows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "workflows: update own"
  ON public.workflows FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS Policies: workflow_runs
-- ---------------------------------------------------------------------------

CREATE POLICY "workflow_runs: select own"
  ON public.workflow_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "workflow_runs: insert own"
  ON public.workflow_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS Policies: summaries
-- ---------------------------------------------------------------------------

CREATE POLICY "summaries: select own"
  ON public.summaries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "summaries: insert own"
  ON public.summaries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "summaries: update own"
  ON public.summaries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS Policies: tasks
-- ---------------------------------------------------------------------------

CREATE POLICY "tasks: select own"
  ON public.tasks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "tasks: insert own"
  ON public.tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "tasks: update own"
  ON public.tasks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS Policies: task_events (append-only from app; no UPDATE or DELETE)
-- ---------------------------------------------------------------------------

CREATE POLICY "task_events: select own"
  ON public.task_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "task_events: insert own"
  ON public.task_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS Policies: agent_messages
-- ---------------------------------------------------------------------------

CREATE POLICY "agent_messages: select own"
  ON public.agent_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "agent_messages: insert own"
  ON public.agent_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS Policies: agent_connections
-- ---------------------------------------------------------------------------

CREATE POLICY "agent_connections: select own"
  ON public.agent_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "agent_connections: insert own"
  ON public.agent_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "agent_connections: update own"
  ON public.agent_connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS Policies: integration_connections
-- ---------------------------------------------------------------------------

CREATE POLICY "integration_connections: select own"
  ON public.integration_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "integration_connections: insert own"
  ON public.integration_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "integration_connections: update own"
  ON public.integration_connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- RLS Policies: audit_logs
-- Read-only for app users. INSERT is done via service role in Edge Functions.
-- ---------------------------------------------------------------------------

CREATE POLICY "audit_logs: select own"
  ON public.audit_logs FOR SELECT
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_workflows_user_status
  ON public.workflows(user_id, status);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_id
  ON public.workflow_runs(user_id);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id
  ON public.workflow_runs(workflow_id);

CREATE INDEX IF NOT EXISTS idx_summaries_user_created
  ON public.summaries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_summaries_workflow_id
  ON public.summaries(workflow_id);

CREATE INDEX IF NOT EXISTS idx_tasks_user_status
  ON public.tasks(user_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_user_due
  ON public.tasks(user_id, due_at)
  WHERE due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_created
  ON public.tasks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id
  ON public.tasks(workflow_id);

CREATE INDEX IF NOT EXISTS idx_task_events_task_id
  ON public.task_events(task_id);

CREATE INDEX IF NOT EXISTS idx_task_events_user_created
  ON public.task_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_messages_user_created
  ON public.agent_messages(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_connections_user_id
  ON public.agent_connections(user_id);

-- token_hash lookups happen on every agent request — needs a btree index
CREATE INDEX IF NOT EXISTS idx_agent_connections_token_hash
  ON public.agent_connections(token_hash);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON public.audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON public.audit_logs(entity_type, entity_id);
