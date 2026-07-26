-- Migration 017: ajuste de precios + columna features por tier.
--
-- 1. Sube los precios de Pro Solo, Team y Power.
-- 2. Agrega columna `features` (text array) en tier_limits para gating
--    granular: cada feature ('reports', 'evolutivo', 'chat') está disponible
--    solo en los tiers que la declaran.
-- 3. Crea RPCs auxiliares que el resto del código va a usar para decidir
--    si un proyecto puede usar evolutivo o chat.
--
-- Esta migración asume que 016 ya está aplicada.

BEGIN;

-- ── 1. Nueva columna features ──────────────────────────────
ALTER TABLE public.tier_limits
  ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT '{}'::text[];

-- ── 2. Ajuste de precios + features ────────────────────────
-- 'reports' = los 3 reportes IA (Scrum + Semanal + Mensual)
-- 'evolutivo' = tarjetas profesionales bimensuales + composicion de celulas
-- 'chat' = chat en vivo del PO con la IA cargada con datos del equipo
UPDATE public.tier_limits SET price_cop =  50000, features = ARRAY['reports']                           WHERE tier = 'pro_solo';
UPDATE public.tier_limits SET price_cop =  80000, features = ARRAY['reports']                           WHERE tier = 'pro_team';
UPDATE public.tier_limits SET price_cop = 150000, features = ARRAY['reports', 'evolutivo']              WHERE tier = 'pro_power';
UPDATE public.tier_limits SET price_cop =      0, features = ARRAY['reports', 'evolutivo', 'chat']      WHERE tier = 'enterprise';
UPDATE public.tier_limits SET features = ARRAY[]::text[]                                                 WHERE tier = 'free';

-- ── 3. RPCs para gating granular ───────────────────────────
-- Devuelve true si el owner del proyecto tiene el feature en su tier activo.
CREATE OR REPLACE FUNCTION public.project_has_feature(p_project_id BIGINT, p_feature TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.project_has_feature(BIGINT, TEXT) TO authenticated, anon;

-- Conveniencias para usar desde el frontend sin pasar el nombre del feature
-- como string.
CREATE OR REPLACE FUNCTION public.project_can_use_evolutivo(p_project_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.project_has_feature(p_project_id, 'evolutivo');
$$;

CREATE OR REPLACE FUNCTION public.project_can_use_chat(p_project_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.project_has_feature(p_project_id, 'chat');
$$;

GRANT EXECUTE ON FUNCTION public.project_can_use_evolutivo(BIGINT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.project_can_use_chat(BIGINT) TO authenticated, anon;

COMMIT;

-- ── Verificación ───────────────────────────────────────────
-- SELECT tier, display_name, price_cop, features FROM public.tier_limits ORDER BY sort_order;
-- SELECT public.project_can_use_evolutivo(27);
-- SELECT public.project_can_use_chat(27);
