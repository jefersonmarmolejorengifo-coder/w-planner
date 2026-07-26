-- Migration 008: Custom task field definitions per project + auto-tracked fields.
--
-- Adds:
--   * task_field_defs   — per-project schema for custom card fields
--   * tasks.custom_fields JSONB — stores values keyed by field def "key"
--   * tasks.updated_at  — set by trigger on every effective change
--   * tasks.closed_at   — set by trigger when status enters a close state
--   * tasks.last_modified_by — set by the client (same pattern as
--                              task_history.changed_by; see docs/architecture.md
--                              "Deuda Tecnica Conocida")
--
-- Does NOT touch the dimensions / weighting system (calcAporte) — that
-- remains owned by app_config and tasks.dimension_values.

BEGIN;

-- ── 1. Auto-tracked columns on tasks ─────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS closed_at         TIMESTAMP WITH TIME ZONE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_modified_by  TEXT DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_fields     JSONB DEFAULT '{}'::jsonb;

-- Backfill updated_at for legacy rows. Some environments are missing the
-- created_at column (it's optional in earlier ad-hoc setups), so probe first
-- and fall back to NOW() to avoid 42703.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'tasks'
      AND column_name  = 'created_at'
  ) THEN
    EXECUTE 'UPDATE tasks SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL';
  ELSE
    EXECUTE 'UPDATE tasks SET updated_at = NOW() WHERE updated_at IS NULL';
  END IF;
END $$;

-- ── 2. Trigger: keep updated_at + closed_at consistent ───────
-- Close states must match CLOSE_STATES in src/ProductivityPlus.jsx
-- (currently: ['Finalizada','Cancelada']). Keep both lists in sync.
--
-- Runs as INVOKER (no SECURITY DEFINER): the trigger only mutates NEW,
-- no privileged side effects are needed.
CREATE OR REPLACE FUNCTION public.set_task_auto_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  close_states TEXT[] := ARRAY['Finalizada','Cancelada'];
  status_is_close BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Honor explicit values if provided, otherwise default.
    NEW.updated_at := COALESCE(NEW.updated_at, NOW());
    status_is_close := NEW.status = ANY(close_states);
    IF status_is_close AND NEW.closed_at IS NULL THEN
      NEW.closed_at := NOW();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE branch: skip if nothing changed (idempotent updates,
  -- "UPDATE t SET status = status" must not bump updated_at).
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  NEW.updated_at := NOW();

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    status_is_close := NEW.status = ANY(close_states);
    IF status_is_close AND OLD.closed_at IS NULL THEN
      NEW.closed_at := NOW();
    ELSIF NOT status_is_close AND OLD.closed_at IS NOT NULL THEN
      NEW.closed_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_task_auto_fields() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS tasks_set_auto_fields ON tasks;
CREATE TRIGGER tasks_set_auto_fields
  BEFORE INSERT OR UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_task_auto_fields();

-- ── 3. task_field_defs table ────────────────────────────────
CREATE TABLE IF NOT EXISTS task_field_defs (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key           TEXT   NOT NULL,
  label         TEXT   NOT NULL,
  type          TEXT   NOT NULL,
  config        JSONB  DEFAULT '{}'::jsonb,
  position      INT    DEFAULT 0,
  required      BOOLEAN DEFAULT FALSE,
  show_on_card  BOOLEAN DEFAULT FALSE,
  builtin       BOOLEAN DEFAULT FALSE,
  deleted_at    TIMESTAMP WITH TIME ZONE,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Constraints added defensively so re-running on a pre-existing table still
-- enforces them (CREATE TABLE IF NOT EXISTS ignores the inline definition
-- when the table already exists).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_field_defs_type_check'
      AND conrelid = 'task_field_defs'::regclass
  ) THEN
    ALTER TABLE task_field_defs
      ADD CONSTRAINT task_field_defs_type_check
      CHECK (type IN ('text','textarea','date','select','multiselect','subitems','auto'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_field_defs_key_format'
      AND conrelid = 'task_field_defs'::regclass
  ) THEN
    ALTER TABLE task_field_defs
      ADD CONSTRAINT task_field_defs_key_format
      CHECK (key ~ '^[a-z][a-z0-9_]{0,49}$');
  END IF;

  -- Blacklist keys that would collide with hardcoded task columns or
  -- with our auto-tracked columns. Custom fields live in tasks.custom_fields
  -- and must never shadow real columns when the frontend spreads them.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_field_defs_key_not_reserved'
      AND conrelid = 'task_field_defs'::regclass
  ) THEN
    ALTER TABLE task_field_defs
      ADD CONSTRAINT task_field_defs_key_not_reserved
      CHECK (key NOT IN (
        'id','project_id','title','status','type','responsible','comments',
        'subtasks','indicators','indicator','start_date','end_date',
        'estimated_time','difficulty','strategic_value','expected_delivery',
        'progress_percent','dependent_task','validation_close',
        'ext_progress1','ext_progress2','aporte_snapshot','finalized_at',
        'dimension_values','kr_id','sprint_id','created_at','updated_at',
        'closed_at','last_modified_by','custom_fields',
        'createdat','updatedat','closedat','lastmodifiedby','customfields'
      ));
  END IF;
END $$;

-- key is unique per project among non-deleted rows; allows recreating
-- a previously soft-deleted key with the same name.
CREATE UNIQUE INDEX IF NOT EXISTS task_field_defs_project_key_uidx
  ON task_field_defs(project_id, key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS task_field_defs_project_idx
  ON task_field_defs(project_id);

CREATE INDEX IF NOT EXISTS task_field_defs_active_idx
  ON task_field_defs(project_id, position)
  WHERE deleted_at IS NULL;

-- Bump updated_at on every effective row change.
CREATE OR REPLACE FUNCTION public.set_task_field_defs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_task_field_defs_updated_at() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS task_field_defs_touch_updated_at ON task_field_defs;
CREATE TRIGGER task_field_defs_touch_updated_at
  BEFORE UPDATE ON task_field_defs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_task_field_defs_updated_at();

-- ── 4. RLS ──────────────────────────────────────────────────
ALTER TABLE task_field_defs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_field_defs_member_select ON task_field_defs;
DROP POLICY IF EXISTS task_field_defs_owner_write   ON task_field_defs;

-- All project members can read the schema (needed to render forms / cards).
CREATE POLICY task_field_defs_member_select ON task_field_defs FOR SELECT TO authenticated
  USING (is_project_member(project_id));

-- Only the project owner can create / update / delete defs.
CREATE POLICY task_field_defs_owner_write ON task_field_defs FOR ALL TO authenticated
  USING (is_project_owner(project_id))
  WITH CHECK (is_project_owner(project_id));

-- ── 5. Explicit grants for authenticated ────────────────────
-- Supabase usually grants these by default, but being explicit avoids
-- environment-specific surprises.
GRANT SELECT, INSERT, UPDATE, DELETE ON task_field_defs TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE task_field_defs_id_seq TO authenticated;

COMMIT;

-- ── Verification queries (run manually after applying) ──────
-- select column_name, data_type, column_default
--   from information_schema.columns
--   where table_name = 'tasks'
--     and column_name in ('updated_at','closed_at','last_modified_by','custom_fields');
--
-- select tablename, rowsecurity
--   from pg_tables where tablename = 'task_field_defs';
--
-- select tgname, tgenabled from pg_trigger
--   where tgrelid in ('tasks'::regclass, 'task_field_defs'::regclass)
--   order by tgname;
--
-- select conname from pg_constraint
--   where conrelid = 'task_field_defs'::regclass
--   order by conname;
