-- =============================================================================
-- w-planner — LÍNEA BASE: esquema real de producción (2026-07-26)
-- =============================================================================
--
-- QUÉ ES: una foto exacta del esquema que hoy tiene la base de producción,
-- extraída con `supabase db dump --linked --schema public`.
--
-- POR QUÉ EXISTE:
--   Las 42 migraciones históricas no podían reconstruir la aplicación. Se
--   detenían en la 18 de 42 y, al comparar con producción, la divergencia
--   resultó ser grande: la tabla `tasks` tiene 33 columnas en producción y la
--   migración inicial creaba 22, además de un renombrado `created_at` →
--   `inserted_at` que nunca se versionó. Habían entrado cambios a mano
--   durante meses.
--
--   Parchear diferencia por diferencia habría sido adivinar. Tomar la foto
--   real es exacto y verificable: aplicando este archivo, un entorno nuevo
--   queda idéntico a producción.
--
-- LAS MIGRACIONES ANTERIORES no se han borrado: están en
--   `supabase/migrations/_historico/`
-- El CLI no lee subcarpetas, así que no se aplican, pero el historial y su
-- documentación siguen disponibles (y en git).
--
-- ⚠️ ANTES DEL PRÓXIMO `supabase db push` A PRODUCCIÓN:
--   Producción NO tiene registrado este archivo en supabase_migrations, así
--   que el CLI intentaría aplicarlo. Hay que marcarlo como ya aplicado, una
--   sola vez:
--       supabase migration repair --status applied 00000000000000
--   Eso solo escribe en la tabla de control; no ejecuta el SQL.
--
-- A partir de aquí, cada cambio de esquema entra por su propia migración.
-- =============================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."users_premium" (
    "user_id" "uuid" NOT NULL,
    "tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "mp_preapproval_id" "text",
    "mp_payer_email" "text",
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "last_payment_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "users_premium_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'pending'::"text", 'past_due'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."users_premium" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_user_plan"("p_email" "text", "p_tier" "text") RETURNS "public"."users_premium"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  uid    UUID;
  result public.users_premium;
BEGIN
  -- Validar que el tier exista en el catálogo (free, pro_solo, pro_team, pro_power, enterprise).
  IF NOT EXISTS (SELECT 1 FROM public.tier_limits WHERE tier = p_tier) THEN
    RAISE EXCEPTION 'Tier inválido: %. Valores válidos en public.tier_limits.', p_tier;
  END IF;

  -- Resolver la cuenta por email (case-insensitive).
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(p_email));
  IF uid IS NULL THEN
    RAISE EXCEPTION 'No existe ninguna cuenta con email %', p_email;
  END IF;

  -- 'free' = quitar premium: status active sin tier de pago. Otros = conceder sin cobro.
  INSERT INTO public.users_premium (user_id, tier, status, metadata)
  VALUES (uid, p_tier, 'active',
          jsonb_build_object('grant', 'comp', 'source', 'admin_set_user_plan'))
  ON CONFLICT (user_id) DO UPDATE SET
    tier               = EXCLUDED.tier,
    status             = 'active',
    mp_preapproval_id  = NULL,          -- corta cualquier suscripción MP previa
    current_period_end = NULL,          -- sin expiración → permanente hasta que lo cambies
    metadata           = public.users_premium.metadata
                          || jsonb_build_object('grant', 'comp', 'source', 'admin_set_user_plan')
  RETURNING * INTO result;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."admin_set_user_plan"("p_email" "text", "p_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_generate_evolution"("p_project_id" bigint) RETURNS TABLE("can_generate" boolean, "last_generated_at" timestamp with time zone, "next_available_at" timestamp with time zone, "days_remaining" integer, "reason" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  FROM last;
$$;


ALTER FUNCTION "public"."can_generate_evolution"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."chat_session_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  UPDATE public.chat_sessions SET updated_at = NOW() WHERE id = NEW.session_id;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."chat_session_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer, "p_window_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count        INT;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_max IS NULL OR p_max <= 0 THEN
    RETURN TRUE; -- configuración inválida: no bloquear
  END IF;

  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.api_rate_limits (bucket_key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = public.api_rate_limits.count + 1
  RETURNING count INTO v_count;

  -- Limpieza oportunista y barata de ventanas viejas (~2% de las llamadas).
  IF random() < 0.02 THEN
    DELETE FROM public.api_rate_limits WHERE window_start < now() - INTERVAL '1 day';
  END IF;

  RETURN v_count <= p_max;
END;
$$;


ALTER FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_task_id"() RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT nextval('public.tasks_id_seq');
$$;


ALTER FUNCTION "public"."claim_task_id"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "invite_code" "text" DEFAULT ("gen_random_uuid"())::"text",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "owner_id" "uuid",
    "ia_enabled" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_project_secure"("p_name" "text", "p_description" "text", "p_config" "jsonb") RETURNS "public"."projects"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  INSERT INTO project_members (project_id, email, name, user_id)
  VALUES (new_proj.id, user_email, full_name, uid)
  ON CONFLICT (project_id, email)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    name    = COALESCE(NULLIF(EXCLUDED.name, ''), project_members.name);

  RETURN new_proj;
END;
$$;


ALTER FUNCTION "public"."create_project_secure"("p_name" "text", "p_description" "text", "p_config" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_project_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tier    TEXT;
  v_status  TEXT;
  v_limit   INTEGER;
  v_current INTEGER;
BEGIN
  -- Sin contexto de usuario (service_role / seeding): no aplicamos límite.
  IF auth.uid() IS NULL OR NEW.owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Solo limitamos los tableros que el propio usuario crea para sí mismo.
  IF NEW.owner_id <> auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Tier efectivo del owner (default free). Un plan de pago no-activo cae a free.
  SELECT COALESCE(up.tier, 'free'), COALESCE(up.status, 'active')
    INTO v_tier, v_status
  FROM (SELECT 1) x
  LEFT JOIN public.users_premium up ON up.user_id = NEW.owner_id;

  IF v_tier <> 'free' AND v_status <> 'active' THEN
    v_tier := 'free';
  END IF;

  SELECT total_projects INTO v_limit
  FROM public.tier_limits WHERE tier = v_tier;
  v_limit := COALESCE(v_limit, 1);

  SELECT COUNT(*) INTO v_current
  FROM public.projects WHERE owner_id = NEW.owner_id;

  IF v_current >= v_limit THEN
    RAISE EXCEPTION 'Llegaste al límite de % tablero(s) del plan %. Sube de plan para crear más.', v_limit, v_tier
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_project_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT id
    FROM auth.users
   WHERE lower(email) = lower(p_email)
   LIMIT 1;
$$;


ALTER FUNCTION "public"."get_user_id_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_project_role"("pid" bigint, "roles" "text"[]) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT is_project_owner(pid)
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = pid
        AND (
          m.user_id = auth.uid()
          OR lower(m.email) = lower(COALESCE(auth.email(), ''))
        )
        AND m.role = ANY(roles)
    );
$$;


ALTER FUNCTION "public"."has_project_role"("pid" bigint, "roles" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hub_marcar_evento_procesado"("p_evento_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.hub_eventos_procesados
     SET estado        = 'procesado',
         actualizado_en = NOW()
   WHERE evento_id = p_evento_id;
END;
$$;


ALTER FUNCTION "public"."hub_marcar_evento_procesado"("p_evento_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."hub_marcar_evento_procesado"("p_evento_id" "text") IS 'Marca el evento como procesado (terminal). Se llama en éxito y en parqueo (user_not_found, plan_desconocido). Previene que el self-healing lo reclame en reintentos futuros del Hub.';



CREATE OR REPLACE FUNCTION "public"."hub_outbox_claim"("p_limit" integer DEFAULT 5) RETURNS TABLE("id" bigint, "mp_payment_id" "text", "payload" "jsonb", "attempts" integer, "max_attempts" integer)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  UPDATE public.hub_outbox
  SET
    status         = 'processing',
    attempts       = attempts + 1,
    updated_at     = NOW()
  WHERE id IN (
    SELECT id
    FROM   public.hub_outbox
    WHERE  status IN ('pending', 'failed')
      AND  next_attempt_at <= NOW()
    ORDER  BY next_attempt_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, mp_payment_id, payload, attempts, max_attempts;
$$;


ALTER FUNCTION "public"."hub_outbox_claim"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hub_outbox_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."hub_outbox_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hub_reclamar_evento"("p_evento_id" "text", "p_evento_tipo" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_claimed BOOLEAN;
  v_estado  TEXT;
BEGIN
  -- Intento atómico de reclamo.
  -- INSERT normal para evento nuevo.
  -- ON CONFLICT: solo actualiza si el evento es reintentable:
  --   - 'revertido': falló antes, permitimos retomar.
  --   - 'procesando' con más de 15 min: worker muerto (self-healing).
  -- Si el estado es 'procesado' o 'procesando' reciente, el WHERE del DO UPDATE
  -- no aplica → 0 filas devueltas → v_claimed queda NULL.
  INSERT INTO public.hub_eventos_procesados (evento_id, evento_tipo, estado, actualizado_en)
    VALUES (p_evento_id, p_evento_tipo, 'procesando', NOW())
  ON CONFLICT (evento_id) DO UPDATE
    SET estado        = 'procesando',
        actualizado_en = NOW()
  WHERE hub_eventos_procesados.estado = 'revertido'
     OR (
          hub_eventos_procesados.estado = 'procesando'
          AND hub_eventos_procesados.actualizado_en < NOW() - INTERVAL '15 minutes'
        )
  RETURNING TRUE INTO v_claimed;

  -- Si reclamamos (INSERT nuevo o UPDATE exitoso), informamos al worker que proceda.
  IF v_claimed IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  -- No reclamamos: leer el estado actual para dar una respuesta informativa.
  SELECT estado INTO v_estado
    FROM public.hub_eventos_procesados
   WHERE evento_id = p_evento_id;

  IF v_estado = 'procesado' THEN
    -- Estado terminal: el evento ya fue aplicado exitosamente en una corrida anterior.
    RETURN 'duplicate';
  ELSE
    -- Estado 'procesando' reciente (<15 min): otra corrida activa lo tiene.
    -- El Hub no debe re-procesar. Si ese worker murió, el auto-sanado ocurrirá
    -- en el siguiente reintento tardío (>15 min).
    RETURN 'in_flight';
  END IF;
END;
$$;


ALTER FUNCTION "public"."hub_reclamar_evento"("p_evento_id" "text", "p_evento_tipo" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."hub_reclamar_evento"("p_evento_id" "text", "p_evento_tipo" "text") IS 'Reclama atómicamente un evento para procesarlo. Devuelve: ''claimed'' (proceder), ''duplicate'' (ya procesado, ignorar), ''in_flight'' (otra corrida activa <15 min, esperar). Self-healing: reclama eventos ''procesando'' con >15 min (worker muerto).';



CREATE OR REPLACE FUNCTION "public"."hub_revertir_evento"("p_evento_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.hub_eventos_procesados
     SET estado        = 'revertido',
         actualizado_en = NOW()
   WHERE evento_id = p_evento_id;
END;
$$;


ALTER FUNCTION "public"."hub_revertir_evento"("p_evento_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."hub_revertir_evento"("p_evento_id" "text") IS 'Marca el evento como revertido, habilitando reintento. Reemplaza el DELETE del diseño anterior: si este UPDATE falla, el evento queda en ''procesando'' con timestamp viejo → self-healing a los 15 min → propiedad preservada.';



CREATE OR REPLACE FUNCTION "public"."is_project_member"("pid" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT is_project_owner(pid)
    OR EXISTS (
      SELECT 1 FROM project_members m
      WHERE m.project_id = pid
        AND (
          m.user_id = auth.uid()
          OR lower(m.email) = lower(COALESCE(auth.email(), ''))
        )
    );
$$;


ALTER FUNCTION "public"."is_project_member"("pid" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_project_owner"("pid" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = pid
      AND p.owner_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_project_owner"("pid" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_project_by_invite_code"("invite_code_input" "text") RETURNS "public"."projects"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  p projects;
  member_name TEXT;
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

  INSERT INTO project_members(project_id, email, name, user_id)
  VALUES (p.id, auth.email(), member_name, auth.uid())
  ON CONFLICT(project_id, email)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    name = COALESCE(NULLIF(EXCLUDED.name, ''), project_members.name);

  INSERT INTO participants(name, is_super_user, project_id, auth_user_id, email)
  SELECT member_name, FALSE, p.id, auth.uid(), auth.email()
  WHERE NOT EXISTS (
    SELECT 1 FROM participants
    WHERE project_id = p.id
      AND (auth_user_id = auth.uid() OR lower(email) = lower(COALESCE(auth.email(), '')))
  );

  RETURN p;
END;
$$;


ALTER FUNCTION "public"."join_project_by_invite_code"("invite_code_input" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_role_in_project"("p_project_id" bigint) RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role FROM public.project_members
  WHERE project_id = p_project_id AND user_id = auth.uid()
  LIMIT 1;
$$;


ALTER FUNCTION "public"."my_role_in_project"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."owner_boards_overview"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH my_projects AS (
    SELECT id, name, description, ia_enabled
    FROM public.projects
    WHERE owner_id = auth.uid()
  ),
  today AS (
    SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS d
  ),
  task_agg AS (
    SELECT
      t.project_id,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE t.status = 'Finalizada')::int  AS done,
      COUNT(*) FILTER (WHERE t.status = 'Bloqueada')::int   AS blocked,
      COUNT(*) FILTER (WHERE t.status = 'Sin iniciar')::int AS not_started,
      COUNT(*) FILTER (
        WHERE t.status <> 'Finalizada'
          AND t.end_date IS NOT NULL AND t.end_date <> ''
          AND t.end_date < (SELECT d FROM today)
      )::int AS overdue,
      COUNT(DISTINCT t.responsible) FILTER (
        WHERE t.responsible IS NOT NULL AND t.responsible <> ''
      )::int AS people_count
    FROM public.tasks t
    JOIN my_projects p ON p.id = t.project_id
    GROUP BY t.project_id
  ),
  resp_agg AS (
    SELECT
      t.project_id,
      t.responsible,
      SUM(COALESCE(t.aporte_snapshot, 0)) AS ap,
      ROW_NUMBER() OVER (
        PARTITION BY t.project_id
        ORDER BY SUM(COALESCE(t.aporte_snapshot, 0)) DESC
      ) AS rn
    FROM public.tasks t
    JOIN my_projects p ON p.id = t.project_id
    WHERE t.responsible IS NOT NULL AND t.responsible <> ''
    GROUP BY t.project_id, t.responsible
  ),
  top2 AS (
    SELECT project_id,
      jsonb_agg(jsonb_build_object('name', responsible, 'ap', ap) ORDER BY rn) AS top
    FROM resp_agg
    WHERE rn <= 2
    GROUP BY project_id
  ),
  active_sprint AS (
    SELECT DISTINCT ON (s.project_id) s.project_id, s.name
    FROM public.sprints s
    JOIN my_projects p ON p.id = s.project_id
    WHERE s.status = 'active'
    ORDER BY s.project_id, s.id DESC
  ),
  okr_agg AS (
    SELECT o.project_id, COUNT(*)::int AS okr_count
    FROM public.okrs o
    JOIN my_projects p ON p.id = o.project_id
    WHERE o.status = 'active'
    GROUP BY o.project_id
  )
  SELECT jsonb_build_object(
    'boards', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'project_id',  p.id,
          'name',        p.name,
          'description', p.description,
          'ia_enabled',  p.ia_enabled,
          'total',       COALESCE(ta.total, 0),
          'done',        COALESCE(ta.done, 0),
          'blocked',     COALESCE(ta.blocked, 0),
          'not_started', COALESCE(ta.not_started, 0),
          'in_progress', COALESCE(ta.total, 0) - COALESCE(ta.done, 0) - COALESCE(ta.blocked, 0) - COALESCE(ta.not_started, 0),
          'overdue',     COALESCE(ta.overdue, 0),
          'people_count',COALESCE(ta.people_count, 0),
          'active_sprint', asp.name,
          'okr_count',   COALESCE(oa.okr_count, 0),
          'top',         COALESCE(top2.top, '[]'::jsonb)
        ) ORDER BY p.id
      )
      FROM my_projects p
      LEFT JOIN task_agg ta     ON ta.project_id   = p.id
      LEFT JOIN top2            ON top2.project_id = p.id
      LEFT JOIN active_sprint asp ON asp.project_id = p.id
      LEFT JOIN okr_agg oa      ON oa.project_id   = p.id
    ), '[]'::jsonb),
    'distinct_people', COALESCE((
      SELECT COUNT(DISTINCT t.responsible)
      FROM public.tasks t
      JOIN my_projects p ON p.id = t.project_id
      WHERE t.responsible IS NOT NULL AND t.responsible <> ''
    ), 0)
  );
$$;


ALTER FUNCTION "public"."owner_boards_overview"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."participant_days_active"("p_project_id" bigint, "p_name" "text") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  SELECT COUNT(*)::int FROM activity;
$$;


ALTER FUNCTION "public"."participant_days_active"("p_project_id" bigint, "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_can_use_chat"("p_project_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.project_has_feature(p_project_id, 'chat');
$$;


ALTER FUNCTION "public"."project_can_use_chat"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_can_use_evolutivo"("p_project_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.project_has_feature(p_project_id, 'evolutivo');
$$;


ALTER FUNCTION "public"."project_can_use_evolutivo"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_chat_consume_quota"("p_project_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_quota  INT;
  v_period DATE := date_trunc('month', NOW())::date;
  v_used   INT;
BEGIN
  v_quota := public.project_chat_quota_for(p_project_id);
  IF v_quota <= 0 THEN
    RETURN jsonb_build_object('allowed', false, 'quota', 0, 'used', 0, 'remaining', 0);
  END IF;

  -- Incremento atómico guardado por la cuota. Si la fila ya existe y
  -- used >= quota, la rama DO UPDATE no aplica (WHERE falso): no incrementa y
  -- RETURNING no devuelve fila (v_used queda NULL).
  INSERT INTO public.chat_monthly_usage (project_id, period, used)
  VALUES (p_project_id, v_period, 1)
  ON CONFLICT (project_id, period) DO UPDATE
    SET used = public.chat_monthly_usage.used + 1, updated_at = NOW()
    WHERE public.chat_monthly_usage.used < v_quota
  RETURNING used INTO v_used;

  IF v_used IS NULL THEN
    -- Tope alcanzado: leemos el used vigente solo para reportarlo.
    SELECT used INTO v_used FROM public.chat_monthly_usage
    WHERE project_id = p_project_id AND period = v_period;
    RETURN jsonb_build_object('allowed', false, 'quota', v_quota,
      'used', COALESCE(v_used, v_quota), 'remaining', 0);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'quota', v_quota,
    'used', v_used, 'remaining', GREATEST(v_quota - v_used, 0));
END;
$$;


ALTER FUNCTION "public"."project_chat_consume_quota"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_chat_quota_for"("p_project_id" bigint) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(t.chat_msg_quota, 0)
  FROM public.projects p
  LEFT JOIN public.users_premium up ON up.user_id = p.owner_id
  LEFT JOIN public.tier_limits   t  ON t.tier = COALESCE(up.tier, 'free')
  WHERE p.id = p_project_id;
$$;


ALTER FUNCTION "public"."project_chat_quota_for"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_chat_quota_remaining"("p_project_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_quota INT;
  v_used  INT;
BEGIN
  v_quota := public.project_chat_quota_for(p_project_id);
  SELECT used INTO v_used FROM public.chat_monthly_usage
  WHERE project_id = p_project_id AND period = date_trunc('month', NOW())::date;
  v_used := COALESCE(v_used, 0);
  RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
    'remaining', GREATEST(v_quota - v_used, 0));
END;
$$;


ALTER FUNCTION "public"."project_chat_quota_remaining"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_chat_release_quota"("p_project_id" bigint) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  UPDATE public.chat_monthly_usage
    SET used = GREATEST(used - 1, 0), updated_at = NOW()
  WHERE project_id = p_project_id
    AND period = date_trunc('month', NOW())::date;
$$;


ALTER FUNCTION "public"."project_chat_release_quota"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_has_feature"("p_project_id" bigint, "p_feature" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    LEFT JOIN public.users_premium up ON up.user_id = p.owner_id
    LEFT JOIN public.tier_limits t ON t.tier = COALESCE(up.tier, 'free')
    WHERE p.id = p_project_id
      AND p.ia_enabled = true
      AND COALESCE(up.status, 'active') = 'active'
      AND p_feature = ANY(t.features)
  );
$$;


ALTER FUNCTION "public"."project_has_feature"("p_project_id" bigint, "p_feature" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."project_members_with_role"("p_project_id" bigint) RETURNS TABLE("user_id" "uuid", "email" "text", "name" "text", "role" "text", "is_owner" boolean, "invited_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    pm.user_id,
    pm.email,
    pm.name,
    pm.role,
    (pm.user_id = p.owner_id) AS is_owner,
    pm.invited_at
  FROM public.project_members pm
  JOIN public.projects p ON p.id = pm.project_id
  WHERE pm.project_id = p_project_id
    AND (
      pm.user_id = auth.uid()
      OR p.owner_id = auth.uid()
    )
  ORDER BY (pm.user_id = p.owner_id) DESC, pm.invited_at;
$$;


ALTER FUNCTION "public"."project_members_with_role"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."report_configs_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."report_configs_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_project_ia_enabled"("p_project_id" bigint, "p_enabled" boolean) RETURNS "public"."projects"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  uid UUID := auth.uid();
  proj public.projects;
  cap RECORD;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO proj FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = 'P0002';
  END IF;
  IF proj.owner_id <> uid THEN
    RAISE EXCEPTION 'Only the project owner can toggle IA' USING ERRCODE = '42501';
  END IF;

  IF p_enabled = true AND proj.ia_enabled = false THEN
    SELECT * INTO cap FROM public.user_ia_capacity(uid);
    IF NOT cap.can_enable_more THEN
      IF cap.tier = 'free' THEN
        RAISE EXCEPTION 'El plan Gratis no incluye IA en proyectos. Sube a Pro Solo o superior.'
          USING ERRCODE = 'P0001';
      ELSIF cap.status <> 'active' THEN
        RAISE EXCEPTION 'Tu suscripción no está activa (status: %).', cap.status
          USING ERRCODE = 'P0001';
      ELSE
        RAISE EXCEPTION 'Llegaste al límite de % proyectos con IA del plan %. Sube de tier o desactiva IA en otro proyecto.',
          cap.ia_max, cap.display_name
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  UPDATE public.projects SET ia_enabled = p_enabled WHERE id = p_project_id RETURNING * INTO proj;
  RETURN proj;
END;
$$;


ALTER FUNCTION "public"."set_project_ia_enabled"("p_project_id" bigint, "p_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_project_member_role"("p_project_id" bigint, "p_member_user_id" "uuid", "p_role" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT owner_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Proyecto no encontrado' USING ERRCODE = '02000';
  END IF;
  IF v_owner != auth.uid() THEN
    RAISE EXCEPTION 'Solo el owner puede asignar roles' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('po', 'scrum_master', 'participant') THEN
    RAISE EXCEPTION 'Rol invalido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.project_members
  SET role = p_role
  WHERE project_id = p_project_id AND user_id = p_member_user_id;

  -- Cuando el owner cambia el rol de alguien, conviene resetear el progreso
  -- del tour de ese usuario para que vea el nuevo tour la próxima vez.
  -- El estado vive en user_onboarding (global). Lo reseteamos:
  UPDATE public.user_onboarding
  SET current_step = 0, completed_at = NULL, skipped = FALSE
  WHERE user_id = p_member_user_id;
END;
$$;


ALTER FUNCTION "public"."set_project_member_role"("p_project_id" bigint, "p_member_user_id" "uuid", "p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_task_auto_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  close_states TEXT[] := ARRAY['Finalizada','Cancelada'];
  status_is_close BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Honor explicit values if provided, otherwise default.
    NEW.updated_at := COALESCE(NEW.updated_at, NOW());
    status_is_close := NEW.status = ANY(close_states);
    IF status_is_close AND NEW.closed_at IS NULL THEN
      NEW.closed_at := NOW();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE branch: skip if nothing changed (idempotent updates,
  -- "UPDATE t SET status = status" must not bump updated_at).
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;

  NEW.updated_at := NOW();

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    status_is_close := NEW.status = ANY(close_states);
    IF status_is_close AND OLD.closed_at IS NULL THEN
      NEW.closed_at := NOW();
    ELSIF NOT status_is_close AND OLD.closed_at IS NOT NULL THEN
      NEW.closed_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_task_auto_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_task_field_defs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NEW;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_task_field_defs_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sprint_retro_pending_for_user"("p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS TABLE("period_id" bigint, "sprint_id" bigint, "sprint_name" "text", "project_id" bigint, "project_name" "text", "closes_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    p.id, p.sprint_id, s.name, p.project_id, pr.name, p.closes_at
  FROM public.sprint_retro_periods p
  JOIN public.sprints s ON s.id = p.sprint_id
  JOIN public.projects pr ON pr.id = p.project_id
  WHERE p.status = 'open'
    AND p.closes_at > NOW()
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
$$;


ALTER FUNCTION "public"."sprint_retro_pending_for_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sprint_retros_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."sprint_retros_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_sprint_retro"("p_period_id" bigint, "p_respondent_name" "text", "p_emoji" "text", "p_liked" "text", "p_disliked" "text", "p_peer_strategic" "text" DEFAULT NULL::"text", "p_peer_could_give_more" "text" DEFAULT NULL::"text", "p_peer_had_it_tough" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id    UUID;
  v_retro_id   BIGINT;
  v_signals_n  INT := 0;
BEGIN
  -- El usuario autenticado siempre se resuelve desde el JWT, nunca del cliente.
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- ── 1. UPSERT del retro ────────────────────────────────────────────────────
  -- INSERT si no existe; UPDATE si ya existe. La clave de conflicto es
  -- UNIQUE(period_id, respondent_user_id) definida en la migración 020.
  --
  -- respondent_name solo se setea en el INSERT: si el usuario actualizó su
  -- nombre en Supabase Auth después de responder, preservamos el nombre que
  -- usó en la primera respuesta (consistencia histórica). El endpoint ya
  -- resuelve el nombre antes de llamar a esta función y lo pasa como parámetro.
  --
  -- Las RLS validan:
  --   INSERT: respondent_user_id = auth.uid() Y período abierto Y miembro.
  --   UPDATE: respondent_user_id = auth.uid().
  INSERT INTO public.sprint_retros (
    period_id,
    respondent_user_id,
    respondent_name,
    emoji,
    liked,
    disliked
  )
  VALUES (
    p_period_id,
    v_user_id,
    TRIM(p_respondent_name),
    p_emoji,
    TRIM(p_liked),
    TRIM(p_disliked)
  )
  ON CONFLICT (period_id, respondent_user_id) DO UPDATE
    SET emoji    = EXCLUDED.emoji,
        liked    = EXCLUDED.liked,
        disliked = EXCLUDED.disliked
        -- updated_at lo maneja el trigger sprint_retros_updated_at_trg
        -- respondent_name NO se pisa en el UPDATE (intencional, ver comentario arriba)
  RETURNING id INTO v_retro_id;

  -- ── 2. Reemplazo atómico de señales de pares ───────────────────────────────
  -- DELETE + INSERT dentro de la misma transacción: si el INSERT falla (p.ej.
  -- violación de CHECK en signal_type), Postgres hace ROLLBACK de ambas
  -- sentencias Y del UPSERT del retro. Ningún estado corrupto persiste.
  --
  -- La RLS FOR ALL de sprint_retro_peer_signals cubre DELETE e INSERT:
  -- verifica que el retro_id pertenece a un retro cuyo respondent_user_id
  -- es auth.uid() — el usuario solo puede operar sus propias señales.
  DELETE FROM public.sprint_retro_peer_signals
  WHERE retro_id = v_retro_id;

  -- Solo se insertan señales no nulas y no vacías tras trim.
  IF TRIM(COALESCE(p_peer_strategic, '')) <> '' THEN
    INSERT INTO public.sprint_retro_peer_signals (retro_id, signal_type, signaled_name)
    VALUES (v_retro_id, 'strategic_contributor', TRIM(p_peer_strategic));
    v_signals_n := v_signals_n + 1;
  END IF;

  IF TRIM(COALESCE(p_peer_could_give_more, '')) <> '' THEN
    INSERT INTO public.sprint_retro_peer_signals (retro_id, signal_type, signaled_name)
    VALUES (v_retro_id, 'could_give_more', TRIM(p_peer_could_give_more));
    v_signals_n := v_signals_n + 1;
  END IF;

  IF TRIM(COALESCE(p_peer_had_it_tough, '')) <> '' THEN
    INSERT INTO public.sprint_retro_peer_signals (retro_id, signal_type, signaled_name)
    VALUES (v_retro_id, 'had_it_tough', TRIM(p_peer_had_it_tough));
    v_signals_n := v_signals_n + 1;
  END IF;

  -- ── 3. Resultado ───────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'retro_id',      v_retro_id,
    'signals_count', v_signals_n
  );
END;
$$;


ALTER FUNCTION "public"."submit_sprint_retro"("p_period_id" bigint, "p_respondent_name" "text", "p_emoji" "text", "p_liked" "text", "p_disliked" "text", "p_peer_strategic" "text", "p_peer_could_give_more" "text", "p_peer_had_it_tough" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."super_tasks_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."super_tasks_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_my_name_across_projects"("p_name" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Nombre invalido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.project_members
  SET name = trim(p_name)
  WHERE user_id = auth.uid();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- También sincroniza en participants (donde haya auth_user_id)
  UPDATE public.participants
  SET name = trim(p_name)
  WHERE auth_user_id = auth.uid();

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."sync_my_name_across_projects"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."task_comments_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.text <> OLD.text THEN
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."task_comments_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_pulse_for_project"("p_project_id" bigint) RETURNS TABLE("sprint_id" bigint, "sprint_name" "text", "start_date" "date", "end_date" "date", "period_id" bigint, "period_status" "text", "total_respondents" integer, "emoji_breakdown" "jsonb", "strategic_warriors" "jsonb", "could_give_more" "jsonb", "had_it_tough" "jsonb", "liked_aggregate" "text", "disliked_aggregate" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH agg AS (
    SELECT
      p.sprint_id,
      s.name AS sprint_name,
      s.start_date, s.end_date,
      p.id AS period_id,
      p.status::text AS period_status,
      COUNT(DISTINCT r.id)::int AS total_respondents,
      (
        SELECT jsonb_object_agg(emoji, c) FROM (
          SELECT r2.emoji, COUNT(*) AS c FROM public.sprint_retros r2
          WHERE r2.period_id = p.id GROUP BY r2.emoji
        ) e
      ) AS emoji_breakdown,
      (
        SELECT COALESCE(jsonb_object_agg(name, c), '{}'::jsonb) FROM (
          SELECT signaled_name AS name, COUNT(*) AS c
          FROM public.sprint_retro_peer_signals s
          JOIN public.sprint_retros r2 ON r2.id = s.retro_id
          WHERE r2.period_id = p.id AND s.signal_type = 'strategic_contributor'
          GROUP BY signaled_name ORDER BY COUNT(*) DESC
        ) x
      ) AS strategic_warriors,
      (
        SELECT COALESCE(jsonb_object_agg(name, c), '{}'::jsonb) FROM (
          SELECT signaled_name AS name, COUNT(*) AS c
          FROM public.sprint_retro_peer_signals s
          JOIN public.sprint_retros r2 ON r2.id = s.retro_id
          WHERE r2.period_id = p.id AND s.signal_type = 'could_give_more'
          GROUP BY signaled_name ORDER BY COUNT(*) DESC
        ) x
      ) AS could_give_more,
      (
        SELECT COALESCE(jsonb_object_agg(name, c), '{}'::jsonb) FROM (
          SELECT signaled_name AS name, COUNT(*) AS c
          FROM public.sprint_retro_peer_signals s
          JOIN public.sprint_retros r2 ON r2.id = s.retro_id
          WHERE r2.period_id = p.id AND s.signal_type = 'had_it_tough'
          GROUP BY signaled_name ORDER BY COUNT(*) DESC
        ) x
      ) AS had_it_tough,
      string_agg(r.liked, E'\n\n') AS liked_aggregate,
      string_agg(r.disliked, E'\n\n') AS disliked_aggregate
    FROM public.sprint_retro_periods p
    JOIN public.sprints s ON s.id = p.sprint_id
    LEFT JOIN public.sprint_retros r ON r.period_id = p.id
    WHERE p.project_id = p_project_id
      AND EXISTS (
        SELECT 1 FROM public.projects pr
        WHERE pr.id = p_project_id AND pr.owner_id = auth.uid()
      )
    GROUP BY p.sprint_id, s.name, s.start_date, s.end_date, p.id, p.status
    ORDER BY s.start_date DESC
  )
  SELECT * FROM agg;
$$;


ALTER FUNCTION "public"."team_pulse_for_project"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_can_use_ia_on_project"("p_project_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    LEFT JOIN public.users_premium up ON up.user_id = p.owner_id
    LEFT JOIN public.tier_limits t ON t.tier = COALESCE(up.tier, 'free')
    WHERE p.id = p_project_id
      AND p.ia_enabled = true
      AND COALESCE(up.status, 'active') = 'active'
      AND COALESCE(up.tier, 'free') != 'free'
  );
$$;


ALTER FUNCTION "public"."user_can_use_ia_on_project"("p_project_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_ia_capacity"("p_user_id" "uuid" DEFAULT "auth"."uid"()) RETURNS TABLE("tier" "text", "display_name" "text", "status" "text", "ia_current" integer, "ia_max" integer, "total_current" integer, "total_max" integer, "can_enable_more" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  FROM up CROSS JOIN cnt;
$$;


ALTER FUNCTION "public"."user_ia_capacity"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_onboarding_touch"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."user_onboarding_touch"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."users_premium_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."users_premium_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."whoami_diag"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT jsonb_build_object(
    'uid',       auth.uid(),
    'email',     auth.email(),
    'role',      auth.role(),
    'jwt_sub',   current_setting('request.jwt.claim.sub',  true),
    'jwt_role',  current_setting('request.jwt.claim.role', true),
    'jwt_email', current_setting('request.jwt.claim.email', true)
  );
$$;


ALTER FUNCTION "public"."whoami_diag"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."_keepalive" (
    "id" integer DEFAULT 1 NOT NULL,
    "ch" character(1) DEFAULT '.'::"bpchar" NOT NULL,
    "pinged_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "_keepalive_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."_keepalive" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_user_plans" AS
 SELECT "au"."id" AS "user_id",
    "au"."email",
    COALESCE("up"."tier", 'free'::"text") AS "tier",
    COALESCE("up"."status", 'active'::"text") AS "status",
    ("up"."metadata" ->> 'grant'::"text") AS "grant_type",
    ( SELECT "count"(*) AS "count"
           FROM "public"."projects" "p"
          WHERE ("p"."owner_id" = "au"."id")) AS "owned_boards",
    "au"."created_at" AS "account_created",
    "up"."updated_at" AS "plan_updated"
   FROM ("auth"."users" "au"
     LEFT JOIN "public"."users_premium" "up" ON (("up"."user_id" = "au"."id")));


ALTER VIEW "public"."admin_user_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."api_rate_limits" (
    "bucket_key" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."api_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "key" "text" NOT NULL,
    "value" "jsonb",
    "project_id" bigint
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "id" bigint NOT NULL,
    "session_id" bigint NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "tokens_input" integer,
    "tokens_output" integer,
    "cost_usd" numeric(10,6),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."chat_messages" OWNER TO "postgres";


ALTER TABLE "public"."chat_messages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."chat_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chat_monthly_usage" (
    "project_id" bigint NOT NULL,
    "period" "date" NOT NULL,
    "used" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chat_monthly_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chat_sessions" (
    "id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "title" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "archived_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."chat_sessions" OWNER TO "postgres";


ALTER TABLE "public"."chat_sessions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."chat_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."email_config" (
    "id" integer NOT NULL,
    "emails" "jsonb" DEFAULT '[]'::"jsonb",
    "send_day" "text" DEFAULT 'monday'::"text",
    "last_sent" "text",
    "frequency" "text" DEFAULT 'weekly'::"text",
    "send_hour" integer DEFAULT 8,
    "days_back" integer DEFAULT 7,
    "days_forward" integer DEFAULT 7,
    "project_id" bigint
);


ALTER TABLE "public"."email_config" OWNER TO "postgres";


ALTER TABLE "public"."email_config" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."email_config_id_seq"
    START WITH 2
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."hub_eventos_procesados" (
    "evento_id" "text" NOT NULL,
    "evento_tipo" "text" NOT NULL,
    "procesado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "estado" "text" DEFAULT 'procesando'::"text" NOT NULL,
    "actualizado_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "hub_eventos_procesados_estado_check" CHECK (("estado" = ANY (ARRAY['procesando'::"text", 'procesado'::"text", 'revertido'::"text"])))
);


ALTER TABLE "public"."hub_eventos_procesados" OWNER TO "postgres";


COMMENT ON TABLE "public"."hub_eventos_procesados" IS 'Candado de idempotencia con máquina de estados para eventos entrantes del Hub (cable Hub→w-planner). La RPC hub_reclamar_evento garantiza que cada evento_id se procesa exactamente una vez. El self-healing (reclamo de eventos ''procesando'' vencidos >15 min) evita que un worker muerto deje el candado permanente.';



COMMENT ON COLUMN "public"."hub_eventos_procesados"."estado" IS 'procesando = worker activo; procesado = éxito (terminal); revertido = falló, reintentable.';



COMMENT ON COLUMN "public"."hub_eventos_procesados"."actualizado_en" IS 'Timestamp de la última transición de estado. La RPC hub_reclamar_evento lo usa para detectar eventos procesando vencidos (>15 min) y reclamarlos (self-healing).';



CREATE TABLE IF NOT EXISTS "public"."hub_eventos_sin_resolver" (
    "evento_id" "text" NOT NULL,
    "evento_tipo" "text",
    "cliente_email" "text",
    "plan_codigo" "text",
    "payload" "jsonb",
    "recibido_en" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resuelto" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."hub_eventos_sin_resolver" OWNER TO "postgres";


COMMENT ON TABLE "public"."hub_eventos_sin_resolver" IS 'Parqueo de eventos Hub→w-planner cuyo cliente_email no se encontró en auth.users o cuyo plan_codigo es desconocido. Permite reconciliación manual sin perder datos. El campo `resuelto` se marca a true cuando un administrador investiga y corrige la discrepancia. NOTA PII: cliente_email vive SOLO en su columna; el JSONB payload se almacena sin ese campo para evitar duplicar PII (service_role-only).';



COMMENT ON COLUMN "public"."hub_eventos_sin_resolver"."cliente_email" IS 'PII necesaria para reconciliación manual. Se almacena UNA VEZ aquí; el JSONB payload NO incluye esta clave para no duplicar.';



COMMENT ON COLUMN "public"."hub_eventos_sin_resolver"."resuelto" IS 'false = pendiente de reconciliación manual; true = investigado y resuelto.';



CREATE TABLE IF NOT EXISTS "public"."hub_outbox" (
    "id" bigint NOT NULL,
    "mp_payment_id" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "hub_outbox_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'sent'::"text", 'failed'::"text", 'dead'::"text"])))
);


ALTER TABLE "public"."hub_outbox" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."hub_outbox_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."hub_outbox_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."hub_outbox_id_seq" OWNED BY "public"."hub_outbox"."id";



CREATE TABLE IF NOT EXISTS "public"."indicators" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "project_id" bigint
);


ALTER TABLE "public"."indicators" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."key_results" (
    "id" bigint NOT NULL,
    "okr_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "target_value" numeric DEFAULT 100,
    "current_value" numeric DEFAULT 0,
    "unit" "text" DEFAULT '%'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "project_id" bigint
);


ALTER TABLE "public"."key_results" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."key_results_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."key_results_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."key_results_id_seq" OWNED BY "public"."key_results"."id";



CREATE TABLE IF NOT EXISTS "public"."mp_webhook_events" (
    "event_id" "text" NOT NULL,
    "event_type" "text",
    "data_id" "text",
    "processed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'processed'::"text" NOT NULL,
    CONSTRAINT "mp_webhook_events_status_check" CHECK (("status" = ANY (ARRAY['processing'::"text", 'processed'::"text"])))
);


ALTER TABLE "public"."mp_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" bigint NOT NULL,
    "project_id" bigint,
    "user_name" "text" DEFAULT ''::"text",
    "message" "text" NOT NULL,
    "type" "text" DEFAULT 'info'::"text",
    "task_id" bigint,
    "read_by" "text"[] DEFAULT '{}'::"text"[],
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."notifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."notifications_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."notifications_id_seq" OWNED BY "public"."notifications"."id";



CREATE TABLE IF NOT EXISTS "public"."okrs" (
    "id" bigint NOT NULL,
    "project_id" bigint,
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    CONSTRAINT "okrs_dates_check" CHECK (("end_date" >= "start_date"))
);


ALTER TABLE "public"."okrs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."okrs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."okrs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."okrs_id_seq" OWNED BY "public"."okrs"."id";



CREATE TABLE IF NOT EXISTS "public"."participants" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "is_super_user" boolean DEFAULT false,
    "project_id" bigint,
    "auth_user_id" "uuid",
    "email" "text" DEFAULT ''::"text",
    "is_legacy" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" DEFAULT ''::"text",
    "invited_at" timestamp with time zone DEFAULT "now"(),
    "user_id" "uuid",
    "role" "text" DEFAULT 'participant'::"text" NOT NULL,
    CONSTRAINT "project_members_role_check" CHECK (("role" = ANY (ARRAY['po'::"text", 'scrum_master'::"text", 'participant'::"text"])))
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."project_members_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."project_members_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."project_members_id_seq" OWNED BY "public"."project_members"."id";



CREATE TABLE IF NOT EXISTS "public"."project_templates" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "tasks_schema" "jsonb" DEFAULT '[]'::"jsonb",
    "indicators" "jsonb" DEFAULT '[]'::"jsonb",
    "is_builtin" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."project_templates" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."project_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."project_templates_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."project_templates_id_seq" OWNED BY "public"."project_templates"."id";



CREATE SEQUENCE IF NOT EXISTS "public"."projects_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."projects_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."projects_id_seq" OWNED BY "public"."projects"."id";



CREATE TABLE IF NOT EXISTS "public"."report_configs" (
    "id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "report_type" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "recipients" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "schedule" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "window_cfg" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_sent" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "report_configs_report_type_check" CHECK (("report_type" = ANY (ARRAY['scrum'::"text", 'weekly_po'::"text", 'monthly_team'::"text"])))
);


ALTER TABLE "public"."report_configs" OWNER TO "postgres";


ALTER TABLE "public"."report_configs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."report_configs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."report_history" (
    "id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "report_type" "text" NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "recipients" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "plain_text" "text" DEFAULT ''::"text" NOT NULL,
    "html" "text",
    "model_used" "text",
    "tokens_input" integer,
    "tokens_output" integer,
    "cost_usd" numeric(10,6),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "report_history_report_type_check" CHECK (("report_type" = ANY (ARRAY['scrum'::"text", 'weekly_po'::"text", 'monthly_team'::"text"]))),
    CONSTRAINT "report_history_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'stored'::"text", 'failed'::"text", 'truncated'::"text"])))
);


ALTER TABLE "public"."report_history" OWNER TO "postgres";


ALTER TABLE "public"."report_history" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."report_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sprint_retro_peer_signals" (
    "id" bigint NOT NULL,
    "retro_id" bigint NOT NULL,
    "signal_type" "text" NOT NULL,
    "signaled_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sprint_retro_peer_signals_signal_type_check" CHECK (("signal_type" = ANY (ARRAY['strategic_contributor'::"text", 'could_give_more'::"text", 'had_it_tough'::"text"])))
);


ALTER TABLE "public"."sprint_retro_peer_signals" OWNER TO "postgres";


ALTER TABLE "public"."sprint_retro_peer_signals" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sprint_retro_peer_signals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sprint_retro_periods" (
    "id" bigint NOT NULL,
    "sprint_id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "opened_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closes_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "trigger" "text" DEFAULT 'sprint_closed'::"text" NOT NULL,
    "notifications_sent" boolean DEFAULT false NOT NULL,
    "reminder_sent_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "sprint_retro_periods_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"]))),
    CONSTRAINT "sprint_retro_periods_trigger_check" CHECK (("trigger" = ANY (ARRAY['sprint_closed'::"text", 'end_date_passed'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."sprint_retro_periods" OWNER TO "postgres";


ALTER TABLE "public"."sprint_retro_periods" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sprint_retro_periods_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sprint_retros" (
    "id" bigint NOT NULL,
    "period_id" bigint NOT NULL,
    "respondent_user_id" "uuid",
    "respondent_name" "text" NOT NULL,
    "emoji" "text" NOT NULL,
    "liked" "text" NOT NULL,
    "disliked" "text" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sprint_retros_disliked_check" CHECK ((("length"("disliked") > 0) AND ("length"("disliked") <= 2000))),
    CONSTRAINT "sprint_retros_emoji_check" CHECK (("emoji" = ANY (ARRAY['😄'::"text", '😐'::"text", '😟'::"text", '😡'::"text", '🥱'::"text", '🔥'::"text", '💪'::"text", '😴'::"text", '😍'::"text", '😅'::"text", '🤝'::"text", '🌟'::"text"]))),
    CONSTRAINT "sprint_retros_liked_check" CHECK ((("length"("liked") > 0) AND ("length"("liked") <= 2000)))
);


ALTER TABLE "public"."sprint_retros" OWNER TO "postgres";


ALTER TABLE "public"."sprint_retros" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."sprint_retros_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sprints" (
    "id" bigint NOT NULL,
    "project_id" bigint,
    "name" "text" NOT NULL,
    "goal" "text" DEFAULT ''::"text",
    "start_date" "date",
    "end_date" "date",
    "status" "text" DEFAULT 'planning'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."sprints" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."sprints_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."sprints_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."sprints_id_seq" OWNED BY "public"."sprints"."id";



CREATE TABLE IF NOT EXISTS "public"."super_tasks" (
    "id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "target_aporte" numeric DEFAULT 100 NOT NULL,
    "color" "text" DEFAULT '#542c9c'::"text" NOT NULL,
    "icon" "text" DEFAULT '🎯'::"text" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "super_tasks_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'closed'::"text", 'paused'::"text"]))),
    CONSTRAINT "super_tasks_target_aporte_check" CHECK (("target_aporte" > (0)::numeric)),
    CONSTRAINT "super_tasks_title_check" CHECK ((("length"("title") > 0) AND ("length"("title") <= 200)))
);


ALTER TABLE "public"."super_tasks" OWNER TO "postgres";


ALTER TABLE "public"."super_tasks" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."super_tasks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."task_comments" (
    "id" bigint NOT NULL,
    "task_id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "author_user_id" "uuid",
    "author_name" "text" NOT NULL,
    "text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "task_comments_text_check" CHECK ((("length"("text") > 0) AND ("length"("text") <= 4000)))
);


ALTER TABLE "public"."task_comments" OWNER TO "postgres";


ALTER TABLE "public"."task_comments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."task_comments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."task_field_defs" (
    "id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "type" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "position" integer DEFAULT 0,
    "required" boolean DEFAULT false,
    "show_on_card" boolean DEFAULT false,
    "builtin" boolean DEFAULT false,
    "deleted_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "task_field_defs_key_format" CHECK (("key" ~ '^[a-z][a-z0-9_]{0,49}$'::"text")),
    CONSTRAINT "task_field_defs_key_not_reserved" CHECK (("key" <> ALL (ARRAY['id'::"text", 'project_id'::"text", 'title'::"text", 'status'::"text", 'type'::"text", 'responsible'::"text", 'comments'::"text", 'subtasks'::"text", 'indicators'::"text", 'indicator'::"text", 'start_date'::"text", 'end_date'::"text", 'estimated_time'::"text", 'difficulty'::"text", 'strategic_value'::"text", 'expected_delivery'::"text", 'progress_percent'::"text", 'dependent_task'::"text", 'validation_close'::"text", 'ext_progress1'::"text", 'ext_progress2'::"text", 'aporte_snapshot'::"text", 'finalized_at'::"text", 'dimension_values'::"text", 'kr_id'::"text", 'sprint_id'::"text", 'created_at'::"text", 'updated_at'::"text", 'closed_at'::"text", 'last_modified_by'::"text", 'custom_fields'::"text", 'createdat'::"text", 'updatedat'::"text", 'closedat'::"text", 'lastmodifiedby'::"text", 'customfields'::"text"]))),
    CONSTRAINT "task_field_defs_type_check" CHECK (("type" = ANY (ARRAY['text'::"text", 'textarea'::"text", 'date'::"text", 'select'::"text", 'multiselect'::"text", 'subitems'::"text", 'auto'::"text"])))
);


ALTER TABLE "public"."task_field_defs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."task_field_defs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."task_field_defs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."task_field_defs_id_seq" OWNED BY "public"."task_field_defs"."id";



CREATE TABLE IF NOT EXISTS "public"."task_history" (
    "id" bigint NOT NULL,
    "task_id" bigint NOT NULL,
    "project_id" bigint,
    "changed_by" "text" DEFAULT ''::"text",
    "field_name" "text" NOT NULL,
    "old_value" "text",
    "new_value" "text",
    "changed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."task_history" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."task_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."task_history_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."task_history_id_seq" OWNED BY "public"."task_history"."id";



CREATE TABLE IF NOT EXISTS "public"."task_super_links" (
    "task_id" bigint NOT NULL,
    "super_task_id" bigint NOT NULL,
    "weight" numeric DEFAULT 1.0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "task_super_links_weight_check" CHECK ((("weight" > (0)::numeric) AND ("weight" <= (5)::numeric)))
);


ALTER TABLE "public"."task_super_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_types" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "project_id" bigint
);


ALTER TABLE "public"."task_types" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."task_types_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."task_types_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."task_types_id_seq" OWNED BY "public"."task_types"."id";



CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" integer NOT NULL,
    "created_at_colombia" "text",
    "indicator" "text" DEFAULT ''::"text",
    "title" "text" DEFAULT ''::"text",
    "start_date" "text" DEFAULT ''::"text",
    "end_date" "text" DEFAULT ''::"text",
    "estimated_time" integer DEFAULT 5,
    "type" "text" DEFAULT 'Operativa'::"text",
    "status" "text" DEFAULT 'Sin iniciar'::"text",
    "validation_close" "text",
    "ext_progress1" "text" DEFAULT ''::"text",
    "ext_progress2" "text" DEFAULT ''::"text",
    "difficulty" integer DEFAULT 5,
    "strategic_value" integer DEFAULT 5,
    "expected_delivery" "text" DEFAULT ''::"text",
    "responsible" "text" DEFAULT ''::"text",
    "comments" "text" DEFAULT ''::"text",
    "progress_percent" numeric DEFAULT 0,
    "subtasks" "jsonb" DEFAULT '[]'::"jsonb",
    "dependent_task" "text" DEFAULT ''::"text",
    "aporte_snapshot" numeric,
    "inserted_at" timestamp with time zone DEFAULT "now"(),
    "finalized_at" "text",
    "subtasks_done" "jsonb" DEFAULT '[]'::"jsonb",
    "indicators" "jsonb" DEFAULT '[]'::"jsonb",
    "project_id" bigint,
    "dimension_values" "jsonb" DEFAULT '{}'::"jsonb",
    "kr_id" bigint,
    "sprint_id" bigint,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "closed_at" timestamp with time zone,
    "last_modified_by" "text" DEFAULT ''::"text",
    "custom_fields" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."tasks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."tasks_id_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tier_limits" (
    "tier" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "ia_projects" integer NOT NULL,
    "total_projects" integer NOT NULL,
    "price_cop" integer NOT NULL,
    "mp_plan_id" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "features" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "chat_msg_quota" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "tier_limits_ia_projects_check" CHECK (("ia_projects" >= 0)),
    CONSTRAINT "tier_limits_price_cop_check" CHECK (("price_cop" >= 0)),
    CONSTRAINT "tier_limits_total_projects_check" CHECK (("total_projects" >= 0))
);


ALTER TABLE "public"."tier_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_evolutions" (
    "id" bigint NOT NULL,
    "project_id" bigint NOT NULL,
    "period_start" "date" NOT NULL,
    "period_end" "date" NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'stored'::"text" NOT NULL,
    "cards" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "cell_suggestions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "plain_text" "text" DEFAULT ''::"text" NOT NULL,
    "html" "text",
    "model_used" "text",
    "tokens_input" integer,
    "tokens_output" integer,
    "cost_usd" numeric(10,6),
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "user_evolutions_status_check" CHECK (("status" = ANY (ARRAY['stored'::"text", 'failed'::"text", 'truncated'::"text"])))
);


ALTER TABLE "public"."user_evolutions" OWNER TO "postgres";


ALTER TABLE "public"."user_evolutions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_evolutions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_onboarding" (
    "user_id" "uuid" NOT NULL,
    "role" "text",
    "current_step" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "skipped" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_onboarding_role_check" CHECK (("role" = ANY (ARRAY['scrum_master'::"text", 'po'::"text", 'participant'::"text"])))
);


ALTER TABLE "public"."user_onboarding" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_referrals" (
    "user_id" "uuid" NOT NULL,
    "referral_code" "text" NOT NULL,
    "source" "text",
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_referrals" OWNER TO "postgres";


ALTER TABLE ONLY "public"."hub_outbox" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."hub_outbox_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."key_results" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."key_results_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."notifications" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."notifications_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."okrs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."okrs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."project_members" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."project_members_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."project_templates" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."project_templates_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."projects" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."projects_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."sprints" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."sprints_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."task_field_defs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."task_field_defs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."task_history" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."task_history_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."task_types" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."task_types_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."_keepalive"
    ADD CONSTRAINT "_keepalive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."api_rate_limits"
    ADD CONSTRAINT "api_rate_limits_pkey" PRIMARY KEY ("bucket_key", "window_start");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_monthly_usage"
    ADD CONSTRAINT "chat_monthly_usage_pkey" PRIMARY KEY ("project_id", "period");



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_project_id_owner_user_id_archived_at_key" UNIQUE ("project_id", "owner_user_id", "archived_at");



ALTER TABLE ONLY "public"."email_config"
    ADD CONSTRAINT "email_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_config"
    ADD CONSTRAINT "email_config_project_id_key" UNIQUE ("project_id");



ALTER TABLE ONLY "public"."hub_eventos_procesados"
    ADD CONSTRAINT "hub_eventos_procesados_pkey" PRIMARY KEY ("evento_id");



ALTER TABLE ONLY "public"."hub_eventos_sin_resolver"
    ADD CONSTRAINT "hub_eventos_sin_resolver_pkey" PRIMARY KEY ("evento_id");



ALTER TABLE ONLY "public"."hub_outbox"
    ADD CONSTRAINT "hub_outbox_mp_payment_id_unique" UNIQUE ("mp_payment_id");



ALTER TABLE ONLY "public"."hub_outbox"
    ADD CONSTRAINT "hub_outbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."indicators"
    ADD CONSTRAINT "indicators_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."key_results"
    ADD CONSTRAINT "key_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mp_webhook_events"
    ADD CONSTRAINT "mp_webhook_events_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."okrs"
    ADD CONSTRAINT "okrs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_email_key" UNIQUE ("project_id", "email");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_invite_code_key" UNIQUE ("invite_code");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_configs"
    ADD CONSTRAINT "report_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_configs"
    ADD CONSTRAINT "report_configs_project_id_report_type_key" UNIQUE ("project_id", "report_type");



ALTER TABLE ONLY "public"."report_history"
    ADD CONSTRAINT "report_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sprint_retro_peer_signals"
    ADD CONSTRAINT "sprint_retro_peer_signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sprint_retro_peer_signals"
    ADD CONSTRAINT "sprint_retro_peer_signals_retro_id_signal_type_key" UNIQUE ("retro_id", "signal_type");



ALTER TABLE ONLY "public"."sprint_retro_periods"
    ADD CONSTRAINT "sprint_retro_periods_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sprint_retro_periods"
    ADD CONSTRAINT "sprint_retro_periods_sprint_id_key" UNIQUE ("sprint_id");



ALTER TABLE ONLY "public"."sprint_retros"
    ADD CONSTRAINT "sprint_retros_period_id_respondent_user_id_key" UNIQUE ("period_id", "respondent_user_id");



ALTER TABLE ONLY "public"."sprint_retros"
    ADD CONSTRAINT "sprint_retros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sprints"
    ADD CONSTRAINT "sprints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."super_tasks"
    ADD CONSTRAINT "super_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_field_defs"
    ADD CONSTRAINT "task_field_defs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_history"
    ADD CONSTRAINT "task_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_super_links"
    ADD CONSTRAINT "task_super_links_pkey" PRIMARY KEY ("task_id", "super_task_id");



ALTER TABLE ONLY "public"."task_types"
    ADD CONSTRAINT "task_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tier_limits"
    ADD CONSTRAINT "tier_limits_pkey" PRIMARY KEY ("tier");



ALTER TABLE ONLY "public"."user_evolutions"
    ADD CONSTRAINT "user_evolutions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_evolutions"
    ADD CONSTRAINT "user_evolutions_project_id_period_start_period_end_key" UNIQUE ("project_id", "period_start", "period_end");



ALTER TABLE ONLY "public"."user_onboarding"
    ADD CONSTRAINT "user_onboarding_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_referrals"
    ADD CONSTRAINT "user_referrals_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."users_premium"
    ADD CONSTRAINT "users_premium_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "chat_messages_session_idx" ON "public"."chat_messages" USING "btree" ("session_id", "created_at");



CREATE INDEX "chat_sessions_project_idx" ON "public"."chat_sessions" USING "btree" ("project_id", "owner_user_id") WHERE ("archived_at" IS NULL);



CREATE INDEX "email_config_project_id_idx" ON "public"."email_config" USING "btree" ("project_id");



CREATE INDEX "hub_eventos_procesados_inflight_idx" ON "public"."hub_eventos_procesados" USING "btree" ("actualizado_en") WHERE ("estado" = 'procesando'::"text");



CREATE INDEX "hub_outbox_dead_idx" ON "public"."hub_outbox" USING "btree" ("created_at") WHERE ("status" = 'dead'::"text");



CREATE INDEX "hub_outbox_drain_idx" ON "public"."hub_outbox" USING "btree" ("status", "next_attempt_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'failed'::"text", 'processing'::"text"]));



CREATE INDEX "indicators_project_id_idx" ON "public"."indicators" USING "btree" ("project_id");



CREATE INDEX "key_results_project_id_idx" ON "public"."key_results" USING "btree" ("project_id");



CREATE INDEX "mp_webhook_events_event_id_idx" ON "public"."mp_webhook_events" USING "btree" ("event_id");



CREATE INDEX "mp_webhook_events_processed_at_idx" ON "public"."mp_webhook_events" USING "btree" ("processed_at");



CREATE INDEX "okrs_dates_idx" ON "public"."okrs" USING "btree" ("project_id", "start_date", "end_date");



CREATE INDEX "okrs_project_id_idx" ON "public"."okrs" USING "btree" ("project_id");



CREATE INDEX "participants_project_id_idx" ON "public"."participants" USING "btree" ("project_id");



CREATE INDEX "report_configs_project_idx" ON "public"."report_configs" USING "btree" ("project_id");



CREATE INDEX "report_history_project_type_idx" ON "public"."report_history" USING "btree" ("project_id", "report_type", "period_end" DESC);



CREATE INDEX "sprint_retro_peer_signals_retro_idx" ON "public"."sprint_retro_peer_signals" USING "btree" ("retro_id");



CREATE INDEX "sprint_retro_periods_project_idx" ON "public"."sprint_retro_periods" USING "btree" ("project_id", "status");



CREATE INDEX "sprint_retros_period_idx" ON "public"."sprint_retros" USING "btree" ("period_id");



CREATE INDEX "sprints_project_id_idx" ON "public"."sprints" USING "btree" ("project_id");



CREATE INDEX "super_tasks_project_idx" ON "public"."super_tasks" USING "btree" ("project_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "task_comments_author_idx" ON "public"."task_comments" USING "btree" ("author_user_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "task_comments_project_idx" ON "public"."task_comments" USING "btree" ("project_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "task_comments_task_idx" ON "public"."task_comments" USING "btree" ("task_id", "created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "task_field_defs_active_idx" ON "public"."task_field_defs" USING "btree" ("project_id", "position") WHERE ("deleted_at" IS NULL);



CREATE INDEX "task_field_defs_project_idx" ON "public"."task_field_defs" USING "btree" ("project_id");



CREATE UNIQUE INDEX "task_field_defs_project_key_uidx" ON "public"."task_field_defs" USING "btree" ("project_id", "key") WHERE ("deleted_at" IS NULL);



CREATE INDEX "task_super_links_super_idx" ON "public"."task_super_links" USING "btree" ("super_task_id");



CREATE UNIQUE INDEX "task_types_project_name_uidx" ON "public"."task_types" USING "btree" (COALESCE("project_id", (0)::bigint), "lower"("name"));



CREATE INDEX "tasks_project_id_idx" ON "public"."tasks" USING "btree" ("project_id");



CREATE INDEX "user_evolutions_project_idx" ON "public"."user_evolutions" USING "btree" ("project_id", "period_end" DESC);



CREATE INDEX "users_premium_mp_idx" ON "public"."users_premium" USING "btree" ("mp_preapproval_id") WHERE ("mp_preapproval_id" IS NOT NULL);



CREATE INDEX "users_premium_status_idx" ON "public"."users_premium" USING "btree" ("status");



CREATE OR REPLACE TRIGGER "chat_message_touch_session_trg" AFTER INSERT ON "public"."chat_messages" FOR EACH ROW EXECUTE FUNCTION "public"."chat_session_touch"();



CREATE OR REPLACE TRIGGER "hub_outbox_updated_at" BEFORE UPDATE ON "public"."hub_outbox" FOR EACH ROW EXECUTE FUNCTION "public"."hub_outbox_set_updated_at"();



CREATE OR REPLACE TRIGGER "projects_enforce_limit" BEFORE INSERT ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_project_limit"();



CREATE OR REPLACE TRIGGER "report_configs_updated_at_trg" BEFORE UPDATE ON "public"."report_configs" FOR EACH ROW EXECUTE FUNCTION "public"."report_configs_set_updated_at"();



CREATE OR REPLACE TRIGGER "sprint_retros_updated_at_trg" BEFORE UPDATE ON "public"."sprint_retros" FOR EACH ROW EXECUTE FUNCTION "public"."sprint_retros_set_updated_at"();



CREATE OR REPLACE TRIGGER "super_tasks_updated_at_trg" BEFORE UPDATE ON "public"."super_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."super_tasks_set_updated_at"();



CREATE OR REPLACE TRIGGER "task_comments_updated_at_trg" BEFORE UPDATE ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "public"."task_comments_set_updated_at"();



CREATE OR REPLACE TRIGGER "task_field_defs_touch_updated_at" BEFORE UPDATE ON "public"."task_field_defs" FOR EACH ROW EXECUTE FUNCTION "public"."set_task_field_defs_updated_at"();



CREATE OR REPLACE TRIGGER "tasks_set_auto_fields" BEFORE INSERT OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_task_auto_fields"();



CREATE OR REPLACE TRIGGER "user_onboarding_touch_trg" BEFORE UPDATE ON "public"."user_onboarding" FOR EACH ROW EXECUTE FUNCTION "public"."user_onboarding_touch"();



CREATE OR REPLACE TRIGGER "users_premium_updated_at_trg" BEFORE UPDATE ON "public"."users_premium" FOR EACH ROW EXECUTE FUNCTION "public"."users_premium_set_updated_at"();



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."chat_messages"
    ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_monthly_usage"
    ADD CONSTRAINT "chat_monthly_usage_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_sessions"
    ADD CONSTRAINT "chat_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."email_config"
    ADD CONSTRAINT "email_config_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."indicators"
    ADD CONSTRAINT "indicators_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."key_results"
    ADD CONSTRAINT "key_results_okr_id_fkey" FOREIGN KEY ("okr_id") REFERENCES "public"."okrs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."key_results"
    ADD CONSTRAINT "key_results_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."okrs"
    ADD CONSTRAINT "okrs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_configs"
    ADD CONSTRAINT "report_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_history"
    ADD CONSTRAINT "report_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sprint_retro_peer_signals"
    ADD CONSTRAINT "sprint_retro_peer_signals_retro_id_fkey" FOREIGN KEY ("retro_id") REFERENCES "public"."sprint_retros"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sprint_retro_periods"
    ADD CONSTRAINT "sprint_retro_periods_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sprint_retro_periods"
    ADD CONSTRAINT "sprint_retro_periods_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sprint_retros"
    ADD CONSTRAINT "sprint_retros_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "public"."sprint_retro_periods"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sprint_retros"
    ADD CONSTRAINT "sprint_retros_respondent_user_id_fkey" FOREIGN KEY ("respondent_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sprints"
    ADD CONSTRAINT "sprints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."super_tasks"
    ADD CONSTRAINT "super_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_field_defs"
    ADD CONSTRAINT "task_field_defs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_history"
    ADD CONSTRAINT "task_history_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_super_links"
    ADD CONSTRAINT "task_super_links_super_task_id_fkey" FOREIGN KEY ("super_task_id") REFERENCES "public"."super_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_super_links"
    ADD CONSTRAINT "task_super_links_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_types"
    ADD CONSTRAINT "task_types_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_kr_id_fkey" FOREIGN KEY ("kr_id") REFERENCES "public"."key_results"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "public"."sprints"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_evolutions"
    ADD CONSTRAINT "user_evolutions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_onboarding"
    ADD CONSTRAINT "user_onboarding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_referrals"
    ADD CONSTRAINT "user_referrals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users_premium"
    ADD CONSTRAINT "users_premium_tier_fkey" FOREIGN KEY ("tier") REFERENCES "public"."tier_limits"("tier");



ALTER TABLE ONLY "public"."users_premium"
    ADD CONSTRAINT "users_premium_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."_keepalive" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allow all" ON "public"."email_config" TO "anon" USING (true) WITH CHECK (true);



ALTER TABLE "public"."api_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_config_project_owner_write" ON "public"."app_config" FOR UPDATE TO "authenticated" USING ((("project_id" IS NOT NULL) AND "public"."is_project_owner"("project_id"))) WITH CHECK ((("project_id" IS NOT NULL) AND "public"."is_project_owner"("project_id")));



CREATE POLICY "app_config_project_read" ON "public"."app_config" FOR SELECT TO "authenticated" USING ((("project_id" IS NULL) OR "public"."is_project_member"("project_id")));



ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_messages_session_owner" ON "public"."chat_messages" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."chat_sessions" "s"
  WHERE (("s"."id" = "chat_messages"."session_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."chat_monthly_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chat_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_sessions_owner_all" ON "public"."chat_sessions" TO "authenticated" USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



ALTER TABLE "public"."email_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "email_config_owner_all" ON "public"."email_config" TO "authenticated" USING ("public"."is_project_owner"("project_id")) WITH CHECK ("public"."is_project_owner"("project_id"));



ALTER TABLE "public"."hub_eventos_procesados" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hub_eventos_sin_resolver" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hub_outbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."indicators" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "indicators_member_select" ON "public"."indicators" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "indicators_owner_all" ON "public"."indicators" TO "authenticated" USING ("public"."is_project_owner"("project_id")) WITH CHECK ("public"."is_project_owner"("project_id"));



ALTER TABLE "public"."key_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "key_results_member_select" ON "public"."key_results" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "key_results_role_delete" ON "public"."key_results" FOR DELETE TO "authenticated" USING ("public"."has_project_role"("project_id", ARRAY['po'::"text", 'scrum_master'::"text"]));



CREATE POLICY "key_results_role_insert" ON "public"."key_results" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_project_role"("project_id", ARRAY['po'::"text", 'scrum_master'::"text"]));



CREATE POLICY "key_results_role_update" ON "public"."key_results" FOR UPDATE TO "authenticated" USING ("public"."has_project_role"("project_id", ARRAY['po'::"text", 'scrum_master'::"text"])) WITH CHECK ("public"."has_project_role"("project_id", ARRAY['po'::"text", 'scrum_master'::"text"]));



ALTER TABLE "public"."mp_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_member_all" ON "public"."notifications" TO "authenticated" USING ("public"."is_project_member"("project_id")) WITH CHECK ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."okrs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "okrs_member_select" ON "public"."okrs" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "okrs_role_delete" ON "public"."okrs" FOR DELETE TO "authenticated" USING ("public"."has_project_role"("project_id", ARRAY['po'::"text", 'scrum_master'::"text"]));



CREATE POLICY "okrs_role_insert" ON "public"."okrs" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_project_role"("project_id", ARRAY['po'::"text", 'scrum_master'::"text"]));



CREATE POLICY "okrs_role_update" ON "public"."okrs" FOR UPDATE TO "authenticated" USING ("public"."has_project_role"("project_id", ARRAY['po'::"text", 'scrum_master'::"text"])) WITH CHECK ("public"."has_project_role"("project_id", ARRAY['po'::"text", 'scrum_master'::"text"]));



ALTER TABLE "public"."participants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "participants_member_select" ON "public"."participants" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "participants_owner_all" ON "public"."participants" TO "authenticated" USING ("public"."is_project_owner"("project_id")) WITH CHECK ("public"."is_project_owner"("project_id"));



ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_members_delete_owner" ON "public"."project_members" FOR DELETE TO "authenticated" USING (("public"."is_project_owner"("project_id") OR ("user_id" = "auth"."uid"()) OR ("lower"("email") = "lower"(COALESCE("auth"."email"(), ''::"text")))));



CREATE POLICY "project_members_insert_owner" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_project_owner"("project_id"));



CREATE POLICY "project_members_select_member" ON "public"."project_members" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "project_members_update_owner" ON "public"."project_members" FOR UPDATE TO "authenticated" USING ("public"."is_project_owner"("project_id")) WITH CHECK ("public"."is_project_owner"("project_id"));



ALTER TABLE "public"."project_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_templates_read" ON "public"."project_templates" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_delete_owner" ON "public"."projects" FOR DELETE TO "authenticated" USING ("public"."is_project_owner"("id"));



CREATE POLICY "projects_insert_owner" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "projects_select_member" ON "public"."projects" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("id"));



CREATE POLICY "projects_update_owner" ON "public"."projects" FOR UPDATE TO "authenticated" USING ("public"."is_project_owner"("id")) WITH CHECK ("public"."is_project_owner"("id"));



CREATE POLICY "public_all_config" ON "public"."app_config" USING (true) WITH CHECK (true);



CREATE POLICY "public_all_indicators" ON "public"."indicators" USING (true) WITH CHECK (true);



CREATE POLICY "public_all_participants" ON "public"."participants" USING (true) WITH CHECK (true);



CREATE POLICY "public_all_tasks" ON "public"."tasks" USING (true) WITH CHECK (true);



ALTER TABLE "public"."report_configs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "report_configs_owner_all" ON "public"."report_configs" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "report_configs"."project_id") AND ("p"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "report_configs"."project_id") AND ("p"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."report_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "report_history_owner_select" ON "public"."report_history" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "report_history"."project_id") AND ("p"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."sprint_retro_peer_signals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sprint_retro_peer_signals_own" ON "public"."sprint_retro_peer_signals" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sprint_retros" "r"
  WHERE (("r"."id" = "sprint_retro_peer_signals"."retro_id") AND ("r"."respondent_user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sprint_retros" "r"
  WHERE (("r"."id" = "sprint_retro_peer_signals"."retro_id") AND ("r"."respondent_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."sprint_retro_periods" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sprint_retro_periods_member_select" ON "public"."sprint_retro_periods" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "sprint_retro_periods"."project_id") AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "m"
          WHERE (("m"."project_id" = "p"."id") AND ("m"."user_id" = "auth"."uid"())))))))));



ALTER TABLE "public"."sprint_retros" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sprint_retros_member_insert" ON "public"."sprint_retros" FOR INSERT TO "authenticated" WITH CHECK ((("respondent_user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM ("public"."sprint_retro_periods" "p"
     JOIN "public"."projects" "pr" ON (("pr"."id" = "p"."project_id")))
  WHERE (("p"."id" = "sprint_retros"."period_id") AND ("p"."status" = 'open'::"text") AND (("pr"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "m"
          WHERE (("m"."project_id" = "pr"."id") AND ("m"."user_id" = "auth"."uid"()))))))))));



CREATE POLICY "sprint_retros_own_or_owner" ON "public"."sprint_retros" FOR SELECT TO "authenticated" USING ((("respondent_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."sprint_retro_periods" "p"
     JOIN "public"."projects" "pr" ON (("pr"."id" = "p"."project_id")))
  WHERE (("p"."id" = "sprint_retros"."period_id") AND ("pr"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "sprint_retros_own_update" ON "public"."sprint_retros" FOR UPDATE TO "authenticated" USING (("respondent_user_id" = "auth"."uid"())) WITH CHECK (("respondent_user_id" = "auth"."uid"()));



ALTER TABLE "public"."sprints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sprints_member_select" ON "public"."sprints" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "sprints_role_delete" ON "public"."sprints" FOR DELETE TO "authenticated" USING ("public"."has_project_role"("project_id", ARRAY['scrum_master'::"text"]));



CREATE POLICY "sprints_role_insert" ON "public"."sprints" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_project_role"("project_id", ARRAY['scrum_master'::"text"]));



CREATE POLICY "sprints_role_update" ON "public"."sprints" FOR UPDATE TO "authenticated" USING ("public"."has_project_role"("project_id", ARRAY['scrum_master'::"text"])) WITH CHECK ("public"."has_project_role"("project_id", ARRAY['scrum_master'::"text"]));



ALTER TABLE "public"."super_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "super_tasks_owner_all" ON "public"."super_tasks" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "super_tasks"."project_id") AND ("p"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "super_tasks"."project_id") AND ("p"."owner_id" = "auth"."uid"())))));



CREATE POLICY "super_tasks_select" ON "public"."super_tasks" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "super_tasks"."project_id") AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "m"
          WHERE (("m"."project_id" = "p"."id") AND ("m"."user_id" = "auth"."uid"())))))))));



ALTER TABLE "public"."task_comments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_comments_delete" ON "public"."task_comments" FOR DELETE TO "authenticated" USING ((("author_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_comments"."project_id") AND ("p"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "task_comments_insert" ON "public"."task_comments" FOR INSERT TO "authenticated" WITH CHECK ((("author_user_id" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_comments"."project_id") AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "m"
          WHERE (("m"."project_id" = "p"."id") AND ("m"."user_id" = "auth"."uid"()))))))))));



CREATE POLICY "task_comments_select" ON "public"."task_comments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "task_comments"."project_id") AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "m"
          WHERE (("m"."project_id" = "p"."id") AND ("m"."user_id" = "auth"."uid"())))))))));



CREATE POLICY "task_comments_update_own" ON "public"."task_comments" FOR UPDATE TO "authenticated" USING (("author_user_id" = "auth"."uid"())) WITH CHECK (("author_user_id" = "auth"."uid"()));



ALTER TABLE "public"."task_field_defs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_field_defs_member_select" ON "public"."task_field_defs" FOR SELECT TO "authenticated" USING ("public"."is_project_member"("project_id"));



CREATE POLICY "task_field_defs_owner_write" ON "public"."task_field_defs" TO "authenticated" USING ("public"."is_project_owner"("project_id")) WITH CHECK ("public"."is_project_owner"("project_id"));



ALTER TABLE "public"."task_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_history_member_all" ON "public"."task_history" TO "authenticated" USING ("public"."is_project_member"("project_id")) WITH CHECK ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."task_super_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_super_links_member_write" ON "public"."task_super_links" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."super_tasks" "s"
     JOIN "public"."projects" "p" ON (("p"."id" = "s"."project_id")))
  WHERE (("s"."id" = "task_super_links"."super_task_id") AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "m"
          WHERE (("m"."project_id" = "p"."id") AND ("m"."user_id" = "auth"."uid"()))))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."super_tasks" "s"
     JOIN "public"."projects" "p" ON (("p"."id" = "s"."project_id")))
  WHERE (("s"."id" = "task_super_links"."super_task_id") AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "m"
          WHERE (("m"."project_id" = "p"."id") AND ("m"."user_id" = "auth"."uid"())))))))));



CREATE POLICY "task_super_links_select" ON "public"."task_super_links" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."super_tasks" "s"
     JOIN "public"."projects" "p" ON (("p"."id" = "s"."project_id")))
  WHERE (("s"."id" = "task_super_links"."super_task_id") AND (("p"."owner_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
           FROM "public"."project_members" "m"
          WHERE (("m"."project_id" = "p"."id") AND ("m"."user_id" = "auth"."uid"())))))))));



ALTER TABLE "public"."task_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "task_types_delete" ON "public"."task_types" FOR DELETE USING (true);



CREATE POLICY "task_types_insert" ON "public"."task_types" FOR INSERT WITH CHECK (true);



CREATE POLICY "task_types_owner_all" ON "public"."task_types" TO "authenticated" USING ((("project_id" IS NOT NULL) AND "public"."is_project_owner"("project_id"))) WITH CHECK ((("project_id" IS NOT NULL) AND "public"."is_project_owner"("project_id")));



CREATE POLICY "task_types_select" ON "public"."task_types" FOR SELECT USING (true);



CREATE POLICY "task_types_select_scoped" ON "public"."task_types" FOR SELECT TO "authenticated" USING ((("project_id" IS NULL) OR "public"."is_project_member"("project_id")));



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_member_all" ON "public"."tasks" TO "authenticated" USING ("public"."is_project_member"("project_id")) WITH CHECK ("public"."is_project_member"("project_id"));



ALTER TABLE "public"."tier_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tier_limits_select" ON "public"."tier_limits" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."user_evolutions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_evolutions_owner_select" ON "public"."user_evolutions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."id" = "user_evolutions"."project_id") AND ("p"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."user_onboarding" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_onboarding_self_all" ON "public"."user_onboarding" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_referrals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_referrals_own_select" ON "public"."user_referrals" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."users_premium" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_premium_own_select" ON "public"."users_premium" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."users_premium" TO "anon";
GRANT ALL ON TABLE "public"."users_premium" TO "authenticated";
GRANT ALL ON TABLE "public"."users_premium" TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_user_plan"("p_email" "text", "p_tier" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_user_plan"("p_email" "text", "p_tier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_generate_evolution"("p_project_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."can_generate_evolution"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_generate_evolution"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."chat_session_touch"() TO "anon";
GRANT ALL ON FUNCTION "public"."chat_session_touch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."chat_session_touch"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer, "p_window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_task_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_task_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_task_id"() TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_project_secure"("p_name" "text", "p_description" "text", "p_config" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_project_secure"("p_name" "text", "p_description" "text", "p_config" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_project_secure"("p_name" "text", "p_description" "text", "p_config" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_project_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_project_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_project_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_id_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_id_by_email"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_project_role"("pid" bigint, "roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_project_role"("pid" bigint, "roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_project_role"("pid" bigint, "roles" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."hub_marcar_evento_procesado"("p_evento_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hub_marcar_evento_procesado"("p_evento_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."hub_outbox_claim"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hub_outbox_claim"("p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."hub_outbox_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."hub_outbox_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."hub_outbox_set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."hub_reclamar_evento"("p_evento_id" "text", "p_evento_tipo" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hub_reclamar_evento"("p_evento_id" "text", "p_evento_tipo" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."hub_revertir_evento"("p_evento_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hub_revertir_evento"("p_evento_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_project_member"("pid" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_project_member"("pid" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_member"("pid" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_project_owner"("pid" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_project_owner"("pid" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_project_owner"("pid" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_project_by_invite_code"("invite_code_input" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_project_by_invite_code"("invite_code_input" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_project_by_invite_code"("invite_code_input" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."my_role_in_project"("p_project_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."my_role_in_project"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_role_in_project"("p_project_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."owner_boards_overview"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."owner_boards_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."owner_boards_overview"() TO "service_role";



GRANT ALL ON FUNCTION "public"."participant_days_active"("p_project_id" bigint, "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."participant_days_active"("p_project_id" bigint, "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."participant_days_active"("p_project_id" bigint, "p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."project_can_use_chat"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_can_use_chat"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."project_can_use_evolutivo"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_can_use_evolutivo"("p_project_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_chat_consume_quota"("p_project_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_chat_consume_quota"("p_project_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_chat_quota_for"("p_project_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_chat_quota_for"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."project_chat_quota_remaining"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_chat_quota_remaining"("p_project_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."project_chat_release_quota"("p_project_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."project_chat_release_quota"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."project_has_feature"("p_project_id" bigint, "p_feature" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_has_feature"("p_project_id" bigint, "p_feature" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."project_members_with_role"("p_project_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."project_members_with_role"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."project_members_with_role"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."report_configs_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."report_configs_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."report_configs_set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_project_ia_enabled"("p_project_id" bigint, "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_project_ia_enabled"("p_project_id" bigint, "p_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_project_ia_enabled"("p_project_id" bigint, "p_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_project_member_role"("p_project_id" bigint, "p_member_user_id" "uuid", "p_role" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_project_member_role"("p_project_id" bigint, "p_member_user_id" "uuid", "p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_project_member_role"("p_project_id" bigint, "p_member_user_id" "uuid", "p_role" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_task_auto_fields"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_task_auto_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_task_auto_fields"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_task_field_defs_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_task_field_defs_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_task_field_defs_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sprint_retro_pending_for_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sprint_retro_pending_for_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sprint_retro_pending_for_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sprint_retros_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."sprint_retros_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sprint_retros_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_sprint_retro"("p_period_id" bigint, "p_respondent_name" "text", "p_emoji" "text", "p_liked" "text", "p_disliked" "text", "p_peer_strategic" "text", "p_peer_could_give_more" "text", "p_peer_had_it_tough" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_sprint_retro"("p_period_id" bigint, "p_respondent_name" "text", "p_emoji" "text", "p_liked" "text", "p_disliked" "text", "p_peer_strategic" "text", "p_peer_could_give_more" "text", "p_peer_had_it_tough" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."super_tasks_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."super_tasks_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."super_tasks_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_my_name_across_projects"("p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_my_name_across_projects"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_my_name_across_projects"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."task_comments_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."task_comments_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."task_comments_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."team_pulse_for_project"("p_project_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."team_pulse_for_project"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_pulse_for_project"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_can_use_ia_on_project"("p_project_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_can_use_ia_on_project"("p_project_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_ia_capacity"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_ia_capacity"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_ia_capacity"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_onboarding_touch"() TO "anon";
GRANT ALL ON FUNCTION "public"."user_onboarding_touch"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_onboarding_touch"() TO "service_role";



GRANT ALL ON FUNCTION "public"."users_premium_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."users_premium_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."users_premium_set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."whoami_diag"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."whoami_diag"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."whoami_diag"() TO "service_role";



GRANT ALL ON TABLE "public"."_keepalive" TO "anon";
GRANT ALL ON TABLE "public"."_keepalive" TO "authenticated";
GRANT ALL ON TABLE "public"."_keepalive" TO "service_role";



GRANT ALL ON TABLE "public"."admin_user_plans" TO "service_role";



GRANT ALL ON TABLE "public"."api_rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."api_rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."api_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."app_config" TO "anon";
GRANT ALL ON TABLE "public"."app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."chat_messages" TO "anon";
GRANT ALL ON TABLE "public"."chat_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chat_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chat_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chat_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chat_monthly_usage" TO "service_role";



GRANT ALL ON TABLE "public"."chat_sessions" TO "anon";
GRANT ALL ON TABLE "public"."chat_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_sessions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chat_sessions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chat_sessions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chat_sessions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."email_config" TO "anon";
GRANT ALL ON TABLE "public"."email_config" TO "authenticated";
GRANT ALL ON TABLE "public"."email_config" TO "service_role";



GRANT ALL ON SEQUENCE "public"."email_config_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."email_config_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."email_config_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hub_eventos_procesados" TO "service_role";



GRANT ALL ON TABLE "public"."hub_eventos_sin_resolver" TO "service_role";



GRANT ALL ON TABLE "public"."hub_outbox" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hub_outbox_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hub_outbox_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hub_outbox_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."indicators" TO "anon";
GRANT ALL ON TABLE "public"."indicators" TO "authenticated";
GRANT ALL ON TABLE "public"."indicators" TO "service_role";



GRANT ALL ON TABLE "public"."key_results" TO "anon";
GRANT ALL ON TABLE "public"."key_results" TO "authenticated";
GRANT ALL ON TABLE "public"."key_results" TO "service_role";



GRANT ALL ON SEQUENCE "public"."key_results_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."key_results_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."key_results_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."mp_webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."mp_webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."mp_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."okrs" TO "anon";
GRANT ALL ON TABLE "public"."okrs" TO "authenticated";
GRANT ALL ON TABLE "public"."okrs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."okrs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."okrs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."okrs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."participants" TO "anon";
GRANT ALL ON TABLE "public"."participants" TO "authenticated";
GRANT ALL ON TABLE "public"."participants" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON SEQUENCE "public"."project_members_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."project_members_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."project_members_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."project_templates" TO "anon";
GRANT ALL ON TABLE "public"."project_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_templates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."project_templates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."project_templates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."project_templates_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."projects_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."projects_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."projects_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."report_configs" TO "anon";
GRANT ALL ON TABLE "public"."report_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."report_configs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."report_configs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."report_configs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."report_configs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."report_history" TO "anon";
GRANT ALL ON TABLE "public"."report_history" TO "authenticated";
GRANT ALL ON TABLE "public"."report_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."report_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."report_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."report_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sprint_retro_peer_signals" TO "anon";
GRANT ALL ON TABLE "public"."sprint_retro_peer_signals" TO "authenticated";
GRANT ALL ON TABLE "public"."sprint_retro_peer_signals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sprint_retro_peer_signals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sprint_retro_peer_signals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sprint_retro_peer_signals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sprint_retro_periods" TO "anon";
GRANT ALL ON TABLE "public"."sprint_retro_periods" TO "authenticated";
GRANT ALL ON TABLE "public"."sprint_retro_periods" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sprint_retro_periods_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sprint_retro_periods_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sprint_retro_periods_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sprint_retros" TO "anon";
GRANT ALL ON TABLE "public"."sprint_retros" TO "authenticated";
GRANT ALL ON TABLE "public"."sprint_retros" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sprint_retros_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sprint_retros_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sprint_retros_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sprints" TO "anon";
GRANT ALL ON TABLE "public"."sprints" TO "authenticated";
GRANT ALL ON TABLE "public"."sprints" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sprints_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sprints_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sprints_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."super_tasks" TO "anon";
GRANT ALL ON TABLE "public"."super_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."super_tasks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."super_tasks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."super_tasks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."super_tasks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_comments" TO "anon";
GRANT ALL ON TABLE "public"."task_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."task_comments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."task_comments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."task_comments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_comments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_field_defs" TO "anon";
GRANT ALL ON TABLE "public"."task_field_defs" TO "authenticated";
GRANT ALL ON TABLE "public"."task_field_defs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."task_field_defs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."task_field_defs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_field_defs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_history" TO "anon";
GRANT ALL ON TABLE "public"."task_history" TO "authenticated";
GRANT ALL ON TABLE "public"."task_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."task_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."task_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."task_super_links" TO "anon";
GRANT ALL ON TABLE "public"."task_super_links" TO "authenticated";
GRANT ALL ON TABLE "public"."task_super_links" TO "service_role";



GRANT ALL ON TABLE "public"."task_types" TO "anon";
GRANT ALL ON TABLE "public"."task_types" TO "authenticated";
GRANT ALL ON TABLE "public"."task_types" TO "service_role";



GRANT ALL ON SEQUENCE "public"."task_types_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."task_types_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."task_types_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tier_limits" TO "anon";
GRANT ALL ON TABLE "public"."tier_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."tier_limits" TO "service_role";



GRANT ALL ON TABLE "public"."user_evolutions" TO "anon";
GRANT ALL ON TABLE "public"."user_evolutions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_evolutions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_evolutions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_evolutions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_evolutions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_onboarding" TO "anon";
GRANT ALL ON TABLE "public"."user_onboarding" TO "authenticated";
GRANT ALL ON TABLE "public"."user_onboarding" TO "service_role";



GRANT ALL ON TABLE "public"."user_referrals" TO "anon";
GRANT ALL ON TABLE "public"."user_referrals" TO "authenticated";
GRANT ALL ON TABLE "public"."user_referrals" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







