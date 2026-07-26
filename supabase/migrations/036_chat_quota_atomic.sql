-- 036_chat_quota_atomic.sql
-- H-030 (CRÍTICO) — Race condition de la cuota mensual del chat IA.
--
-- Antes: api/chat-stream.js leía project_chat_quota_remaining (un COUNT sobre
-- chat_messages) y, si remaining>0, seguía e insertaba el mensaje. El consumo
-- era IMPLÍCITO (contar filas), así que dos requests concurrentes veían el
-- mismo "remaining" y AMBOS pasaban el check -> doble llamada al LLM (doble
-- gasto de tokens) contando como un solo turno. La cuota se podía exceder con
-- concurrencia.
--
-- Fix: contador mensual por proyecto con RESERVA ATÓMICA en una sola sentencia
-- INSERT .. ON CONFLICT .. DO UPDATE .. WHERE used < quota. Postgres serializa
-- la fila, así que N requests concurrentes se ordenan y solo se conceden los
-- que caben en la cuota. El consumo deja de depender de contar chat_messages
-- (fuente de verdad única y explícita).

BEGIN;

-- ─── 1. Contador mensual por proyecto (fuente de verdad del consumo) ──────────
CREATE TABLE IF NOT EXISTS public.chat_monthly_usage (
  project_id BIGINT      NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period     DATE        NOT NULL,                 -- date_trunc('month') del consumo
  used       INT         NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, period)
);

-- Nadie accede a la tabla directo: solo vía RPCs SECURITY DEFINER de abajo.
-- RLS encendida sin políticas + sin grants = inaccesible por PostgREST.
ALTER TABLE public.chat_monthly_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_monthly_usage FROM PUBLIC, authenticated, anon;

-- ─── 2. Backfill del mes en curso desde chat_messages ────────────────────────
-- Para no regalar cuota a quien ya consumió este mes con el modelo viejo.
INSERT INTO public.chat_monthly_usage (project_id, period, used)
SELECT cs.project_id, date_trunc('month', NOW())::date, COUNT(*)::int
FROM public.chat_messages cm
JOIN public.chat_sessions cs ON cs.id = cm.session_id
WHERE cm.role = 'user'
  AND cm.created_at >= date_trunc('month', NOW())
GROUP BY cs.project_id
ON CONFLICT (project_id, period) DO UPDATE SET used = EXCLUDED.used;

-- ─── 3. Helper: cuota mensual del tier efectivo del owner del proyecto ───────
CREATE OR REPLACE FUNCTION public.project_chat_quota_for(p_project_id BIGINT)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(t.chat_msg_quota, 0)
  FROM public.projects p
  LEFT JOIN public.users_premium up ON up.user_id = p.owner_id
  LEFT JOIN public.tier_limits   t  ON t.tier = COALESCE(up.tier, 'free')
  WHERE p.id = p_project_id;
$$;
REVOKE EXECUTE ON FUNCTION public.project_chat_quota_for(BIGINT) FROM PUBLIC, anon, authenticated;

-- ─── 4. Reserva ATÓMICA de 1 mensaje. Devuelve allowed + estado de cuota ──────
-- Llamada SOLO server-side con service_role, después de validar acceso al
-- proyecto en el endpoint (no se concede a authenticated para que un usuario
-- no pueda inflar el contador de un proyecto ajeno pasando un id arbitrario).
CREATE OR REPLACE FUNCTION public.project_chat_consume_quota(p_project_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
REVOKE EXECUTE ON FUNCTION public.project_chat_consume_quota(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.project_chat_consume_quota(BIGINT) TO service_role;

-- ─── 5. Devolución (refund) de 1 reserva ─────────────────────────────────────
-- Para turnos que reservaron pero NO se cobraron (el proveedor de IA falló
-- antes de generar nada). Solo service_role: si authenticated pudiera llamarla
-- haría bypass de la cuota (refund infinito).
CREATE OR REPLACE FUNCTION public.project_chat_release_quota(p_project_id BIGINT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.chat_monthly_usage
    SET used = GREATEST(used - 1, 0), updated_at = NOW()
  WHERE project_id = p_project_id
    AND period = date_trunc('month', NOW())::date;
$$;
REVOKE EXECUTE ON FUNCTION public.project_chat_release_quota(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.project_chat_release_quota(BIGINT) TO service_role;

-- ─── 6. Lectura para el display del frontend (mismo contrato JSONB) ──────────
-- Ahora lee el contador, no el COUNT de chat_messages, para que el contador
-- visible coincida con las reservas reales. Mantiene el grant a authenticated
-- (lo llama ChatEnterpriseTab para pintar "used / quota").
CREATE OR REPLACE FUNCTION public.project_chat_quota_remaining(p_project_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
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
-- CREATE OR REPLACE conserva los grants previos (031: authenticated sí, anon no).

COMMIT;

-- ── Verificación (correr manualmente tras aplicar) ────────────────────────────
-- 1) Contador sembrado del mes en curso:
--    SELECT * FROM public.chat_monthly_usage ORDER BY period DESC, project_id;
-- 2) Reserva atómica concede hasta la cuota y luego niega:
--    SELECT public.project_chat_consume_quota(<projectId>);  -- repetir > cuota
--    -- esperado: allowed=true hasta llegar a 'quota', luego allowed=false.
-- 3) El display coincide con el contador:
--    SELECT public.project_chat_quota_remaining(<projectId>);
-- 4) Refund baja el contador sin pasar de 0:
--    SELECT public.project_chat_release_quota(<projectId>);
