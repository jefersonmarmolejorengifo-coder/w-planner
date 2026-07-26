-- Migration 035: panel admin de planes en un solo lugar.
--
-- Contexto: las cuentas nacen en auth.users (schema gestionado por Supabase) y
-- el plan vive en public.users_premium. Verlos juntos obligaba a saltar entre
-- "Authentication > Users" y "Table Editor > users_premium". Esta migración crea:
--
--   1. VISTA  admin_user_plans   → email + tier + status + #tableros, una fila
--      por cuenta. Aparece en Table Editor para mirar todo de un vistazo.
--   2. FUNCIÓN admin_set_user_plan(email, tier) → cambia el plan de cualquiera
--      escribiendo solo el correo (sin copiar UUIDs). Sin cobro: no crea
--      suscripción en Mercado Pago, status=active y sin fecha de expiración.
--
-- ⚠️ SEGURIDAD: la vista expone emails de auth.users. Por eso se REVOCA el acceso
-- a anon/authenticated; SOLO el rol del dashboard (postgres/service_role) la lee.
-- Lo mismo para la función, que concede premium y jamás debe ser invocable por
-- un usuario normal vía la API REST.

BEGIN;

-- ── 1. Vista de lectura: cuentas + plan + tableros ─────────
CREATE OR REPLACE VIEW public.admin_user_plans AS
SELECT
  au.id                                  AS user_id,
  au.email,
  COALESCE(up.tier,   'free')            AS tier,
  COALESCE(up.status, 'active')          AS status,
  up.metadata ->> 'grant'                AS grant_type,   -- 'comp' = cortesía manual
  (SELECT COUNT(*) FROM public.projects p WHERE p.owner_id = au.id) AS owned_boards,
  au.created_at                          AS account_created,
  up.updated_at                          AS plan_updated
FROM auth.users au
LEFT JOIN public.users_premium up ON up.user_id = au.id;

-- Blindaje: nadie salvo el dashboard/admin puede leer emails por esta vista.
REVOKE ALL ON public.admin_user_plans FROM PUBLIC, anon, authenticated;

-- ── 2. Cambiar plan por email (cortesía, sin cobro) ────────
CREATE OR REPLACE FUNCTION public.admin_set_user_plan(p_email TEXT, p_tier TEXT)
RETURNS public.users_premium
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

-- Solo dashboard/service_role; jamás expuesta a usuarios vía REST.
REVOKE ALL ON FUNCTION public.admin_set_user_plan(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

COMMIT;

-- ── Uso ────────────────────────────────────────────────────
-- Ver todo (Table Editor > admin_user_plans, o aquí):
--   SELECT * FROM public.admin_user_plans ORDER BY account_created;
--
-- Subir a alguien a Pro Power sin cobro, por email:
--   SELECT public.admin_set_user_plan('juandaza@muni.com.co', 'pro_power');
--
-- Bajar a Gratis (quitar premium):
--   SELECT public.admin_set_user_plan('juandaza@muni.com.co', 'free');
