-- 022_okr_dates.sql
-- Reemplaza quarter/year por start_date/end_date en la tabla okrs.
-- Motivación: que el formulario de tarea pueda ofrecer dropdown automático
-- filtrado por fecha (la fecha de creación de la tarjeta cae dentro del
-- rango del OKR/Sprint para sugerirlo). Sprints ya manejan rango por DATE;
-- ahora OKRs lo manejan igual.
--
-- Migración idempotente: chequea existencia antes de cada paso.

-- ─── 1. Añade columnas si no existen ─────────────────────────
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS end_date DATE;

-- ─── 2. Backfill desde quarter/year (cuando existen las columnas) ────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'okrs' AND column_name = 'quarter'
  ) THEN
    UPDATE okrs SET
      start_date = MAKE_DATE(year, (quarter - 1) * 3 + 1, 1),
      end_date   = (MAKE_DATE(year, quarter * 3, 1) + INTERVAL '1 month - 1 day')::DATE
    WHERE start_date IS NULL
      AND quarter IS NOT NULL
      AND year IS NOT NULL;
  END IF;
END $$;

-- ─── 3. Fallback al trimestre actual para cualquier OKR sin fechas ───
UPDATE okrs SET
  start_date = MAKE_DATE(
    EXTRACT(YEAR FROM NOW())::INT,
    ((EXTRACT(QUARTER FROM NOW())::INT - 1) * 3 + 1),
    1
  ),
  end_date = (MAKE_DATE(
    EXTRACT(YEAR FROM NOW())::INT,
    EXTRACT(QUARTER FROM NOW())::INT * 3,
    1
  ) + INTERVAL '1 month - 1 day')::DATE
WHERE start_date IS NULL OR end_date IS NULL;

-- ─── 4. NOT NULL + check de orden ──────────────────────────
ALTER TABLE okrs ALTER COLUMN start_date SET NOT NULL;
ALTER TABLE okrs ALTER COLUMN end_date SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'okrs' AND constraint_name = 'okrs_dates_check'
  ) THEN
    ALTER TABLE okrs ADD CONSTRAINT okrs_dates_check CHECK (end_date >= start_date);
  END IF;
END $$;

-- ─── 5. Drop quarter y year (reemplazo, decisión explícita) ──
ALTER TABLE okrs DROP COLUMN IF EXISTS quarter;
ALTER TABLE okrs DROP COLUMN IF EXISTS year;

-- ─── 6. Índice por rango para acelerar el match con tareas ──
CREATE INDEX IF NOT EXISTS okrs_dates_idx ON okrs (project_id, start_date, end_date);
