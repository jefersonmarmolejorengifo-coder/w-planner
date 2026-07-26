-- Migration 002: Multi-project + dynamic dimensions
BEGIN;

-- 1. Projects table
CREATE TABLE IF NOT EXISTS projects (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  invite_code TEXT UNIQUE DEFAULT gen_random_uuid()::TEXT,
  config      JSONB DEFAULT '{}',
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Project members (for tracking invited collaborators)
CREATE TABLE IF NOT EXISTS project_members (
  id         BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  name       TEXT DEFAULT '',
  invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, email)
);

-- 3. Add project_id to existing tables (nullable for migration safety)
ALTER TABLE tasks        ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id);
ALTER TABLE participants ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id);
ALTER TABLE indicators   ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id);
ALTER TABLE task_types   ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id);
ALTER TABLE app_config   ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id);
ALTER TABLE email_config ADD COLUMN IF NOT EXISTS project_id BIGINT REFERENCES projects(id);

-- 4. Custom dimension values per task (for dimensions beyond the 3 built-in)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS dimension_values JSONB DEFAULT '{}';

-- 5. Create default project and migrate all existing data into it
DO $$
DECLARE proj_id BIGINT;
BEGIN
  INSERT INTO projects (name, description, config)
  VALUES (
    'Mi Proyecto',
    'Proyecto por defecto',
    jsonb_build_object(
      'pin', '020419*',
      'dimensions', jsonb_build_array(
        jsonb_build_object('key','tiempo',   'label','Tiempo estimado',  'weight',33,'builtin',true),
        jsonb_build_object('key','dificultad','label','Dificultad',       'weight',34,'builtin',true),
        jsonb_build_object('key','estrategico','label','Valor estratégico','weight',33,'builtin',true)
      )
    )
  )
  RETURNING id INTO proj_id;

  UPDATE tasks        SET project_id = proj_id WHERE project_id IS NULL;
  UPDATE participants SET project_id = proj_id WHERE project_id IS NULL;
  UPDATE indicators   SET project_id = proj_id WHERE project_id IS NULL;
  UPDATE task_types   SET project_id = proj_id WHERE project_id IS NULL;
  UPDATE app_config   SET project_id = proj_id WHERE project_id IS NULL;
  UPDATE email_config SET project_id = proj_id WHERE project_id IS NULL;
END $$;

COMMIT;
