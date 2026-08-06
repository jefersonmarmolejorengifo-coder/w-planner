-- ─────────────────────────────────────────────────────────────────────────────
-- CIERRE DE HALLAZGOS DE LA AUDITORÍA — tres arreglos de base de datos.
--
-- (1) tasks.id: NOT NULL sin DEFAULT, con los fallbacks del cliente ROTOS
--     Es la misma trampa que rompió las invitaciones, en la tabla principal.
--     La migración 20260806120000 corrigió participants e indicators y dejó
--     tasks fuera porque su diseño (pedir el id por RPC con claim_task_id) es
--     intencional. Pero los dos fallbacks previstos para cuando ese RPC falla
--     no funcionan:
--       · BoardTab usa `id = nextId` (contador local) → choca con la PK → 23505.
--       · createFromTemplate usa `Date.now() + i` ≈ 1,78e12 sobre una columna
--         **integer** (máx. 2.147.483.647) → 22003 integer out of range.
--     Y cualquier INSERT futuro que omita el id (importación, acción de IA,
--     migración de datos) recibiría 23502.
--
--     OJO — por qué DEFAULT nextval y NO `ADD GENERATED AS IDENTITY`: añadir
--     una identity crearía una secuencia NUEVA, distinta de la `tasks_id_seq`
--     que ya usa claim_task_id(), y las dos entregarían los mismos números.
--     Aquí se apunta la columna a la MISMA secuencia, así que el RPC y el
--     default reparten ids del mismo contador y no pueden colisionar.
--
-- (2) join_project_by_invite_code: carrera que aborta el join entero
--     Sigue siendo comprobar-y-luego-insertar (`WHERE NOT EXISTS`). Con el
--     índice único parcial que añadió la migración 20260806120000, dos
--     ejecuciones concurrentes (doble clic en "Unirse", o el enlace abierto en
--     dos pestañas) ven las dos que "no existe", las dos insertan, y la segunda
--     recibe 23505 — que al no estar capturado aborta la función entera y
--     revierte también el alta en project_members. Misma mecánica que el bug
--     original, con otro código de error.
--     Se deja que el índice resuelva la carrera con ON CONFLICT DO NOTHING.
--
--     De paso se cierra un hueco relacionado: si ya existía una ficha manual
--     con el correo de la persona pero sin auth_user_id, la función no creaba
--     la ficha vinculada NI rellenaba auth_user_id, y esa persona quedaba fuera
--     de participants_self_update y de sync_my_name_across_projects para
--     siempre. Ahora se vincula la ficha existente.
--
-- (3) chat_sessions: el índice único no protege la sesión activa
--     El UNIQUE es (project_id, owner_user_id, archived_at) y la sesión activa
--     se marca con archived_at IS NULL. En Postgres dos NULL no colisionan, así
--     que el índice impide duplicar sesiones ya archivadas — lo contrario de lo
--     que hace falta. Dos peticiones simultáneas crean dos sesiones activas y
--     el daño es permanente: maybeSingle() empieza a devolver error, el código
--     lo descarta, y cada mensaje crea otra sesión. El chat responde con
--     normalidad pero sin memoria, y el usuario lo atribuye a la IA.
--
-- IDEMPOTENTE: se puede correr varias veces sin efecto.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── (1) tasks.id genera su valor, compartiendo la secuencia con claim_task_id ─
DO $$
DECLARE
  v_seq  BIGINT;
  v_max  BIGINT;
BEGIN
  IF (SELECT column_default IS NULL FROM information_schema.columns
      WHERE table_schema='public' AND table_name='tasks' AND column_name='id') THEN
    ALTER TABLE public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq');
    RAISE NOTICE 'tasks.id -> DEFAULT nextval(tasks_id_seq)';
  ELSE
    RAISE NOTICE 'tasks.id ya tenía default; sin cambios';
  END IF;

  -- Ata la secuencia a la columna (se borra con la tabla, y pg_get_serial_sequence
  -- la reconoce). No cambia quién puede usarla.
  ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;

  -- Nunca mover la secuencia hacia atrás: claim_task_id ya repartió ids.
  SELECT COALESCE(MAX(id), 0) INTO v_max FROM public.tasks;
  SELECT last_value INTO v_seq FROM public.tasks_id_seq;
  PERFORM setval('public.tasks_id_seq', GREATEST(v_max, v_seq, 1), true);
  RAISE NOTICE '  secuencia tasks_id_seq en % (max id=%)', GREATEST(v_max, v_seq, 1), v_max;
END $$;

-- El default por nextval SÍ exige USAGE sobre la secuencia (a diferencia de una
-- columna IDENTITY). authenticated ya lo tiene; lo dejamos explícito. anon no.
GRANT USAGE, SELECT ON SEQUENCE public.tasks_id_seq TO authenticated, service_role;
REVOKE ALL ON SEQUENCE public.tasks_id_seq FROM anon;

-- ── (2) El join deja de comprobar la carrera y deja que el índice la resuelva ─
CREATE OR REPLACE FUNCTION "public"."join_project_by_invite_code"("invite_code_input" "text")
RETURNS "public"."projects"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  p projects;
  member_name TEXT;
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO p
  FROM projects
  WHERE invite_code = invite_code_input;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite code' USING ERRCODE = 'P0002';
  END IF;

  member_name := COALESCE(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.email(), '');
  v_email := lower(COALESCE(auth.email(), ''));

  INSERT INTO project_members(project_id, email, name, user_id)
  VALUES (p.id, auth.email(), member_name, auth.uid())
  ON CONFLICT(project_id, email)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    name = COALESCE(NULLIF(EXCLUDED.name, ''), project_members.name);

  -- Si el dueño ya había creado a mano una ficha con este correo, se vincula en
  -- vez de ignorarla: si no, esa persona nunca podría editar su propia ficha.
  IF v_email <> '' THEN
    UPDATE participants
       SET auth_user_id = auth.uid()
     WHERE project_id = p.id
       AND auth_user_id IS NULL
       AND lower(COALESCE(email, '')) = v_email
       AND NOT EXISTS (
         SELECT 1 FROM participants x
         WHERE x.project_id = p.id AND x.auth_user_id = auth.uid()
       );
  END IF;

  -- ON CONFLICT en lugar de comprobar antes: con dos peticiones simultáneas, la
  -- segunda no revienta con 23505 y se lleva por delante el alta de arriba.
  INSERT INTO participants(name, is_super_user, project_id, auth_user_id, email)
  SELECT member_name, FALSE, p.id, auth.uid(), auth.email()
  WHERE NOT EXISTS (
    SELECT 1 FROM participants
    WHERE project_id = p.id AND auth_user_id = auth.uid()
  )
  ON CONFLICT (project_id, auth_user_id) WHERE auth_user_id IS NOT NULL DO NOTHING;

  RETURN p;
END;
$$;

ALTER FUNCTION "public"."join_project_by_invite_code"("text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."join_project_by_invite_code"("text") FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION "public"."join_project_by_invite_code"("text") TO authenticated, service_role;

-- ── (3) Una sola sesión de chat viva por usuario y proyecto ──────────────────
CREATE UNIQUE INDEX IF NOT EXISTS chat_sessions_active_uniq
  ON public.chat_sessions (project_id, owner_user_id)
  WHERE archived_at IS NULL;

COMMIT;

-- ─── Verificación (correr después de aplicar) ────────────────────────────────
--
-- 1) tasks.id debe tener default y compartir secuencia con claim_task_id:
-- SELECT column_default FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='tasks' AND column_name='id';
--
-- 2) El flujo de invitación, incluida la idempotencia:
--    scripts/smoke-join-invite.sql
--
-- 3) Aislamiento y roles:
--    scripts/smoke-rls-tenant-isolation.sql
--    scripts/smoke-no-escalada-roles.sql
