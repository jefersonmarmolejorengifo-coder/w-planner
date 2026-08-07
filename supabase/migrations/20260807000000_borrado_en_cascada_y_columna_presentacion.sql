-- ─────────────────────────────────────────────────────────────────────────────
-- Dos desajustes entre lo que el código promete y lo que la base permite.
--
-- (1) BORRAR UN TABLERO FALLA EN CUANTO TIENE DATOS
--     El modal de "Borrar proyecto" dice, literalmente: "Se eliminarán para
--     siempre todas sus tareas, indicadores, OKRs, sprints, plantillas de
--     campos, historial y miembros". Pero seis claves foráneas hacia projects
--     NO tienen ON DELETE CASCADE, así que el DELETE aborta con 23503 en cuanto
--     el tablero tiene una sola tarea o un solo participante — es decir, casi
--     siempre. El usuario escribe "Borrar Proyecto" para confirmar y recibe un
--     mensaje de Postgres en inglés.
--
--     Demostrado contra producción (en transacción revertida):
--       "update or delete on table projects violates foreign key constraint
--        tasks_project_id_fkey on table tasks"
--
--     Las otras quince FK hacia projects ya cascadean; estas seis se quedaron
--     atrás. Se alinean con el resto y con lo que el modal promete.
--
-- (2) LA COLUMNA show_in_presentation NO EXISTE
--     La migración 011 nunca llegó a producción, pero el código sí: el editor
--     de campos personalizados tiene el interruptor "Mostrar en Presentación",
--     lo escribe en task_field_defs, y PresentationCard filtra por él.
--     useTaskFieldDefs tenía un "fallback amable": si el error mencionaba la
--     columna, reintentaba el INSERT sin ella y devolvía éxito. Resultado: el
--     interruptor parecía guardarse, nunca persistía, y ningún campo aparecía
--     jamás en la vista Presentación. Nadie veía un error porque no lo había.
--
--     Es la misma anatomía del bug de invitaciones: un fallo de servidor
--     maquillado de éxito. Aquí se aplica la columna que faltaba; el fallback
--     que lo tapaba se retira en el mismo commit.
--
-- IDEMPOTENTE: se puede correr varias veces sin efecto.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── (1) Las seis FK que faltaban por cascadear ───────────────────────────────
DO $$
DECLARE
  r        RECORD;
  v_nombre TEXT;
  v_n      INT := 0;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY['tasks','participants','indicators','task_types','email_config','app_config']) AS tabla
  LOOP
    -- confdeltype: 'c' = CASCADE, 'a' = NO ACTION (el que tienen ahora).
    SELECT con.conname INTO v_nombre
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    JOIN pg_class ref ON ref.oid = con.confrelid
    WHERE n.nspname = 'public'
      AND rel.relname = r.tabla
      AND ref.relname = 'projects'
      AND con.contype = 'f'
      AND con.confdeltype <> 'c'
    LIMIT 1;

    IF v_nombre IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tabla, v_nombre);
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE',
        r.tabla, v_nombre);
      RAISE NOTICE '%: % -> ON DELETE CASCADE', r.tabla, v_nombre;
      v_n := v_n + 1;
      v_nombre := NULL;
    ELSE
      RAISE NOTICE '%: ya cascadeaba', r.tabla;
    END IF;
  END LOOP;
  RAISE NOTICE '% claves foráneas actualizadas', v_n;
END $$;

-- ── (2) La columna que el código llevaba tiempo intentando escribir ──────────
ALTER TABLE public.task_field_defs
  ADD COLUMN IF NOT EXISTS show_in_presentation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.task_field_defs.show_in_presentation IS
  'Si true, este campo aparece en la tarjeta resumen de la pestaña Presentación.';

COMMIT;

-- ─── Verificación ────────────────────────────────────────────────────────────
--
-- 1) Ninguna FK hacia projects debe quedar sin cascada:
-- SELECT rel.relname, con.conname, con.confdeltype
-- FROM pg_constraint con
-- JOIN pg_class rel ON rel.oid = con.conrelid
-- JOIN pg_class ref ON ref.oid = con.confrelid
-- JOIN pg_namespace n ON n.oid = rel.relnamespace
-- WHERE n.nspname='public' AND ref.relname='projects' AND con.contype='f'
--   AND con.confdeltype <> 'c';
--
-- 2) La columna existe:
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='task_field_defs'
--    AND column_name='show_in_presentation';
--
-- 3) Borrado completo de un tablero: scripts/smoke-borrado-tablero.sql
