-- 028_chat_to_pro_power.sql
-- 1. El Chat IA pasa de Enterprise a Pro Power (feature + cuota mensual).
-- 2. Enterprise sale de la oferta self-serve (se conserva la fila por si
--    hubiera suscriptores históricos, pero ya no se muestra ni se vende).
-- 3. Renombre comercial Pro Solo -> "Pro" y precios sincronizados con
--    src/plans.js (el cobro lo gobierna el código; esto mantiene la BD
--    coherente para display y gating).

BEGIN;

-- ─── 1. Chat IA ahora en Pro Power ────────────────────────
-- project_can_use_chat() lee tier_limits.features ('chat') del owner; el
-- contador usa chat_msg_quota. Pro Power gana ambos.
UPDATE public.tier_limits
  SET features = ARRAY['reports','evolutivo','chat'],
      chat_msg_quota = 100
  WHERE tier = 'pro_power';

-- ─── 2. Enterprise fuera de la oferta ─────────────────────
UPDATE public.tier_limits
  SET chat_msg_quota = 0
  WHERE tier = 'enterprise';

-- ─── 3. Renombre + precios alineados con src/plans.js ─────
UPDATE public.tier_limits SET display_name = 'Pro', price_cop =  80000 WHERE tier = 'pro_solo';
UPDATE public.tier_limits SET                        price_cop = 110000 WHERE tier = 'pro_team';
UPDATE public.tier_limits SET                        price_cop = 210000 WHERE tier = 'pro_power';

COMMIT;

-- ── Verificación ───────────────────────────────────────────
-- SELECT tier, display_name, price_cop, chat_msg_quota, features
--   FROM public.tier_limits ORDER BY sort_order;
-- SELECT public.project_can_use_chat(<id de un proyecto de owner Pro Power>);
-- -- esperado: true
