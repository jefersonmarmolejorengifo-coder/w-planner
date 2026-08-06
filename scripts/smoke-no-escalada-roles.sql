-- ─────────────────────────────────────────────────────────────────────────────
-- PRUEBA DE HUMO — nadie puede cambiar roles sin ser el dueño del tablero.
--
-- Nace de una vulnerabilidad real (2026-08-06): set_project_member_role() es
-- SECURITY DEFINER y su única defensa era `IF v_owner != auth.uid()`. Sin
-- sesión, auth.uid() es NULL, `!=` devuelve NULL, y en PL/pgSQL `IF NULL THEN`
-- no entra: la comprobación no bloqueaba nada. Con EXECUTE para anon y PUBLIC,
-- cualquiera podía concederse rol de PO o Scrum Master en cualquier tablero
-- repitiendo la llamada de la app sin la cabecera Authorization.
--
-- Comprueba tres caminos de ataque y uno legítimo:
--   A) anónimo sin sesión            → debe ser RECHAZADO
--   B) autenticado que no es dueño   → debe ser RECHAZADO
--   C) miembro inexistente           → debe ser RECHAZADO (antes daba éxito mudo)
--   D) el dueño de verdad            → debe FUNCIONAR
--
-- Todo en una transacción que termina en ROLLBACK: no cambia ningún rol.
--
-- USO
--   $env:DB_URL = [Environment]::GetEnvironmentVariable("WPLANNER_DB_URL","User")
--   node C:\Users\jefer\tools\sqlrunner\run-sql.mjs scripts\smoke-no-escalada-roles.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_pid BIGINT; v_uid UUID; v_owner UUID;
BEGIN
  SELECT m.project_id, m.user_id, p.owner_id INTO v_pid, v_uid, v_owner
  FROM public.project_members m
  JOIN public.projects p ON p.id = m.project_id
  WHERE m.user_id IS NOT NULL AND p.owner_id IS NOT NULL
  LIMIT 1;

  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'Hace falta al menos un tablero con dueño y un miembro vinculado.';
  END IF;

  PERFORM set_config('smoke.pid', v_pid::text, true);
  PERFORM set_config('smoke.uid', v_uid::text, true);
  PERFORM set_config('smoke.owner', v_owner::text, true);
  PERFORM set_config('smoke.rol_previo',
    (SELECT role FROM public.project_members WHERE project_id = v_pid AND user_id = v_uid), true);
  RAISE NOTICE 'Tablero de prueba: % (rol actual del miembro: %)', v_pid, current_setting('smoke.rol_previo');
END $$;

-- ── A) Un anónimo sin sesión ─────────────────────────────────────────────────
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM public.set_project_member_role(
    current_setting('smoke.pid')::bigint, current_setting('smoke.uid')::uuid, 'scrum_master');
  RAISE EXCEPTION 'FUGA: un anónimo sin sesión pudo cambiar el rol.';
EXCEPTION
  WHEN insufficient_privilege OR invalid_authorization_specification THEN
    RAISE NOTICE '✔ A) el anónimo sin sesión es rechazado';
END $$;
RESET ROLE;

-- ── B) Un autenticado que no es el dueño ─────────────────────────────────────
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000d1a93',
                      'email', 'smoke-intruso@example.invalid',
                      'role', 'authenticated')::text, true);
  PERFORM public.set_project_member_role(
    current_setting('smoke.pid')::bigint, current_setting('smoke.uid')::uuid, 'scrum_master');
  RAISE EXCEPTION 'FUGA: un usuario que no es dueño pudo cambiar el rol.';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE '✔ B) el autenticado que no es dueño es rechazado';
END $$;
RESET ROLE;

-- ── C) y D) Como el dueño de verdad ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_rol TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('smoke.owner'),
                      'email', 'smoke-owner@example.invalid',
                      'role', 'authenticated')::text, true);

  -- C) miembro que no existe: antes devolvía éxito sin tocar nada.
  BEGIN
    PERFORM public.set_project_member_role(
      current_setting('smoke.pid')::bigint, '00000000-0000-4000-8000-00000000dead'::uuid, 'po');
    RAISE EXCEPTION 'FALLO: cambiar el rol de un miembro inexistente devolvió éxito.';
  EXCEPTION WHEN no_data_found OR sqlstate 'P0002' THEN
    RAISE NOTICE '✔ C) asignar rol a un miembro inexistente falla en vez de mentir';
  END;

  -- D) el camino legítimo tiene que seguir funcionando.
  PERFORM public.set_project_member_role(
    current_setting('smoke.pid')::bigint, current_setting('smoke.uid')::uuid, 'scrum_master');
  SELECT role INTO v_rol FROM public.project_members
   WHERE project_id = current_setting('smoke.pid')::bigint
     AND user_id = current_setting('smoke.uid')::uuid;
  IF v_rol <> 'scrum_master' THEN
    RAISE EXCEPTION 'ROTO: el dueño no pudo asignar el rol (quedó en %)', v_rol;
  END IF;
  RAISE NOTICE '✔ D) el dueño sí puede asignar roles';

  RAISE NOTICE 'PRUEBA DE HUMO SUPERADA — la asignación de roles está protegida.';
END $$;
RESET ROLE;

ROLLBACK;
