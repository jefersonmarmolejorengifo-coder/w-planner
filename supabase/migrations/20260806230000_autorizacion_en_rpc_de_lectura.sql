-- ─────────────────────────────────────────────────────────────────────────────
-- SEGURIDAD — Las RPC de solo lectura ahora comprueban QUIÉN pregunta.
--
-- HALLAZGO
--   Nueve funciones SECURITY DEFINER (corren como postgres y saltan la RLS)
--   aceptan el identificador de la víctima como parámetro y no comprobaban nada:
--   la contención que la RLS impone a las tablas se perdía al entrar por la
--   función. Un usuario autenticado cualquiera podía leer el plan y el estado de
--   suscripción de otra persona pasando su uuid, y enumerar los project_id
--   (enteros correlativos) para saber, de cada tablero de la plataforma, si
--   tiene IA, qué cuota de chat lleva consumida y cuándo generó su evolutivo.
--
--   El acceso ANÓNIMO a estas funciones ya se cerró en la migración
--   20260806210000. Esto cierra el que queda: usuario con cuenta preguntando
--   por datos ajenos.
--
-- POR QUÉ EL GUARD NO LANZA EXCEPCIÓN EN CASI NINGUNA
--   Ocho de las nueve son `LANGUAGE sql` y no pueden hacer RAISE. Convertirlas a
--   plpgsql sería reescribir de arriba abajo funciones que controlan el acceso a
--   las features de pago: mucho riesgo para poca ganancia. En su lugar se añade
--   la comprobación al propio predicado, así que denegar significa "devuelve
--   false / cero filas" en vez de "lanza error". Para lo que hacen estas
--   funciones —responder si algo está permitido— es exactamente la respuesta
--   correcta, y encima es la que sus llamadores ya saben tratar.
--
-- CUIDADO CON EL CRON
--   api/cron.js y api/generate-evolution.js llaman a varias de estas funciones
--   con `createSupabase(null, { admin: true })`, es decir con la clave
--   service_role, donde `auth.uid()` es NULL. Un guard basado solo en
--   pertenencia las habría roto en silencio (el cron habría dejado de ver las
--   features de pago). Por eso existe caller_is_service_role().
--
-- COBERTURA
--   project_can_use_chat y project_can_use_evolutivo delegan en
--   project_has_feature, así que quedan cubiertas al guardar esa.
--
-- IDEMPOTENTE: se puede correr varias veces sin efecto.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Helpers ──────────────────────────────────────────────────────────────────

-- ¿La petición viene con la clave service_role? PostgREST decodifica el JWT y
-- deja sus claims en request.jwt.claims; el cliente no puede falsificarlas
-- porque nunca ejecuta SQL directo. Los endpoints de servidor (cron, generación
-- de informes) entran por aquí y deben seguir pasando.
CREATE OR REPLACE FUNCTION public.caller_is_service_role() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    ''
  ) = 'service_role';
$$;
ALTER FUNCTION public.caller_is_service_role() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.caller_is_service_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_is_service_role() TO authenticated, service_role;

-- ¿Quien pregunta tiene algo que ver con este tablero?
CREATE OR REPLACE FUNCTION public.caller_can_see_project(pid bigint) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
AS $$
  SELECT public.caller_is_service_role() OR public.is_project_member(pid);
$$;
ALTER FUNCTION public.caller_can_see_project(bigint) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.caller_can_see_project(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_can_see_project(bigint) TO authenticated, service_role;

-- ── Funciones por proyecto ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.project_has_feature(p_project_id bigint, p_feature text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    LEFT JOIN public.users_premium up ON up.user_id = p.owner_id
    LEFT JOIN public.tier_limits t ON t.tier = COALESCE(up.tier, 'free')
    WHERE p.id = p_project_id
      AND public.caller_can_see_project(p_project_id)
      AND p.ia_enabled = true
      AND COALESCE(up.status, 'active') = 'active'
      AND p_feature = ANY(t.features)
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_can_use_ia_on_project(p_project_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    LEFT JOIN public.users_premium up ON up.user_id = p.owner_id
    LEFT JOIN public.tier_limits t ON t.tier = COALESCE(up.tier, 'free')
    WHERE p.id = p_project_id
      AND public.caller_can_see_project(p_project_id)
      AND p.ia_enabled = true
      AND COALESCE(up.status, 'active') = 'active'
      AND COALESCE(up.tier, 'free') != 'free'
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_generate_evolution(p_project_id bigint)
 RETURNS TABLE(can_generate boolean, last_generated_at timestamp with time zone, next_available_at timestamp with time zone, days_remaining integer, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH last AS (
    SELECT MAX(generated_at) AS last_at
    FROM public.user_evolutions
    WHERE project_id = p_project_id
  )
  SELECT
    CASE
      WHEN last.last_at IS NULL THEN true
      WHEN last.last_at + INTERVAL '60 days' <= NOW() THEN true
      ELSE false
    END AS can_generate,
    last.last_at AS last_generated_at,
    CASE
      WHEN last.last_at IS NULL THEN NULL
      ELSE last.last_at + INTERVAL '60 days'
    END AS next_available_at,
    CASE
      WHEN last.last_at IS NULL THEN 0
      ELSE GREATEST(0, EXTRACT(DAY FROM (last.last_at + INTERVAL '60 days' - NOW()))::int)
    END AS days_remaining,
    CASE
      WHEN last.last_at IS NULL THEN 'Primera vez disponible'
      WHEN last.last_at + INTERVAL '60 days' <= NOW() THEN 'Disponible para regenerar'
      ELSE 'Debe esperar 60 dias desde el ultimo evolutivo para evitar costos repetidos'
    END AS reason
  FROM last
  -- Quien no tiene nada que ver con el tablero recibe cero filas.
  WHERE public.caller_can_see_project(p_project_id);
$function$;

CREATE OR REPLACE FUNCTION public.participant_days_active(p_project_id bigint, p_name text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH activity AS (
    SELECT DISTINCT date_trunc('day', d) AS dia FROM (
      SELECT inserted_at AS d FROM public.tasks
        WHERE project_id = p_project_id AND responsible = p_name AND inserted_at IS NOT NULL
      UNION ALL
      SELECT updated_at  AS d FROM public.tasks
        WHERE project_id = p_project_id AND responsible = p_name AND updated_at  IS NOT NULL
      UNION ALL
      SELECT closed_at   AS d FROM public.tasks
        WHERE project_id = p_project_id AND responsible = p_name AND closed_at   IS NOT NULL
      UNION ALL
      -- Comentarios del thread (migración 013); tolera si no existe.
      SELECT c.created_at AS d FROM public.task_comments c
        WHERE c.project_id = p_project_id AND c.author_name = p_name AND c.deleted_at IS NULL
    ) all_events
    WHERE d IS NOT NULL
  )
  -- Sin relación con el tablero, el conteo sale 0 en vez de revelar actividad.
  SELECT COUNT(*)::int FROM activity WHERE public.caller_can_see_project(p_project_id);
$function$;

CREATE OR REPLACE FUNCTION public.project_chat_quota_remaining(p_project_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quota INT;
  v_used  INT;
BEGIN
  -- Esta sí es plpgsql, así que puede negarse explícitamente.
  IF NOT public.caller_can_see_project(p_project_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este tablero' USING ERRCODE = '42501';
  END IF;

  v_quota := public.project_chat_quota_for(p_project_id);
  SELECT used INTO v_used FROM public.chat_monthly_usage
  WHERE project_id = p_project_id AND period = date_trunc('month', NOW())::date;
  v_used := COALESCE(v_used, 0);
  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
    'remaining', GREATEST(v_quota - v_used, 0));
END;
$function$;

-- ── Funciones por usuario ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_ia_capacity(p_user_id uuid DEFAULT auth.uid())
 RETURNS TABLE(tier text, display_name text, status text, ia_current integer, ia_max integer, total_current integer, total_max integer, can_enable_more boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH up AS (
    SELECT u.tier, u.status,
           t.display_name, t.ia_projects, t.total_projects
    FROM (SELECT COALESCE(up.tier, 'free') AS tier,
                 COALESCE(up.status, 'active') AS status
          FROM (SELECT 1) x
          LEFT JOIN public.users_premium up ON up.user_id = p_user_id) u
    JOIN public.tier_limits t ON t.tier = u.tier
  ),
  cnt AS (
    SELECT
      COALESCE(SUM(CASE WHEN ia_enabled THEN 1 ELSE 0 END), 0)::int AS ia_curr,
      COUNT(*)::int AS total_curr
    FROM public.projects
    WHERE owner_id = p_user_id
  )
  SELECT
    up.tier,
    up.display_name,
    up.status,
    cnt.ia_curr,
    up.ia_projects,
    cnt.total_curr,
    up.total_projects,
    (up.status = 'active' AND cnt.ia_curr < up.ia_projects) AS can_enable_more
  FROM up CROSS JOIN cnt
  -- Solo tu propio plan. Preguntar por el uuid de otro devuelve cero filas.
  WHERE p_user_id = auth.uid() OR public.caller_is_service_role();
$function$;

CREATE OR REPLACE FUNCTION public.sprint_retro_pending_for_user(p_user_id uuid DEFAULT auth.uid())
 RETURNS TABLE(period_id bigint, sprint_id bigint, sprint_name text, project_id bigint, project_name text, closes_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id, p.sprint_id, s.name, p.project_id, pr.name, p.closes_at
  FROM public.sprint_retro_periods p
  JOIN public.sprints s ON s.id = p.sprint_id
  JOIN public.projects pr ON pr.id = p.project_id
  WHERE p.status = 'open'
    AND p.closes_at > NOW()
    -- Solo tus propias retros pendientes: con el uuid de otro se filtraban los
    -- nombres de sus proyectos y sprints, incluidos tableros ajenos.
    AND (p_user_id = auth.uid() OR public.caller_is_service_role())
    -- El usuario es miembro o owner del proyecto
    AND (
      pr.owner_id = p_user_id
      OR EXISTS (
        SELECT 1 FROM public.project_members m
        WHERE m.project_id = pr.id AND m.user_id = p_user_id
      )
    )
    -- Y no ha respondido aun
    AND NOT EXISTS (
      SELECT 1 FROM public.sprint_retros r
      WHERE r.period_id = p.id AND r.respondent_user_id = p_user_id
    )
  ORDER BY p.closes_at ASC;
$function$;

-- Los CREATE OR REPLACE conservan los permisos previos, pero lo dejamos
-- explícito para que un `DROP + CREATE` futuro no reabra la puerta al anónimo.
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'project_has_feature(bigint, text)',
    'user_can_use_ia_on_project(bigint)',
    'can_generate_evolution(bigint)',
    'participant_days_active(bigint, text)',
    'project_chat_quota_remaining(bigint)',
    'user_ia_capacity(uuid)',
    'sprint_retro_pending_for_user(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', v_fn);
  END LOOP;
  RAISE NOTICE 'permisos reafirmados en las 7 funciones reescritas';
END $$;

COMMIT;

-- ─── Verificación: scripts/smoke-rpc-autorizacion.sql ────────────────────────
