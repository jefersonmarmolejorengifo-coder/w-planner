-- 027_project_limit_enforcement.sql
-- Enforce el límite de tableros (proyectos) por plan DEL LADO DEL SERVIDOR.
--
-- Antes el límite solo existía en el cliente (ProjectLandingScreen) y era
-- bypassable: ni `create_project_secure` (migración 009) ni la RLS de `projects`
-- verificaban cuántos tableros tenía el owner.
--
-- Usamos un trigger BEFORE INSERT en `projects` para cubrir TODOS los caminos
-- de creación (RPC create_project_secure + insert directo del fallback legacy).
-- El límite sale de `tier_limits.total_projects` según el tier efectivo del
-- owner (users_premium, default 'free'; un plan de pago solo cuenta si está
-- 'active'). Plan gratuito = 1 tablero.
--
-- Los inserts de service_role (seeding, admin) tienen auth.uid() = NULL y se
-- omiten del límite a propósito.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_project_limit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

DROP TRIGGER IF EXISTS projects_enforce_limit ON public.projects;
CREATE TRIGGER projects_enforce_limit
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_limit();

COMMIT;

-- ── Verificación (correr manualmente tras aplicar) ─────────────
-- Como usuario free con 1 tablero, crear otro debe fallar:
--   SELECT * FROM public.create_project_secure('Segundo', '', '{}'::jsonb);
--   -- esperado: ERROR  Llegaste al límite de 1 tablero(s) del plan free...
--
-- Confirmar el límite vigente del plan gratuito:
--   SELECT tier, total_projects FROM public.tier_limits WHERE tier = 'free';
--   -- esperado: free | 1
