-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA DE HUMO — las RPC de solo lectura comprueban quién pregunta.
--
-- Estas funciones son SECURITY DEFINER: corren como postgres y saltan la RLS.
-- Hasta el 2026-08-06 aceptaban el identificador de la víctima como parámetro
-- sin comprobar nada, así que un usuario con cuenta podía leer el plan de otra
-- persona y enumerar los tableros de la plataforma por su id correlativo.
--
-- Verifica las TRES identidades que importan, porque cerrar de más rompe tanto
-- como cerrar de menos:
--   A) un autenticado SIN relación con el tablero  → denegado
--   B) un miembro legítimo                          → funciona
--   C) service_role (cron y generadores de informes) → funciona
--
-- Sin (C) el arreglo habría dejado al cron sin ver las features de pago, en
-- silencio: api/cron.js y api/generate-evolution.js llaman a estas funciones
-- con la clave service_role, donde auth.uid() es NULL.
--
-- Todo en una transacción que termina en ROLLBACK.
--
-- USO
--   $env:DB_URL = [Environment]::GetEnvironmentVariable("WPLANNER_DB_URL","User")
--   node C:\Users\jefer\tools\sqlrunner\run-sql.mjs scripts\smoke-rpc-autorizacion.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_pid BIGINT; v_owner UUID;
BEGIN
  SELECT p.id, p.owner_id INTO v_pid, v_owner
  FROM public.projects p
  WHERE p.owner_id IS NOT NULL
  ORDER BY p.id DESC LIMIT 1;

  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'Hace falta al menos un tablero con dueño.';
  END IF;

  PERFORM set_config('smoke.pid', v_pid::text, true);
  PERFORM set_config('smoke.owner', v_owner::text, true);
  RAISE NOTICE 'Tablero de prueba: %  (dueño conocido)', v_pid;
END $$;

-- ── A) Un autenticado que no pinta nada en ese tablero ───────────────────────
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_pid   BIGINT := current_setting('smoke.pid')::bigint;
  v_owner UUID   := current_setting('smoke.owner')::uuid;
  v_filas INT;
  v_bool  BOOLEAN;
  v_int   INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000d1a94',
                      'email', 'smoke-curioso@example.invalid',
                      'role', 'authenticated')::text, true);

  -- El plan de OTRA persona no se puede consultar.
  SELECT count(*) INTO v_filas FROM public.user_ia_capacity(v_owner);
  IF v_filas <> 0 THEN
    RAISE EXCEPTION 'FUGA: pudo leer el plan y la suscripción de otro usuario (% filas)', v_filas;
  END IF;
  RAISE NOTICE '✔ A1) no puede leer el plan de otro usuario';

  -- Los flags de un tablero ajeno tampoco.
  v_bool := public.project_has_feature(v_pid, 'chat');
  IF v_bool IS NOT FALSE THEN
    RAISE EXCEPTION 'FUGA: project_has_feature respondió % sobre un tablero ajeno', v_bool;
  END IF;
  v_bool := public.user_can_use_ia_on_project(v_pid);
  IF v_bool IS NOT FALSE THEN
    RAISE EXCEPTION 'FUGA: user_can_use_ia_on_project respondió % sobre un tablero ajeno', v_bool;
  END IF;
  RAISE NOTICE '✔ A2) no puede consultar las features de un tablero ajeno';

  SELECT count(*) INTO v_filas FROM public.can_generate_evolution(v_pid);
  IF v_filas <> 0 THEN
    RAISE EXCEPTION 'FUGA: pudo consultar el estado del evolutivo de un tablero ajeno';
  END IF;

  v_int := public.participant_days_active(v_pid, 'cualquiera');
  IF v_int <> 0 THEN
    RAISE EXCEPTION 'FUGA: pudo medir la actividad de un tablero ajeno (%)', v_int;
  END IF;
  RAISE NOTICE '✔ A3) no puede ver evolutivo ni actividad ajena';

  BEGIN
    PERFORM public.project_chat_quota_remaining(v_pid);
    RAISE EXCEPTION 'FUGA: pudo consultar la cuota de chat de un tablero ajeno';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '✔ A4) la cuota de chat ajena se deniega explícitamente';
  END;
END $$;
RESET ROLE;

-- ── B) El dueño, que sí es miembro ───────────────────────────────────────────
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_pid   BIGINT := current_setting('smoke.pid')::bigint;
  v_owner UUID   := current_setting('smoke.owner')::uuid;
  v_filas INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'email', 'smoke-owner@example.invalid',
                      'role', 'authenticated')::text, true);

  SELECT count(*) INTO v_filas FROM public.user_ia_capacity();
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'ROTO: el usuario no puede consultar su PROPIO plan (% filas)', v_filas;
  END IF;

  SELECT count(*) INTO v_filas FROM public.can_generate_evolution(v_pid);
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'ROTO: el dueño no puede consultar el evolutivo de su tablero';
  END IF;

  PERFORM public.project_has_feature(v_pid, 'chat');
  PERFORM public.user_can_use_ia_on_project(v_pid);
  PERFORM public.project_chat_quota_remaining(v_pid);
  PERFORM public.sprint_retro_pending_for_user();
  RAISE NOTICE '✔ B) el dueño consulta su plan y su tablero con normalidad';
END $$;
RESET ROLE;

-- ── C) service_role: el cron y los generadores de informes ───────────────────
SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_pid   BIGINT := current_setting('smoke.pid')::bigint;
  v_owner UUID   := current_setting('smoke.owner')::uuid;
  v_filas INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);

  IF NOT public.caller_is_service_role() THEN
    RAISE EXCEPTION 'ROTO: no se reconoce a service_role; el cron quedaría fuera';
  END IF;

  -- Lo que hace api/cron.js:477 y api/generate-evolution.js.
  PERFORM public.project_has_feature(v_pid, 'team_pulse');
  PERFORM public.project_can_use_evolutivo(v_pid);
  PERFORM public.participant_days_active(v_pid, 'cualquiera');

  SELECT count(*) INTO v_filas FROM public.can_generate_evolution(v_pid);
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'ROTO: service_role no puede consultar can_generate_evolution (% filas)', v_filas;
  END IF;

  SELECT count(*) INTO v_filas FROM public.user_ia_capacity(v_owner);
  IF v_filas <> 1 THEN
    RAISE EXCEPTION 'ROTO: service_role no puede consultar el plan de un usuario';
  END IF;

  RAISE NOTICE '✔ C) service_role (cron e informes) sigue pasando';
  RAISE NOTICE 'PRUEBA DE HUMO SUPERADA — las RPC comprueban quién pregunta.';
END $$;
RESET ROLE;

ROLLBACK;
