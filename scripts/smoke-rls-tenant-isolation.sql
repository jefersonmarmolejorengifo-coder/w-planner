-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA DE HUMO — aislamiento multi-tenant de la RLS.
--
-- Verifica las dos mitades del problema, que es donde suelen fallar los
-- arreglos de RLS: se cierra tanto que se rompe la app, o se deja una rendija.
--
--   A) NADIE DE FUERA ENTRA: el rol `anon` (la anon key viaja pública en el
--      bundle de la app) no puede leer ni una fila de ninguna tabla de negocio.
--   B) LOS DE DENTRO TRABAJAN: un miembro real ve los datos de SU tablero, no
--      ve los de otro tablero, y puede mantener su propia ficha de participante.
--
-- Todo corre en una transacción que termina en ROLLBACK: no modifica nada y se
-- puede ejecutar contra producción cuando quieras.
--
-- USO
--   $env:DB_URL = [Environment]::GetEnvironmentVariable("WPLANNER_DB_URL","User")
--   node C:\Users\jefer\tools\sqlrunner\run-sql.mjs scripts\smoke-rls-tenant-isolation.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Necesitamos dos tableros distintos y con dueños distintos para probar el
-- aislamiento de verdad.
DO $$
DECLARE
  v_a BIGINT;
  v_b BIGINT;
BEGIN
  SELECT id INTO v_a FROM public.projects WHERE owner_id IS NOT NULL ORDER BY id DESC LIMIT 1;
  SELECT id INTO v_b FROM public.projects WHERE owner_id IS NOT NULL AND id <> v_a ORDER BY id DESC LIMIT 1;
  IF v_a IS NULL OR v_b IS NULL THEN
    RAISE EXCEPTION 'Hacen falta al menos 2 proyectos con dueño para probar el aislamiento.';
  END IF;
  PERFORM set_config('smoke.a', v_a::text, true);
  PERFORM set_config('smoke.b', v_b::text, true);
  PERFORM set_config('smoke.code_a', (SELECT invite_code FROM public.projects WHERE id = v_a), true);
  RAISE NOTICE 'Tableros de prueba: A=% (al que me uno)  B=% (el ajeno)', v_a, v_b;
END $$;

-- ── A) El anónimo no ve nada ─────────────────────────────────────────────────
SET LOCAL ROLE anon;
DO $$
DECLARE
  r        RECORD;
  v_count  BIGINT;
  v_leaks  TEXT := '';
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO v_count;
      IF v_count > 0 THEN
        v_leaks := v_leaks || format('%s%s: %s filas', chr(10), r.relname, v_count);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL; -- sin GRANT para anon: es exactamente lo que queremos
    END;
  END LOOP;

  IF v_leaks <> '' THEN
    RAISE EXCEPTION 'FUGA ANÓNIMA: estas tablas son legibles sin iniciar sesión: %', v_leaks;
  END IF;
  RAISE NOTICE '✔ A) el rol anónimo no puede leer ninguna tabla de negocio';
END $$;
RESET ROLE;

-- ── A bis) Segundo cerrojo: anon no debe tener ni un GRANT ───────────────────
-- Que la RLS lo tape hoy no basta. Con el GRANT puesto, una sola policy futura
-- mal escrita reabre la puerta entera; sin el GRANT, esa policy no sirve de
-- nada. Es la condición que permitió la fuga del 2026-08-06.
DO $$
DECLARE
  v_tablas TEXT;
BEGIN
  SELECT string_agg(DISTINCT table_name, ', ' ORDER BY table_name) INTO v_tablas
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public' AND grantee = 'anon';

  IF v_tablas IS NOT NULL THEN
    RAISE EXCEPTION 'anon ha recuperado privilegios de tabla sobre: %', v_tablas;
  END IF;
  RAISE NOTICE '✔ A bis) anon no tiene ningún privilegio de tabla';
END $$;

-- ── B) Un miembro legítimo sigue pudiendo trabajar ───────────────────────────
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_a      BIGINT := current_setting('smoke.a')::bigint;
  v_b      BIGINT := current_setting('smoke.b')::bigint;
  v_uid    UUID   := '00000000-0000-4000-8000-0000000d1a92';
  v_count  BIGINT;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid, 'email', 'smoke-miembro@example.invalid', 'role', 'authenticated')::text,
    true
  );

  -- Antes de unirse no debe ver el tablero A.
  SELECT count(*) INTO v_count FROM public.projects WHERE id = v_a;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FUGA: un usuario sin membresía ya veía el tablero %', v_a;
  END IF;
  RAISE NOTICE '✔ B1) un autenticado sin membresía no ve el tablero ajeno';

  -- Se une con el código de invitación.
  PERFORM public.join_project_by_invite_code(current_setting('smoke.code_a'));

  -- Ahora sí ve A…
  SELECT count(*) INTO v_count FROM public.projects WHERE id = v_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ROTO: tras unirse sigue sin ver el tablero %', v_a;
  END IF;
  RAISE NOTICE '✔ B2) tras unirse ve su tablero';

  -- …pero sigue sin ver B.
  SELECT count(*) INTO v_count FROM public.projects WHERE id = v_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FUGA: ser miembro de % le dejó ver el tablero ajeno %', v_a, v_b;
  END IF;
  SELECT count(*) INTO v_count FROM public.tasks WHERE project_id = v_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FUGA: puede leer % tareas del tablero ajeno %', v_count, v_b;
  END IF;
  RAISE NOTICE '✔ B3) no ve el tablero ajeno ni sus tareas';

  -- Puede leer las tareas de SU tablero (sin esto la app no muestra nada).
  PERFORM count(*) FROM public.tasks WHERE project_id = v_a;
  RAISE NOTICE '✔ B4) puede leer las tareas de su tablero';

  -- Puede mantener su propia ficha de participante (useProjectData la crea al
  -- abrir el tablero si no existe).
  UPDATE public.participants
     SET name = 'Nombre actualizado'
   WHERE project_id = v_a AND auth_user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROTO: el miembro no pudo actualizar su propia ficha de participante';
  END IF;
  RAISE NOTICE '✔ B5) puede mantener su propia ficha de participante';

  -- Pero NO puede tocar la ficha de otra persona.
  BEGIN
    UPDATE public.participants
       SET name = 'secuestrada'
     WHERE project_id = v_a AND (auth_user_id IS NULL OR auth_user_id <> v_uid);
    IF FOUND THEN
      RAISE EXCEPTION 'FUGA: pudo modificar la ficha de otro participante';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE '✔ B6) no puede modificar la ficha de otros';

  RAISE NOTICE 'PRUEBA DE HUMO SUPERADA — aislamiento correcto y app funcional.';
END $$;
RESET ROLE;

ROLLBACK;
