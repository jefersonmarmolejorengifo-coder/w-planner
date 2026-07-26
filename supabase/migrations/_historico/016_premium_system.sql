-- Migration 016: sistema de suscripción premium (Mercado Pago).
--
-- Tres piezas:
--   1. users_premium — estado de suscripción por usuario (owner del proyecto).
--   2. tier_limits — configuración de tiers (precio, # proyectos con IA, etc.).
--      En tabla para poder editarla sin redeploy.
--   3. projects.ia_enabled — bandera por proyecto que el owner activa cuando
--      tiene capacidad de tier suficiente.
--
-- Reglas de negocio enforced server-side:
--   - Solo el owner del proyecto puede toggle ia_enabled.
--   - Toggle a true falla si: (a) el owner no tiene premium activo
--     (tier != 'free' y status = 'active'), o (b) ya tiene ia_projects al
--     límite del tier.
--   - Los endpoints /api/generate-* verifican via RPC user_can_use_ia()
--     antes de gastar tokens.

BEGIN;

-- ── 1. tier_limits ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tier_limits (
  tier            TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  ia_projects     INTEGER NOT NULL CHECK (ia_projects >= 0),
  total_projects  INTEGER NOT NULL CHECK (total_projects >= 0),
  price_cop       INTEGER NOT NULL CHECK (price_cop >= 0),
  -- Mercado Pago preapproval_plan_id (creado en el dashboard MP). Permite
  -- redirigir al usuario al checkout sin re-crear el plan en cada request.
  mp_plan_id      TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.tier_limits (tier, display_name, ia_projects, total_projects, price_cop, sort_order)
VALUES
  ('free',       'Gratis',     0,   1,     0, 0),
  ('pro_solo',   'Pro Solo',   2,   4, 30000, 1),
  ('pro_team',   'Pro Team',   5,   9, 55000, 2),
  ('pro_power',  'Pro Power',  8,  14, 90000, 3),
  ('enterprise', 'Enterprise', 999, 999, 0, 99)
ON CONFLICT (tier) DO NOTHING;

ALTER TABLE public.tier_limits ENABLE ROW LEVEL SECURITY;

-- Cualquier authenticated lee la tabla (necesario para mostrar precios).
DROP POLICY IF EXISTS tier_limits_select ON public.tier_limits;
CREATE POLICY tier_limits_select ON public.tier_limits
  FOR SELECT TO authenticated USING (true);

-- ── 2. users_premium ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users_premium (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier                 TEXT NOT NULL DEFAULT 'free' REFERENCES public.tier_limits(tier),
  -- 'active' = paga al día; 'pending' = checkout iniciado pero sin pago;
  -- 'past_due' = pago fallido reciente; 'cancelled' = el usuario canceló.
  status               TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','pending','past_due','cancelled')),
  -- Datos Mercado Pago
  mp_preapproval_id    TEXT,
  mp_payer_email       TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  last_payment_at      TIMESTAMPTZ,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_premium_status_idx ON public.users_premium(status);
CREATE INDEX IF NOT EXISTS users_premium_mp_idx ON public.users_premium(mp_preapproval_id) WHERE mp_preapproval_id IS NOT NULL;

ALTER TABLE public.users_premium ENABLE ROW LEVEL SECURITY;

-- El usuario lee su propio registro.
DROP POLICY IF EXISTS users_premium_own_select ON public.users_premium;
CREATE POLICY users_premium_own_select ON public.users_premium
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- INSERT/UPDATE solo via service_role (los webhooks).
-- No agregamos políticas para authenticated.

-- ── 3. projects.ia_enabled ─────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS ia_enabled BOOLEAN NOT NULL DEFAULT false;

-- ── 4. RPCs de gating ──────────────────────────────────────

-- Devuelve el estado de capacidad del usuario para habilitar más proyectos con IA.
CREATE OR REPLACE FUNCTION public.user_ia_capacity(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE(
  tier TEXT,
  display_name TEXT,
  status TEXT,
  ia_current INTEGER,
  ia_max INTEGER,
  total_current INTEGER,
  total_max INTEGER,
  can_enable_more BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.user_ia_capacity(UUID) TO authenticated;

-- ¿Este proyecto tiene IA habilitada Y su owner está en buen standing?
CREATE OR REPLACE FUNCTION public.user_can_use_ia_on_project(p_project_id BIGINT)
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
      AND COALESCE(up.tier, 'free') != 'free'
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_use_ia_on_project(BIGINT) TO authenticated, anon;

-- Toggle ia_enabled con validación: solo el owner Y solo si tiene capacidad.
CREATE OR REPLACE FUNCTION public.set_project_ia_enabled(p_project_id BIGINT, p_enabled BOOLEAN)
RETURNS public.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

REVOKE ALL ON FUNCTION public.set_project_ia_enabled(BIGINT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_ia_enabled(BIGINT, BOOLEAN) TO authenticated;

-- Trigger updated_at en users_premium
CREATE OR REPLACE FUNCTION public.users_premium_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS users_premium_updated_at_trg ON public.users_premium;
CREATE TRIGGER users_premium_updated_at_trg
  BEFORE UPDATE ON public.users_premium
  FOR EACH ROW EXECUTE FUNCTION public.users_premium_set_updated_at();

COMMIT;

-- ── Verificación ───────────────────────────────────────────
-- SELECT * FROM public.tier_limits ORDER BY sort_order;
-- SELECT * FROM public.user_ia_capacity();          -- estado del usuario actual
-- SELECT public.user_can_use_ia_on_project(27);      -- ¿puede el proyecto 27 usar IA?
-- SELECT public.set_project_ia_enabled(27, true);    -- activa IA en proyecto 27
