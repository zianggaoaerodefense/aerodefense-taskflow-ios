-- =============================================================================
-- Migration: enriched_task_schema
-- Adds enriched categorization, grouping, scoring, and metadata fields.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS throughout.
-- Does not remove or rename any existing column.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- tasks: enriched source and categorization fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source_type       TEXT,
  ADD COLUMN IF NOT EXISTS source_title      TEXT,
  ADD COLUMN IF NOT EXISTS source_url        TEXT,
  ADD COLUMN IF NOT EXISTS source_ref        TEXT,
  ADD COLUMN IF NOT EXISTS last_source_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS task_category     TEXT,
  ADD COLUMN IF NOT EXISTS task_subcategory  TEXT,
  ADD COLUMN IF NOT EXISTS workflow_name     TEXT,
  ADD COLUMN IF NOT EXISTS project_name      TEXT,
  ADD COLUMN IF NOT EXISTS requester         TEXT,
  ADD COLUMN IF NOT EXISTS owner             TEXT,
  ADD COLUMN IF NOT EXISTS tags              TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS group_keys        JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata          JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS urgency_score     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importance_score  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicate_check_note TEXT;

-- Expand the source CHECK constraint to include enriched source types.
-- Keep legacy 'agent' and 'user' for backward compatibility.
DO $$
BEGIN
  -- Drop the auto-generated constraint created by the initial migration
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_source_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks DROP CONSTRAINT tasks_source_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_source_enriched_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_source_enriched_check
      CHECK (source IN (
        'email', 'slack', 'calendar', 'jira', 'github',
        'chatgpt_agent', 'manual',
        'agent', 'user'
      ));
  END IF;
END $$;

-- Add task_category CHECK constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_task_category_check'
      AND conrelid = 'public.tasks'::regclass
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_task_category_check
      CHECK (task_category IN (
        'review', 'respond', 'approve', 'follow_up', 'schedule',
        'prepare', 'investigate', 'implement', 'test', 'deploy',
        'decide', 'summarize', 'monitor', 'delegate', 'blocked'
      ));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- tasks: additional indexes for grouping and sorting
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_tasks_user_priority
  ON public.tasks(user_id, priority);

CREATE INDEX IF NOT EXISTS idx_tasks_user_source
  ON public.tasks(user_id, source);

CREATE INDEX IF NOT EXISTS idx_tasks_user_source_type
  ON public.tasks(user_id, source_type)
  WHERE source_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_task_category
  ON public.tasks(user_id, task_category)
  WHERE task_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_workflow_name
  ON public.tasks(user_id, workflow_name)
  WHERE workflow_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_project_name
  ON public.tasks(user_id, project_name)
  WHERE project_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_requester
  ON public.tasks(user_id, requester)
  WHERE requester IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_urgency
  ON public.tasks(user_id, urgency_score DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_tags_gin
  ON public.tasks USING gin(tags);

CREATE INDEX IF NOT EXISTS idx_tasks_metadata_gin
  ON public.tasks USING gin(metadata);

CREATE INDEX IF NOT EXISTS idx_tasks_group_keys_gin
  ON public.tasks USING gin(group_keys);

-- ---------------------------------------------------------------------------
-- summaries: enriched fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.summaries
  ADD COLUMN IF NOT EXISTS summary_date       DATE,
  ADD COLUMN IF NOT EXISTS source_coverage    TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS key_decisions      TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS blockers           TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS next_actions       TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS category_breakdown JSONB   NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_breakdown JSONB   NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommended_views  TEXT[]  NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- workflows: enriched grouping and metadata fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS objective                TEXT,
  ADD COLUMN IF NOT EXISTS current_focus            TEXT,
  ADD COLUMN IF NOT EXISTS cadence                  TEXT,
  ADD COLUMN IF NOT EXISTS next_review_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS project_name             TEXT,
  ADD COLUMN IF NOT EXISTS workflow_category        TEXT,
  ADD COLUMN IF NOT EXISTS primary_sources          TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS related_people           TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS related_repos            TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS related_jira_projects    TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS related_slack_channels   TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS related_customers        TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sort_order               INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_task_count        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_task_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS high_priority_task_count INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- workflow_runs: enriched run statistics
-- ---------------------------------------------------------------------------

ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS source_coverage                    TEXT[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tasks_created_count                INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tasks_updated_count                INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duplicates_skipped_count           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS summaries_created_count            INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS workflows_created_or_updated_count INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- task_events: enriched context fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.task_events
  ADD COLUMN IF NOT EXISTS source_type   TEXT,
  ADD COLUMN IF NOT EXISTS task_category TEXT,
  ADD COLUMN IF NOT EXISTS workflow_name TEXT,
  ADD COLUMN IF NOT EXISTS project_name  TEXT;
