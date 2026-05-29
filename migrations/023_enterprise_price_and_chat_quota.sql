-- 023_enterprise_price_and_chat_quota.sql
-- 1. Fija el precio comercial del tier enterprise (350 000 COP/mes).
-- 2. Agrega cuota mensual de mensajes del chat IA, por proyecto.
--    Solo Enterprise tiene cuota >0 (es el único tier con chat habilitado).
--    Cuota mensual = 100 user messages por proyecto. Si pasa, el endpoint
--    devuelve 402 y el frontend muestra "Cuota mensual alcanzada".
-- 3. RPC project_chat_quota_remaining para que el frontend pueda mostrar
--    el contador en tiempo real.

BEGIN;

-- ─── 1. Precio Enterprise ─────────────────────────────────
UPDATE public.tier_limits SET price_cop = 350000 WHERE tier = 'enterprise';

-- ─── 2. Columna chat_msg_quota ────────────────────────────
ALTER TABLE public.tier_limits ADD COLUMN IF NOT EXISTS chat_msg_quota INT NOT NULL DEFAULT 0;

UPDATE public.tier_limits SET chat_msg_quota =   0 WHERE tier IN ('free','pro_solo','pro_team','pro_power');
UPDATE public.tier_limits SET chat_msg_quota = 100 WHERE tier = 'enterprise';

-- ─── 3. RPC: cuántos mensajes le quedan al PO este mes en este proyecto ──
CREATE OR REPLACE FUNCTION public.project_chat_quota_remaining(p_project_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_quota INT;
  v_used  INT;
BEGIN
  -- Cuota del tier del owner del proyecto
  SELECT t.chat_msg_quota INTO v_quota
  FROM public.projects p
  LEFT JOIN public.users_premium up ON up.user_id = p.owner_id
  LEFT JOIN public.tier_limits   t  ON t.tier = COALESCE(up.tier, 'free')
  WHERE p.id = p_project_id;

  v_quota := COALESCE(v_quota, 0);

  -- Mensajes del PO en este proyecto durante el mes actual.
  -- Contamos role='user' porque cada user msg genera un assistant msg 1:1
  -- y al PO le importa cuántas preguntas ha hecho.
  SELECT COUNT(*) INTO v_used
  FROM public.chat_messages cm
  JOIN public.chat_sessions cs ON cs.id = cm.session_id
  WHERE cs.project_id = p_project_id
    AND cm.role = 'user'
    AND cm.created_at >= date_trunc('month', NOW());

  RETURN jsonb_build_object(
    'quota', v_quota,
    'used',  v_used,
    'remaining', GREATEST(v_quota - v_used, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.project_chat_quota_remaining(BIGINT) TO authenticated, anon;

COMMIT;
