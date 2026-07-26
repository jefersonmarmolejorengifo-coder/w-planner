-- Migration 006: Multi-tenant isolation, RLS, and safer server-side helpers.

BEGIN;

-- Normalize project-scoped configuration.
ALTER TABLE key_results ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE;

UPDATE key_results kr
SET project_id = o.project_id
FROM okrs o
WHERE kr.okr_id = o.id
  AND kr.project_id IS NULL;

DROP INDEX IF EXISTS email_config_project_id_uidx;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_config_project_id_key'
      AND conrelid = 'email_config'::regclass
  ) THEN
    ALTER TABLE email_config
      ADD CONSTRAINT email_config_project_id_key UNIQUE(project_id);
  END IF;
END $$;

ALTER TABLE task_types DROP CONSTRAINT IF EXISTS task_types_name_key;
DROP INDEX IF EXISTS task_types_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS task_types_project_name_uidx
  ON task_types(COALESCE(project_id, 0), lower(name));

CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks(project_id);
CREATE INDEX IF NOT EXISTS participants_project_id_idx ON participants(project_id);
CREATE INDEX IF NOT EXISTS indicators_project_id_idx ON indicators(project_id);
CREATE INDEX IF NOT EXISTS okrs_project_id_idx ON okrs(project_id);
CREATE INDEX IF NOT EXISTS key_results_project_id_idx ON key_results(project_id);
CREATE INDEX IF NOT EXISTS sprints_project_id_idx ON sprints(project_id);
CREATE INDEX IF NOT EXISTS email_config_project_id_idx ON email_config(project_id);

DO $$
DECLARE
  seq_name TEXT;
BEGIN
  seq_name := pg_get_serial_sequence('participants', 'id');
  IF seq_name IS NOT NULL THEN
    EXECUTE format('SELECT setval(%L, GREATEST((SELECT COALESCE(MAX(id), 0) FROM participants), 1), true)', seq_name);
  END IF;

  seq_name := pg_get_serial_sequence('indicators', 'id');
  IF seq_name IS NOT NULL THEN
    EXECUTE format('SELECT setval(%L, GREATEST((SELECT COALESCE(MAX(id), 0) FROM indicators), 1), true)', seq_name);
  END IF;

  seq_name := pg_get_serial_sequence('email_config', 'id');
  IF seq_name IS NOT NULL THEN
    EXECUTE format('SELECT setval(%L, GREATEST((SELECT COALESCE(MAX(id), 0) FROM email_config), 1), true)', seq_name);
  END IF;
END $$;

-- Atomic task id reservation must bypass RLS safely.
-- PostgreSQL cannot change a function return type with CREATE OR REPLACE, so
-- drop the legacy version before recreating it as BIGINT.
DROP FUNCTION IF EXISTS public.claim_task_id();

CREATE OR REPLACE FUNCTION claim_task_id()
RETURNS BIGINT AS $$
DECLARE
  current_value BIGINT;
  value_type TEXT;
BEGIN
  SELECT data_type INTO value_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'app_config'
    AND column_name = 'value';

  LOOP
    current_value := NULL;
    IF value_type = 'jsonb' THEN
      EXECUTE $SQL$
        UPDATE app_config
        SET value = to_jsonb((value::text::BIGINT + 1))
        WHERE key = 'nextId'
        RETURNING value::text::BIGINT
      $SQL$ INTO current_value;
    ELSE
      EXECUTE $SQL$
        UPDATE app_config
        SET value = ((value::text::BIGINT + 1)::TEXT)
        WHERE key = 'nextId'
        RETURNING value::text::BIGINT
      $SQL$ INTO current_value;
    END IF;

    IF current_value IS NOT NULL THEN
      RETURN current_value - 1;
    END IF;

    BEGIN
      IF value_type = 'jsonb' THEN
        EXECUTE $SQL$ INSERT INTO app_config ("key", value) VALUES ('nextId', '2'::jsonb) $SQL$;
      ELSE
        EXECUTE $SQL$ INSERT INTO app_config ("key", value) VALUES ('nextId', '2') $SQL$;
      END IF;
      RETURN 1;
    EXCEPTION WHEN unique_violation THEN
      -- Another process wrote the row first, retry.
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_project_owner(pid BIGINT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid
      AND p.owner_id = auth.uid()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_project_member(pid BIGINT)
RETURNS BOOLEAN AS $$
  SELECT is_project_owner(pid)
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id = pid
        AND (
          m.user_id = auth.uid()
          OR lower(m.email) = lower(COALESCE(auth.email(), ''))
        )
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION join_project_by_invite_code(invite_code_input TEXT)
RETURNS projects AS $$
DECLARE
  p projects;
  member_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO p
  FROM projects
  WHERE invite_code = invite_code_input;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite code' USING ERRCODE = 'P0002';
  END IF;

  member_name := COALESCE(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.email(), '');

  INSERT INTO project_members(project_id, email, name, user_id)
  VALUES (p.id, auth.email(), member_name, auth.uid())
  ON CONFLICT(project_id, email)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    name = COALESCE(NULLIF(EXCLUDED.name, ''), project_members.name);

  INSERT INTO participants(name, is_super_user, project_id, auth_user_id, email)
  SELECT member_name, FALSE, p.id, auth.uid(), auth.email()
  WHERE NOT EXISTS (
    SELECT 1 FROM participants
    WHERE project_id = p.id
      AND (auth_user_id = auth.uid() OR lower(email) = lower(COALESCE(auth.email(), '')))
  );

  RETURN p;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION claim_task_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION is_project_owner(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_project_member(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION join_project_by_invite_code(TEXT) TO authenticated;

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE okrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_select_member ON projects;
DROP POLICY IF EXISTS projects_insert_owner ON projects;
DROP POLICY IF EXISTS projects_update_owner ON projects;
DROP POLICY IF EXISTS projects_delete_owner ON projects;
CREATE POLICY projects_select_member ON projects FOR SELECT TO authenticated
  USING (is_project_member(id));
CREATE POLICY projects_insert_owner ON projects FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY projects_update_owner ON projects FOR UPDATE TO authenticated
  USING (is_project_owner(id))
  WITH CHECK (is_project_owner(id));
CREATE POLICY projects_delete_owner ON projects FOR DELETE TO authenticated
  USING (is_project_owner(id));

DROP POLICY IF EXISTS project_members_select_member ON project_members;
DROP POLICY IF EXISTS project_members_insert_owner ON project_members;
DROP POLICY IF EXISTS project_members_update_owner ON project_members;
DROP POLICY IF EXISTS project_members_delete_owner ON project_members;
CREATE POLICY project_members_select_member ON project_members FOR SELECT TO authenticated
  USING (is_project_member(project_id));
CREATE POLICY project_members_insert_owner ON project_members FOR INSERT TO authenticated
  WITH CHECK (is_project_owner(project_id));
CREATE POLICY project_members_update_owner ON project_members FOR UPDATE TO authenticated
  USING (is_project_owner(project_id))
  WITH CHECK (is_project_owner(project_id));
CREATE POLICY project_members_delete_owner ON project_members FOR DELETE TO authenticated
  USING (is_project_owner(project_id) OR user_id = auth.uid() OR lower(email) = lower(COALESCE(auth.email(), '')));

DROP POLICY IF EXISTS tasks_member_all ON tasks;
CREATE POLICY tasks_member_all ON tasks FOR ALL TO authenticated
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));

DROP POLICY IF EXISTS participants_member_select ON participants;
DROP POLICY IF EXISTS participants_owner_all ON participants;
DROP POLICY IF EXISTS participants_member_all ON participants;
CREATE POLICY participants_member_select ON participants FOR SELECT TO authenticated
  USING (is_project_member(project_id));
CREATE POLICY participants_owner_all ON participants FOR ALL TO authenticated
  USING (is_project_owner(project_id))
  WITH CHECK (is_project_owner(project_id));

DROP POLICY IF EXISTS indicators_member_select ON indicators;
DROP POLICY IF EXISTS indicators_owner_all ON indicators;
DROP POLICY IF EXISTS indicators_member_all ON indicators;
CREATE POLICY indicators_member_select ON indicators FOR SELECT TO authenticated
  USING (is_project_member(project_id));
CREATE POLICY indicators_owner_all ON indicators FOR ALL TO authenticated
  USING (is_project_owner(project_id))
  WITH CHECK (is_project_owner(project_id));

DROP POLICY IF EXISTS task_types_select_scoped ON task_types;
DROP POLICY IF EXISTS task_types_owner_all ON task_types;
CREATE POLICY task_types_select_scoped ON task_types FOR SELECT TO authenticated
  USING (project_id IS NULL OR is_project_member(project_id));
CREATE POLICY task_types_owner_all ON task_types FOR ALL TO authenticated
  USING (project_id IS NOT NULL AND is_project_owner(project_id))
  WITH CHECK (project_id IS NOT NULL AND is_project_owner(project_id));

DROP POLICY IF EXISTS app_config_project_read ON app_config;
DROP POLICY IF EXISTS app_config_project_owner_write ON app_config;
CREATE POLICY app_config_project_read ON app_config FOR SELECT TO authenticated
  USING (project_id IS NULL OR is_project_member(project_id));
CREATE POLICY app_config_project_owner_write ON app_config FOR UPDATE TO authenticated
  USING (project_id IS NOT NULL AND is_project_owner(project_id))
  WITH CHECK (project_id IS NOT NULL AND is_project_owner(project_id));

DROP POLICY IF EXISTS email_config_owner_all ON email_config;
CREATE POLICY email_config_owner_all ON email_config FOR ALL TO authenticated
  USING (is_project_owner(project_id))
  WITH CHECK (is_project_owner(project_id));

DROP POLICY IF EXISTS okrs_member_all ON okrs;
CREATE POLICY okrs_member_all ON okrs FOR ALL TO authenticated
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));

DROP POLICY IF EXISTS key_results_member_all ON key_results;
CREATE POLICY key_results_member_all ON key_results FOR ALL TO authenticated
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));

DROP POLICY IF EXISTS sprints_member_all ON sprints;
CREATE POLICY sprints_member_all ON sprints FOR ALL TO authenticated
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));

DROP POLICY IF EXISTS task_history_member_all ON task_history;
CREATE POLICY task_history_member_all ON task_history FOR ALL TO authenticated
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));

DROP POLICY IF EXISTS notifications_member_all ON notifications;
CREATE POLICY notifications_member_all ON notifications FOR ALL TO authenticated
  USING (is_project_member(project_id))
  WITH CHECK (is_project_member(project_id));

DROP POLICY IF EXISTS project_templates_read ON project_templates;
CREATE POLICY project_templates_read ON project_templates FOR SELECT TO authenticated
  USING (TRUE);

COMMIT;
