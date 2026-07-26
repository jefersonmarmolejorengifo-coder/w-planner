-- Migration 003: OKRs, Sprints, Task History, Notifications, Templates
BEGIN;

-- ── OKRs ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS okrs (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  quarter     INT  DEFAULT 1,   -- 1..4
  year        INT  DEFAULT EXTRACT(YEAR FROM NOW()),
  status      TEXT DEFAULT 'active',  -- 'active' | 'closed'
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS key_results (
  id            BIGSERIAL PRIMARY KEY,
  okr_id        BIGINT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  target_value  NUMERIC DEFAULT 100,
  current_value NUMERIC DEFAULT 0,
  unit          TEXT DEFAULT '%',
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link tasks to a key result (optional 1:1)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kr_id BIGINT REFERENCES key_results(id) ON DELETE SET NULL;

-- ── Sprints ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sprints (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  goal        TEXT DEFAULT '',
  start_date  DATE,
  end_date    DATE,
  status      TEXT DEFAULT 'planning',  -- 'planning' | 'active' | 'closed'
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sprint_id BIGINT REFERENCES sprints(id) ON DELETE SET NULL;

-- ── Task history / audit log ──────────────────────────────
CREATE TABLE IF NOT EXISTS task_history (
  id          BIGSERIAL PRIMARY KEY,
  task_id     BIGINT NOT NULL,
  project_id  BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  changed_by  TEXT DEFAULT '',
  field_name  TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── In-app notifications ──────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  user_name   TEXT DEFAULT '',   -- empty = broadcast to all
  message     TEXT NOT NULL,
  type        TEXT DEFAULT 'info',  -- 'info' | 'warning' | 'danger' | 'success'
  task_id     BIGINT,
  read_by     TEXT[] DEFAULT '{}',  -- array of user names who dismissed it
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Project templates ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_templates (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  config        JSONB DEFAULT '{}',   -- dimensions, types, etc.
  tasks_schema  JSONB DEFAULT '[]',   -- sample task titles/types
  indicators    JSONB DEFAULT '[]',
  is_builtin    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed built-in templates
INSERT INTO project_templates (name, description, config, tasks_schema, indicators, is_builtin) VALUES
(
  'Lanzamiento de Producto',
  'Plantilla para equipos de producto y marketing. Incluye fases de discovery, desarrollo y go-to-market.',
  '{"dimensions":[{"key":"tiempo","label":"Esfuerzo estimado","weight":30,"builtin":true},{"key":"dificultad","label":"Complejidad técnica","weight":35,"builtin":true},{"key":"estrategico","label":"Impacto en lanzamiento","weight":35,"builtin":true}]}',
  '[{"title":"Investigación de mercado","type":"Operativa","status":"Sin iniciar"},{"title":"Definición de MVP","type":"Operativa","status":"Sin iniciar"},{"title":"Diseño de UI/UX","type":"Creativa","status":"Sin iniciar"},{"title":"Desarrollo de funcionalidades core","type":"Operativa","status":"Sin iniciar"},{"title":"Plan de comunicación","type":"Administrativa","status":"Sin iniciar"},{"title":"Pruebas beta con usuarios","type":"Seguimiento","status":"Sin iniciar"},{"title":"Go-to-market y lanzamiento","type":"Operativa","status":"Sin iniciar"}]',
  '["Adopción de usuarios","Revenue","NPS","Time to market"]',
  TRUE
),
(
  'Auditoría Trimestral',
  'Revisión 360° de procesos, resultados e indicadores de equipo. Ideal para cierres de trimestre.',
  '{"dimensions":[{"key":"tiempo","label":"Tiempo requerido","weight":25,"builtin":true},{"key":"dificultad","label":"Dificultad","weight":25,"builtin":true},{"key":"estrategico","label":"Relevancia estratégica","weight":50,"builtin":true}]}',
  '[{"title":"Recopilación de datos del trimestre","type":"Administrativa","status":"Sin iniciar"},{"title":"Análisis de indicadores clave","type":"Seguimiento","status":"Sin iniciar"},{"title":"Entrevistas con responsables de área","type":"Seguimiento","status":"Sin iniciar"},{"title":"Identificación de brechas","type":"Operativa","status":"Sin iniciar"},{"title":"Informe ejecutivo de resultados","type":"Administrativa","status":"Sin iniciar"},{"title":"Plan de mejora siguiente trimestre","type":"Operativa","status":"Sin iniciar"}]',
  '["Cumplimiento de objetivos","Eficiencia operativa","Satisfacción del equipo"]',
  TRUE
),
(
  'Gestión de Equipo Comercial',
  'Seguimiento de actividades comerciales, pipeline y resultados de ventas.',
  '{"dimensions":[{"key":"tiempo","label":"Tiempo de cierre","weight":20,"builtin":true},{"key":"dificultad","label":"Complejidad del cliente","weight":30,"builtin":true},{"key":"estrategico","label":"Potencial de revenue","weight":50,"builtin":true}]}',
  '[{"title":"Prospección de clientes nuevos","type":"Operativa","status":"Sin iniciar"},{"title":"Seguimiento de pipeline activo","type":"Seguimiento","status":"Sin iniciar"},{"title":"Presentaciones comerciales","type":"Operativa","status":"Sin iniciar"},{"title":"Negociación y cierre","type":"Operativa","status":"Sin iniciar"},{"title":"Onboarding de nuevos clientes","type":"Apadrinamiento","status":"Sin iniciar"},{"title":"Reporte de resultados del mes","type":"Administrativa","status":"Sin iniciar"}]',
  '["Nuevos clientes","Tasa de conversión","Revenue mensual","NPS comercial"]',
  TRUE
)
ON CONFLICT DO NOTHING;

COMMIT;
