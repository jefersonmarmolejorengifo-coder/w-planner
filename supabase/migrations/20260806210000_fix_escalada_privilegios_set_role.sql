-- ─────────────────────────────────────────────────────────────────────────────
-- SEGURIDAD CRÍTICA — Escalada de privilegios sin sesión en
-- set_project_member_role(), y familia de RPC ejecutables por anónimos.
--
-- HALLAZGO 1 (CRÍTICO, demostrado en producción el 2026-08-06)
--   set_project_member_role() es SECURITY DEFINER (corre como postgres, salta
--   RLS) y su ÚNICA defensa era:
--       IF v_owner != auth.uid() THEN RAISE EXCEPTION 'Solo el owner...'
--   Sin sesión, auth.uid() es NULL, así que `v_owner != NULL` evalúa a NULL, y
--   en PL/pgSQL `IF NULL THEN` NO entra: la excepción nunca se lanzaba y el
--   UPDATE seguía adelante con privilegios de postgres.
--   Como además tenía EXECUTE para `anon` Y para PUBLIC, bastaba repetir la
--   llamada que ya hace la app QUITANDO la cabecera Authorization, usando solo
--   la anon key que viaja pública dentro del bundle de JavaScript.
--
--   Prueba ejecutada contra producción (en transacción revertida):
--     rol ANTES = po → llamada como `anon` sin JWT → NO fue rechazada →
--     rol DESPUÉS = scrum_master, y el onboarding de la víctima reseteado a 0.
--
--   Cualquiera en internet podía concederse (o quitarle a otro) el rol de PO o
--   Scrum Master en cualquier tablero: los project_id son enteros correlativos
--   y el user_id de un compañero es visible para cualquier miembro.
--
-- HALLAZGO 2 (ALTO)
--   Otras nueve RPC SECURITY DEFINER de solo lectura aceptan el identificador
--   de la víctima como parámetro, no comprueban quién pregunta, y son
--   ejecutables por PUBLIC (y varias también por anon). Permiten leer sin
--   sesión el plan y estado de suscripción de cualquier usuario, y enumerar
--   tablero por tablero si tienen IA, su cuota de chat consumida y su último
--   evolutivo. Aquí se cierra el acceso anónimo; la comprobación de pertenencia
--   dentro de cada función queda pendiente (requiere revisar cada llamador).
--
--   Causa sistémica: `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON FUNCTIONS TO
--   anon`, que hace que cada función nueva nazca abierta sin que nadie escriba
--   un GRANT. Se revierte al final.
--
-- IDEMPOTENTE: se puede correr varias veces sin efecto.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. La función, con la autorización bien planteada ────────────────────────
CREATE OR REPLACE FUNCTION "public"."set_project_member_role"(
  "p_project_id" bigint, "p_member_user_id" "uuid", "p_role" "text")
RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_owner UUID;
  v_filas INT;
BEGIN
  -- Sin esta guarda, todo lo de abajo corría para peticiones sin sesión.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT owner_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Proyecto no encontrado' USING ERRCODE = '02000';
  END IF;

  -- IS DISTINCT FROM en vez de !=: con NULL a un lado, `!=` da NULL y el IF no
  -- entra. IS DISTINCT FROM devuelve TRUE y sí bloquea. Defensa en profundidad
  -- por si la guarda de arriba desapareciera en un refactor.
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solo el owner puede asignar roles' USING ERRCODE = '42501';
  END IF;

  IF p_role NOT IN ('po', 'scrum_master', 'participant') THEN
    RAISE EXCEPTION 'Rol invalido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.project_members
  SET role = p_role
  WHERE project_id = p_project_id AND user_id = p_member_user_id;

  -- Antes no se miraba cuántas filas cambiaron: si p_member_user_id era NULL o
  -- no pertenecía al tablero, la función devolvía éxito sin haber hecho nada y
  -- la interfaz pintaba el rol nuevo. project_members.user_id es nullable (hay
  -- "invitados pendientes" sin vincular), así que el caso es real.
  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas = 0 THEN
    RAISE EXCEPTION 'Ese miembro no existe en el tablero' USING ERRCODE = 'P0002';
  END IF;

  -- Resetea el tour para que la persona vea el de su rol nuevo. Acotado a que
  -- sea miembro DE ESTE tablero: antes escribía sobre la fila de cualquier uuid
  -- que se le pasara, saltando RLS por ser SECURITY DEFINER.
  UPDATE public.user_onboarding
  SET current_step = 0, completed_at = NULL, skipped = FALSE
  WHERE user_id = p_member_user_id
    AND EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = p_project_id AND m.user_id = p_member_user_id
    );
END;
$$;

ALTER FUNCTION "public"."set_project_member_role"(bigint, "uuid", "text") OWNER TO "postgres";

-- ── 2. Fuera el acceso anónimo a las RPC sensibles ───────────────────────────
-- Las diez conservan su GRANT explícito a `authenticated` y `service_role`, que
-- es por donde entra la app. Se quita PUBLIC (el `=X/postgres` de la ACL) y anon.
DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'set_project_member_role(bigint, uuid, text)',
    'user_ia_capacity(uuid)',
    'sprint_retro_pending_for_user(uuid)',
    'participant_days_active(bigint, text)',
    'can_generate_evolution(bigint)',
    'project_has_feature(bigint, text)',
    'project_can_use_chat(bigint)',
    'project_can_use_evolutivo(bigint)',
    'user_can_use_ia_on_project(bigint)',
    'project_chat_quota_remaining(bigint)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', v_fn);
    RAISE NOTICE 'cerrada al anónimo: %', v_fn;
  END LOOP;
END $$;

-- ── 3. Que las funciones nuevas no nazcan abiertas ───────────────────────────
-- Este default es la causa de fondo: sin él, nadie tuvo que escribir un GRANT
-- para que estas funciones quedaran accesibles a `anon`.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;

COMMIT;

-- ─── Verificación (correr después de aplicar) ────────────────────────────────
--
-- 1) Ninguna de las diez debe listar `anon=X` ni el `=X` inicial de PUBLIC:
--
-- SELECT p.proname, array_to_string(p.proacl::text[], ' ') AS acl
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname IN
--   ('set_project_member_role','user_ia_capacity','sprint_retro_pending_for_user',
--    'participant_days_active','can_generate_evolution','project_has_feature',
--    'project_can_use_chat','project_can_use_evolutivo','user_can_use_ia_on_project',
--    'project_chat_quota_remaining');
--
-- 2) La prueba de escalada debe ser RECHAZADA con 28000:
--    scripts/smoke-no-escalada-roles.sql
