-- 024_user_onboarding.sql
-- Tabla para guardar el estado del onboarding por usuario.
-- Estructura: una fila por usuario (PK = user_id).
--   role            = scrum_master | po | participant (se elige en el modal de bienvenida)
--   completed_at    = TIMESTAMP cuando termina el tour
--   skipped         = true si saltó el tour
--   current_step    = índice del paso actual (permite reanudar si cierra browser)
--   started_at      = primera vez que abrió el modal
-- El frontend consulta esta fila al cargar la app; si no existe o
-- completed_at IS NULL y skipped = false, dispara el modal de bienvenida.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_onboarding (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT CHECK (role IN ('scrum_master','po','participant')),
  current_step  INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  skipped       BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_onboarding ENABLE ROW LEVEL SECURITY;

-- El usuario solo ve/edita su propia fila.
DROP POLICY IF EXISTS user_onboarding_self_all ON public.user_onboarding;
CREATE POLICY user_onboarding_self_all ON public.user_onboarding
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.user_onboarding_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_onboarding_touch_trg ON public.user_onboarding;
CREATE TRIGGER user_onboarding_touch_trg
  BEFORE UPDATE ON public.user_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.user_onboarding_touch();

COMMIT;
