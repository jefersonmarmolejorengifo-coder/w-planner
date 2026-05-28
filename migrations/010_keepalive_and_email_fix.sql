-- Migration 010: keep-alive table + email_config sequence fix + pg_cron backup.
--
-- Trae tres cosas:
--   1. Tabla `_keepalive` que el cron de Vercel + pg_cron actualizan cada 6
--      días con un caracter rotativo. Evita que Supabase Free pause el proyecto
--      tras 7 días sin actividad.
--   2. Re-sincroniza el sequence de email_config.id porque el upsert estaba
--      fallando con `duplicate key value violates unique constraint
--      "email_config_pkey"` cuando MAX(id) > nextval del sequence.
--   3. Programa un pg_cron como redundancia del keep-alive si el cron de
--      Vercel falla. Requiere la extensión pg_cron habilitada (Database >
--      Extensions). Si no está activada, la sección 3 hace skip silencioso.

BEGIN;

-- ── 1. Tabla de keep-alive ─────────────────────────────────
-- Una sola fila por diseño (CHECK id = 1). Sólo el service_role la toca
-- (RLS habilitada sin policies = nadie accede via PostgREST).
CREATE TABLE IF NOT EXISTS public._keepalive (
  id        INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ch        CHAR(1) NOT NULL DEFAULT '.',
  pinged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public._keepalive ENABLE ROW LEVEL SECURITY;

-- Sin policies: la tabla queda invisible para roles authenticated/anon. El
-- service_role bypassea RLS (lo usa api/cron.js) y pg_cron corre como
-- postgres (también bypassea).

INSERT INTO public._keepalive (id, ch) VALUES (1, '.')
ON CONFLICT (id) DO NOTHING;

-- ── 2. Re-sincronizar sequence de email_config.id ──────────
-- Si el sequence quedó desfasado, los upsert tipo "INSERT ... ON CONFLICT
-- (project_id) DO UPDATE" pueden estallar al intentar usar un id ya tomado.
DO $$
DECLARE
  seq_name TEXT;
BEGIN
  seq_name := pg_get_serial_sequence('public.email_config', 'id');
  IF seq_name IS NOT NULL THEN
    EXECUTE format(
      'SELECT setval(%L, GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.email_config), 1), true)',
      seq_name
    );
  END IF;
END $$;

-- Asegura idempotentemente que el UNIQUE constraint que la migración 006
-- intentó dejar siga existiendo (algunos entornos lo perdieron en migraciones
-- intermedias).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_config_project_id_key'
      AND conrelid = 'public.email_config'::regclass
  ) THEN
    ALTER TABLE public.email_config
      ADD CONSTRAINT email_config_project_id_key UNIQUE(project_id);
  END IF;
END $$;

COMMIT;

-- ── 3. pg_cron redundante (fuera de la transacción) ────────
-- Sólo corre si la extensión pg_cron está disponible. En Supabase Free hay
-- que habilitarla manualmente en: Database > Extensions > pg_cron.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Desprograma el job anterior si existe (idempotente).
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'w_planner_keepalive';

    -- Programa el job: cada 6 días al mediodía UTC.
    PERFORM cron.schedule(
      'w_planner_keepalive',
      '0 12 */6 * *',
      $cron$
        UPDATE public._keepalive
           SET ch = (ARRAY['.', ',', '*', '·', '~', ':'])[1 + floor(random()*6)::int],
               pinged_at = NOW()
         WHERE id = 1;
      $cron$
    );

    RAISE NOTICE 'pg_cron job w_planner_keepalive programado cada 6 días.';
  ELSE
    RAISE NOTICE 'pg_cron no está instalado. Skip. Habilítalo en Database > Extensions si quieres redundancia.';
  END IF;
END $$;

-- ── Verificación (corre manualmente después de aplicar) ────
-- SELECT * FROM public._keepalive;
-- SELECT setval(pg_get_serial_sequence('public.email_config','id'),
--               (SELECT MAX(id) FROM public.email_config), true);
-- SELECT * FROM cron.job WHERE jobname = 'w_planner_keepalive';
