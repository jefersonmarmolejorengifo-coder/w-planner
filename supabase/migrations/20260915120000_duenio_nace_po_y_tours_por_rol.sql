-- ─────────────────────────────────────────────────────────────────────────────
-- El dueño nace 'po', no 'participant' — trigger de defensa + tours por rol
--
-- EL FALLO (verificado en producción vía information_schema)
--   create_project_secure() inserta al creador en project_members SIN `role`,
--   así que toma el DEFAULT de la columna ('participant'). Onboarding.jsx
--   prioriza el rol que trae la base, así que al dueño recién creado le
--   arrancaba el tour de participante en vez del de PO.
--
--   El camino "crear desde plantilla" (ProjectLandingScreen.jsx,
--   createFromTemplate) inserta en projects directo y hace upsert del miembro
--   sin role: mismo bug por otra puerta. Hay más upserts client-side iguales
--   (autorregistro del dueño en ProjectLandingScreen.jsx y ProductivityPlus.jsx,
--   todos ya condicionados en el cliente a "solo si soy el owner", pero
--   dependiendo igual del DEFAULT de la columna para el valor del rol).
--
--   Los 11 dueños existentes en producción YA están como 'po' (corregidos por
--   set_project_member_role en su momento): esta migración NO necesita
--   backfill de datos, solo cierra la causa para dueños nuevos.
--
-- QUÉ HACE
--   1) create_project_secure(): registra al creador con role = 'po' explícito.
--   2) Trigger BEFORE INSERT en project_members (defensa en profundidad: cubre
--      TODOS los caminos de inserción de hoy y los que se agreguen después).
--      Si NEW.user_id coincide con el owner_id del proyecto, el rol nace 'po'.
--      Nunca eleva a quien no es dueño: si no coincide, no toca NEW.role y
--      queda lo que traiga el INSERT (normalmente el DEFAULT 'participant').
--      Solo interviene en INSERT — en UPDATE no hace nada, así que
--      set_project_member_role() sigue pudiendo cambiarle el rol al dueño
--      después sin que el trigger se lo revierta.
--   3) user_onboarding.completed_roles: columna nueva para que la app registre
--      qué tour completó o saltó cada usuario, por rol. Sin backfill: las
--      filas existentes quedan en '{}'.
--
-- INTERACCIÓN CON ON CONFLICT (project_id, email) DO UPDATE
--   create_project_secure() y join_project_by_invite_code() usan upsert manual
--   (INSERT ... ON CONFLICT DO UPDATE) y el cliente usa .upsert() del SDK, que
--   compila al mismo patrón. El trigger es BEFORE INSERT: se dispara siempre
--   que Postgres INTENTA insertar, incluso si el intento termina resolviéndose
--   como UPDATE por el conflicto. Si cae a la rama INSERT (fila nueva — el caso
--   normal, porque project_id siempre es un id recién creado en estos dos
--   RPC), el trigger corre y decide el rol. Si cae a la rama UPDATE (fila ya
--   existente, ej. alguien que reusa su propio invite code), el trigger NO
--   vuelve a dispararse — el DO UPDATE SET no toca `role`, así que el rol que
--   ya tenía la fila queda intacto (no se pierde, tampoco se fuerza).
--
-- IDEMPOTENTE: CREATE OR REPLACE, CREATE OR REPLACE TRIGGER, ADD COLUMN IF NOT
-- EXISTS — se puede correr varias veces sin efecto.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

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

  -- Mirror the previous client-side flow: ensure the creator is registered.
  -- role = 'po' explícito: antes tomaba el DEFAULT de la columna
  -- ('participant') y el onboarding arrancaba con el guion equivocado.
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

-- No es invocable como RPC: Postgres rechaza llamar directo a una función que
-- RETURNS trigger fuera de contexto de trigger ("trigger functions can only
-- be called as triggers"), así que PostgREST no puede ejecutarla vía
-- /rpc/enforce_owner_role_on_member_insert aunque tuviera EXECUTE. Aun así se
-- cierra explícito, por la regla de la casa: en Supabase REVOKE FROM PUBLIC no
-- alcanza (los defaults del proyecto dan EXECUTE nominal a anon y
-- authenticated en cada función nueva del schema public), hay que nombrarlos.
REVOKE ALL ON FUNCTION public.enforce_owner_role_on_member_insert() FROM PUBLIC, anon, authenticated;

-- ── 3. user_onboarding.completed_roles: tours por rol ─────────────────────────
-- Sin backfill: las filas existentes quedan en '{}' (DEFAULT aplicado también
-- a las filas ya sembradas, sin necesidad de un UPDATE separado). La RLS
-- existente (user_onboarding_self_all, USING/WITH CHECK user_id = auth.uid(),
-- sin políticas por columna) ya cubre esta columna igual que el resto de la
-- fila: cada quien solo puede leer/escribir la suya.
ALTER TABLE public.user_onboarding
  ADD COLUMN IF NOT EXISTS completed_roles text[] NOT NULL DEFAULT '{}'::text[];

COMMIT;

-- ─── Verificación (correr después de aplicar) ────────────────────────────────
--
-- 1) create_project_secure() incluye role='po' en el INSERT:
-- SELECT prosrc FROM pg_proc WHERE proname = 'create_project_secure';
--
-- 2) El trigger existe, está habilitado y dispara BEFORE INSERT:
-- SELECT tgname, tgenabled, tgtype
-- FROM pg_trigger
-- WHERE tgrelid = 'public.project_members'::regclass AND NOT tgisinternal;
--
-- 3) La función del trigger no es ejecutable por PUBLIC/anon/authenticated:
-- SELECT proacl FROM pg_proc WHERE proname = 'enforce_owner_role_on_member_insert';
--
-- 4) completed_roles existe, default '{}', NOT NULL, y ninguna fila trae algo
--    distinto de '{}' hasta que la app empiece a escribir:
-- SELECT column_name, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'user_onboarding' AND column_name = 'completed_roles';
--
-- SELECT count(*) FROM public.user_onboarding WHERE completed_roles <> '{}'::text[];
--
-- 5) Conteo de miembros por rol antes/después (debe ser igual — sin backfill):
-- SELECT role, count(*) FROM public.project_members GROUP BY role ORDER BY role;
