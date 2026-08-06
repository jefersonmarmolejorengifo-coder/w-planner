-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA DE HUMO — flujo completo de invitación, sin efectos secundarios.
--
-- Simula a un invitado nuevo que estrena el código de un tablero real y
-- comprueba, de punta a punta, que:
--   1. el RPC join_project_by_invite_code() devuelve el proyecto,
--   2. queda dado de alta en project_members,
--   3. queda creada su ficha en participants (aquí es donde reventaba: la
--      columna participants.id no tenía DEFAULT y el INSERT tiraba 23502,
--      abortando la invitación entera),
--   4. la RLS ya le deja LEER el proyecto (que es lo que la app necesita para
--      abrir el tablero).
--
-- Todo corre dentro de una transacción que termina en ROLLBACK: no crea
-- miembros, no toca datos y se puede ejecutar contra producción cuando quieras.
--
-- USO
--   $env:DB_URL = [Environment]::GetEnvironmentVariable("WPLANNER_DB_URL","User")
--   node C:\Users\jefer\tools\sqlrunner\run-sql.mjs scripts\smoke-join-invite.sql
--
-- Si algo falla, el script aborta con un RAISE EXCEPTION que explica qué paso
-- se rompió. Si pasa, imprime los NOTICE de cada verificación.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Elegimos el tablero más reciente que tenga código de invitación. Se lee como
-- superusuario y se guarda en una variable de sesión para NO imprimir nunca el
-- código (es una credencial: quien lo tiene, entra al tablero).
DO $$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT id INTO v_id
  FROM public.projects
  WHERE invite_code IS NOT NULL
  ORDER BY id DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No hay ningún proyecto con invite_code: no se puede probar el flujo.';
  END IF;

  PERFORM set_config('smoke.project_id', v_id::text, true);
  PERFORM set_config('smoke.code', (SELECT invite_code FROM public.projects WHERE id = v_id), true);
  RAISE NOTICE 'Tablero de prueba: id=%', v_id;
END $$;

-- A partir de aquí somos un invitado cualquiera: mismo rol que usa la app
-- (authenticated) y un usuario que no es miembro de nada.
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_pid    BIGINT := current_setting('smoke.project_id')::bigint;
  v_uid    UUID   := '00000000-0000-4000-8000-0000000d1a91';
  v_email  TEXT   := 'smoke-invitado@example.invalid';
  v_proj   public.projects;
  v_count  BIGINT;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid, 'email', v_email, 'role', 'authenticated')::text,
    true
  );

  -- (1) El RPC tiene que devolver el proyecto correcto.
  v_proj := public.join_project_by_invite_code(current_setting('smoke.code'));
  IF v_proj.id IS DISTINCT FROM v_pid THEN
    RAISE EXCEPTION 'PASO 1 FALLÓ: el RPC devolvió el proyecto % y se esperaba %', v_proj.id, v_pid;
  END IF;
  RAISE NOTICE '✔ 1/4 el RPC devolvió el proyecto "%"', v_proj.name;

  -- (2) Alta en project_members.
  SELECT count(*) INTO v_count
  FROM public.project_members
  WHERE project_id = v_pid AND user_id = v_uid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PASO 2 FALLÓ: se esperaba 1 fila en project_members y hay %', v_count;
  END IF;
  RAISE NOTICE '✔ 2/4 alta en project_members';

  -- (3) Ficha en participants. Este es el paso que rompía las invitaciones.
  SELECT count(*) INTO v_count
  FROM public.participants
  WHERE project_id = v_pid AND auth_user_id = v_uid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PASO 3 FALLÓ: se esperaba 1 ficha en participants y hay %', v_count;
  END IF;
  RAISE NOTICE '✔ 3/4 ficha creada en participants';

  -- (4) La RLS ya le permite leer el tablero: sin esto la app no lo abre.
  SELECT count(*) INTO v_count FROM public.projects WHERE id = v_pid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PASO 4 FALLÓ: la RLS sigue ocultando el proyecto al invitado';
  END IF;
  RAISE NOTICE '✔ 4/4 la RLS ya deja al invitado leer el tablero';

  -- (extra) Reintentar la invitación tiene que ser inocuo (idempotencia).
  PERFORM public.join_project_by_invite_code(current_setting('smoke.code'));
  SELECT count(*) INTO v_count
  FROM public.participants
  WHERE project_id = v_pid AND auth_user_id = v_uid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'IDEMPOTENCIA FALLÓ: reusar el código duplicó la ficha (% filas)', v_count;
  END IF;
  RAISE NOTICE '✔ extra: reusar el mismo código no duplica nada';

  RAISE NOTICE 'PRUEBA DE HUMO SUPERADA — el flujo de invitación funciona.';
END $$;

RESET ROLE;

ROLLBACK;
