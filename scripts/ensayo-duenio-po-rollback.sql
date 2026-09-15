-- ─────────────────────────────────────────────────────────────────────────────
-- ENSAYO CON ROLLBACK — supabase/migrations/20260915120000_duenio_nace_po_y_tours_por_rol.sql
--
-- NO aplica nada de verdad: todo corre en una única transacción que termina en
-- ROLLBACK. Compara el comportamiento ANTES (código tal cual producción) y
-- DESPUÉS (con la migración aplicada dentro de esta misma transacción) de:
--
--   a) create_project_secure()   → el creador debe quedar 'po'
--   b) camino "crear desde plantilla" (insert directo + upsert sin role)
--                                 → el dueño debe quedar 'po'
--   c) invitado (no dueño) insertado sin rol por el dueño
--                                 → debe quedar 'participant' (el trigger no eleva)
--   d) el dueño se cambia a sí mismo con set_project_member_role()
--                                 → debe quedar 'scrum_master' (el trigger no
--                                    interfiere: solo actúa en INSERT)
--   e) conteos por rol de los miembros YA EXISTENTES en producción, iguales
--      antes y después de aplicar la migración (sin backfill)
--   f) user_onboarding.completed_roles nace con default '{}', sin backfill
--
-- Usuarios de prueba: gen_random_uuid() generados DENTRO de esta transacción
-- (nunca existieron antes, 0 proyectos), para no depender de una cuenta real
-- cercana al límite de tableros del plan free.
--
-- USO
--   $env:DB_URL = [Environment]::GetEnvironmentVariable("WPLANNER_DB_URL","User")
--   node C:\Users\jefer\tools\sqlrunner\run-sql.mjs scripts\ensayo-duenio-po-rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 0. Setup: snapshot inicial + identidades de prueba ───────────────────────
DO $$
DECLARE
  v_snap jsonb;
BEGIN
  SELECT jsonb_object_agg(role, cnt) INTO v_snap
  FROM (SELECT role, count(*) AS cnt FROM public.project_members GROUP BY role) s;
  RAISE NOTICE 'Snapshot inicial de roles (producción, sin tocar nada): %', COALESCE(v_snap, '{}'::jsonb);

  PERFORM set_config('smoke.uid_a1', gen_random_uuid()::text, true);    -- dueño, SIN migración, caso a
  PERFORM set_config('smoke.uid_b1', gen_random_uuid()::text, true);    -- dueño, SIN migración, caso b
  PERFORM set_config('smoke.uid_a2', gen_random_uuid()::text, true);    -- dueño, CON migración, casos a y d
  PERFORM set_config('smoke.uid_b2', gen_random_uuid()::text, true);    -- dueño, CON migración, caso b
  PERFORM set_config('smoke.uid_guest', gen_random_uuid()::text, true); -- invitado, CON migración, caso c
END $$;

-- ════════════════════ BLOQUE 1 — SIN LA MIGRACIÓN (código de producción) ═════════════════════

-- 1a) create_project_secure() con el código viejo → debe quedar 'participant'
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_proj public.projects; v_rol text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('smoke.uid_a1'), 'email', 'smoke-a1@example.invalid', 'role', 'authenticated')::text, true);

  -- Asignación directa (v_proj := func()), NO "SELECT func() INTO v_proj":
  -- con un target de tipo fila con nombre (no RECORD genérico), SELECT INTO
  -- intenta encajar el composite devuelto campo por campo en vez de asignarlo
  -- entero, y revienta castenado el texto de toda la fila al tipo del primer
  -- campo (bigint id) -- confirmado en un diagnóstico aislado (pg_temp,
  -- ROLLBACK, sin tocar ninguna tabla de la app).
  v_proj := public.create_project_secure('Ensayo SIN migración - RPC', '', '{}'::jsonb);

  SELECT role INTO v_rol FROM public.project_members
   WHERE project_id = v_proj.id AND user_id = current_setting('smoke.uid_a1')::uuid;

  IF v_rol IS DISTINCT FROM 'participant' THEN
    RAISE EXCEPTION 'INESPERADO (1a, sin migración): el rol del dueño quedó ''%'' y se esperaba ''participant''.', v_rol;
  END IF;
  RAISE NOTICE E'\u2714 1a) SIN migración -- create_project_secure() deja al dueño en participant (bug confirmado)';
END $$;
RESET ROLE;

-- 1b) camino plantilla con el código viejo (sin trigger) → debe quedar 'participant'
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_pid bigint; v_rol text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('smoke.uid_b1'), 'email', 'smoke-b1@example.invalid', 'role', 'authenticated')::text, true);

  -- Sin RETURNING: en este arnés (RLS + SET LOCAL ROLE dentro de un DO block),
  -- un INSERT con RETURNING sobre una tabla cuya política SELECT se
  -- autorreferencia (is_project_owner() vuelve a consultar projects) dispara
  -- "new row violates row-level security policy" aunque el WITH CHECK del
  -- INSERT ya se cumple (confirmado con diagnóstico: auth.uid() = owner_id
  -- exactos). No se reproduce vía PostgREST en producción real. lastval() evita
  -- depender de RETURNING para este ensayo.
  INSERT INTO public.projects (name, description, config, owner_id)
  VALUES ('Ensayo SIN migración - plantilla', '', '{}'::jsonb, current_setting('smoke.uid_b1')::uuid);
  SELECT lastval() INTO v_pid;

  INSERT INTO public.project_members (project_id, email, name, user_id)
  VALUES (v_pid, 'smoke-b1@example.invalid', 'Smoke B1', current_setting('smoke.uid_b1')::uuid)
  ON CONFLICT (project_id, email) DO UPDATE SET user_id = EXCLUDED.user_id;

  SELECT role INTO v_rol FROM public.project_members
   WHERE project_id = v_pid AND user_id = current_setting('smoke.uid_b1')::uuid;

  IF v_rol IS DISTINCT FROM 'participant' THEN
    RAISE EXCEPTION 'INESPERADO (1b, sin migración): el rol del dueño quedó ''%'' y se esperaba ''participant''.', v_rol;
  END IF;
  RAISE NOTICE E'\u2714 1b) SIN migración -- camino plantilla deja al dueño en participant (bug confirmado)';
END $$;
RESET ROLE;

-- Snapshot justo ANTES de aplicar la migración (ya incluye las filas de 1a/1b)
DO $$
DECLARE v_snap jsonb;
BEGIN
  SELECT jsonb_object_agg(role, cnt) INTO v_snap
  FROM (SELECT role, count(*) AS cnt FROM public.project_members GROUP BY role) s;
  PERFORM set_config('smoke.snap_pre_migracion', v_snap::text, true);
  RAISE NOTICE 'Snapshot antes de aplicar la migración (incluye datos de prueba 1a/1b): %', v_snap;
END $$;

-- ════════════════════ APLICA LA MIGRACIÓN ═══════════════════════════════════
-- Mismo cuerpo que supabase/migrations/20260915120000_duenio_nace_po_y_tours_por_rol.sql
-- (sin su propio BEGIN/COMMIT: corre dentro de la transacción de este ensayo).

-- ── 1. create_project_secure(): el creador nace 'po' ─────────────────────────
CREATE OR REPLACE FUNCTION public.create_project_secure(p_name text, p_description text, p_config jsonb)
 RETURNS public.projects
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid        UUID := auth.uid();
  user_email TEXT := auth.email();
  full_name  TEXT;
  new_proj   projects;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required (auth.uid is NULL)'
      USING ERRCODE = '28000';
  END IF;

  full_name := COALESCE(
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    user_email,
    ''
  );

  INSERT INTO projects (name, description, config, owner_id)
  VALUES (
    TRIM(COALESCE(p_name, '')),
    TRIM(COALESCE(p_description, '')),
    COALESCE(p_config, '{}'::jsonb),
    uid
  )
  RETURNING * INTO new_proj;

  INSERT INTO project_members (project_id, email, name, user_id, role)
  VALUES (new_proj.id, user_email, full_name, uid, 'po')
  ON CONFLICT (project_id, email)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    name    = COALESCE(NULLIF(EXCLUDED.name, ''), project_members.name);

  RETURN new_proj;
END;
$function$;

-- ── 2. Trigger de defensa en profundidad en project_members ──────────────────
CREATE OR REPLACE FUNCTION public.enforce_owner_role_on_member_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id UUID;
BEGIN
  IF NEW.user_id IS NOT NULL THEN
    SELECT owner_id INTO v_owner_id FROM public.projects WHERE id = NEW.project_id;
    IF v_owner_id IS NOT NULL AND v_owner_id = NEW.user_id THEN
      NEW.role := 'po';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE TRIGGER project_members_enforce_owner_role
  BEFORE INSERT ON public.project_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_owner_role_on_member_insert();

REVOKE ALL ON FUNCTION public.enforce_owner_role_on_member_insert() FROM PUBLIC, anon, authenticated;

-- ── 3. user_onboarding.completed_roles: tours por rol ─────────────────────────
ALTER TABLE public.user_onboarding
  ADD COLUMN IF NOT EXISTS completed_roles text[] NOT NULL DEFAULT '{}'::text[];

-- ═══════════════════ FIN DEL CUERPO DE LA MIGRACIÓN ═════════════════════════

-- e) Snapshot justo DESPUÉS de aplicar la migración, ANTES de insertar más datos de prueba
DO $$
DECLARE v_snap jsonb; v_pre jsonb;
BEGIN
  SELECT jsonb_object_agg(role, cnt) INTO v_snap
  FROM (SELECT role, count(*) AS cnt FROM public.project_members GROUP BY role) s;
  v_pre := current_setting('smoke.snap_pre_migracion')::jsonb;

  IF v_snap IS DISTINCT FROM v_pre THEN
    RAISE EXCEPTION 'ROTO (e): aplicar la migración cambió conteos de project_members.role. Antes=% Después=%', v_pre, v_snap;
  END IF;
  RAISE NOTICE E'\u2714 e) aplicar la migración NO tocó ninguna fila existente de project_members (conteos iguales: %)', v_snap;
END $$;

-- ════════════════════ BLOQUE 2 — CON LA MIGRACIÓN APLICADA ══════════════════

-- 2a) create_project_secure() → debe quedar 'po'
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_proj public.projects; v_rol text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('smoke.uid_a2'), 'email', 'smoke-a2@example.invalid', 'role', 'authenticated')::text, true);

  v_proj := public.create_project_secure('Ensayo CON migración - RPC', '', '{}'::jsonb);

  SELECT role INTO v_rol FROM public.project_members
   WHERE project_id = v_proj.id AND user_id = current_setting('smoke.uid_a2')::uuid;

  IF v_rol IS DISTINCT FROM 'po' THEN
    RAISE EXCEPTION 'ROTO (a): con la migración, create_project_secure() dejó al dueño en ''%'' y debía ser ''po''.', v_rol;
  END IF;
  RAISE NOTICE E'\u2714 a) CON migración -- create_project_secure() deja al dueño en po';
  PERFORM set_config('smoke.pid_a2', v_proj.id::text, true);
END $$;
RESET ROLE;

-- 2b) camino plantilla con el trigger activo → debe quedar 'po'
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_pid bigint; v_rol text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('smoke.uid_b2'), 'email', 'smoke-b2@example.invalid', 'role', 'authenticated')::text, true);

  -- Sin RETURNING: en este arnés (RLS + SET LOCAL ROLE dentro de un DO block),
  -- un INSERT con RETURNING sobre una tabla cuya política SELECT se
  -- autorreferencia (is_project_owner() vuelve a consultar projects) dispara
  -- "new row violates row-level security policy" aunque el WITH CHECK del
  -- INSERT ya se cumple (confirmado con diagnóstico: auth.uid() = owner_id
  -- exactos). No se reproduce vía PostgREST en producción real. lastval() evita
  -- depender de RETURNING para este ensayo.
  INSERT INTO public.projects (name, description, config, owner_id)
  VALUES ('Ensayo CON migración - plantilla', '', '{}'::jsonb, current_setting('smoke.uid_b2')::uuid);
  SELECT lastval() INTO v_pid;

  INSERT INTO public.project_members (project_id, email, name, user_id)
  VALUES (v_pid, 'smoke-b2@example.invalid', 'Smoke B2', current_setting('smoke.uid_b2')::uuid)
  ON CONFLICT (project_id, email) DO UPDATE SET user_id = EXCLUDED.user_id;

  SELECT role INTO v_rol FROM public.project_members
   WHERE project_id = v_pid AND user_id = current_setting('smoke.uid_b2')::uuid;

  IF v_rol IS DISTINCT FROM 'po' THEN
    RAISE EXCEPTION 'ROTO (b): con la migración, el camino plantilla dejó al dueño en ''%'' y debía ser ''po''.', v_rol;
  END IF;
  RAISE NOTICE E'\u2714 b) CON migración -- camino plantilla (insert directo + upsert sin role) deja al dueño en po';
  PERFORM set_config('smoke.pid_b2', v_pid::text, true);
END $$;
RESET ROLE;

-- 2c) invitado (no dueño), insertado sin rol por el dueño → debe quedar 'participant'
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_rol text;
BEGIN
  -- Actúa como el dueño B2 invitando al invitado. is_project_owner() exige que
  -- quien INSERTA sea el dueño (política project_members_insert_owner); el
  -- trigger evalúa a QUIÉN se inserta (NEW.user_id), no quién ejecuta.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('smoke.uid_b2'), 'email', 'smoke-b2@example.invalid', 'role', 'authenticated')::text, true);

  INSERT INTO public.project_members (project_id, email, name, user_id)
  VALUES (current_setting('smoke.pid_b2')::bigint, 'smoke-guest@example.invalid', 'Smoke Guest', current_setting('smoke.uid_guest')::uuid);

  SELECT role INTO v_rol FROM public.project_members
   WHERE project_id = current_setting('smoke.pid_b2')::bigint AND user_id = current_setting('smoke.uid_guest')::uuid;

  IF v_rol IS DISTINCT FROM 'participant' THEN
    RAISE EXCEPTION 'FUGA (c): el trigger elevó a un invitado que no es dueño. Rol = ''%''.', v_rol;
  END IF;
  RAISE NOTICE E'\u2714 c) CON migración -- un invitado insertado sin rol queda en participant (el trigger no eleva a quien no es dueño)';
END $$;
RESET ROLE;

-- 2d) el dueño se cambia a sí mismo con set_project_member_role() → debe quedar 'scrum_master'
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_rol text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('smoke.uid_a2'), 'email', 'smoke-a2@example.invalid', 'role', 'authenticated')::text, true);

  PERFORM public.set_project_member_role(
    current_setting('smoke.pid_a2')::bigint, current_setting('smoke.uid_a2')::uuid, 'scrum_master');

  SELECT role INTO v_rol FROM public.project_members
   WHERE project_id = current_setting('smoke.pid_a2')::bigint AND user_id = current_setting('smoke.uid_a2')::uuid;

  IF v_rol IS DISTINCT FROM 'scrum_master' THEN
    RAISE EXCEPTION 'ROTO (d): el trigger interfirió con un UPDATE. Rol = ''%'' y debía ser ''scrum_master''.', v_rol;
  END IF;
  RAISE NOTICE E'\u2714 d) CON migración -- el dueño puede cambiarse a sí mismo con set_project_member_role() (el trigger BEFORE INSERT no interviene en UPDATE)';
END $$;
RESET ROLE;

-- f) completed_roles: existe, NOT NULL, ninguna fila trae algo distinto de '{}'
DO $$
DECLARE v_existe boolean; v_nullable text; v_distintos bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_onboarding' AND column_name = 'completed_roles'
  ), (
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_onboarding' AND column_name = 'completed_roles'
  ) INTO v_existe, v_nullable;

  IF NOT v_existe OR v_nullable <> 'NO' THEN
    RAISE EXCEPTION 'ROTO (f): completed_roles no existe o admite NULL (nullable=%).', v_nullable;
  END IF;

  SELECT count(*) INTO v_distintos FROM public.user_onboarding WHERE completed_roles <> '{}'::text[];
  IF v_distintos <> 0 THEN
    RAISE EXCEPTION 'ROTO (f): % fila(s) de user_onboarding ya traen completed_roles distinto de vacío sin que la app haya escrito nada.', v_distintos;
  END IF;
  RAISE NOTICE E'\u2714 f) completed_roles existe (NOT NULL) y ninguna fila trae otra cosa que {} -- sin backfill';
END $$;

DO $$
BEGIN
  RAISE NOTICE '════════ ENSAYO SUPERADO -- dueño nace po (RPC y plantilla), el trigger no eleva a invitados, set_project_member_role() sigue funcionando, conteos existentes intactos, completed_roles sin backfill. ════════';
END $$;

ROLLBACK;
