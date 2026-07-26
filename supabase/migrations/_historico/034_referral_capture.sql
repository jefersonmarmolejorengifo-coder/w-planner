-- 034_referral_capture.sql
-- Tabla para persistir el referral_code capturado antes de que el usuario
-- suscriba. Se crea separada de users_premium porque el referral puede existir
-- antes de que haya una suscripción activa (el user puede visitarnos vía link
-- de afiliado y registrarse sin pagar de inmediato).
--
-- La inserción la hace el backend con service_role (bypasea RLS). Los usuarios
-- autenticados solo pueden leer su propio registro (para mostrar en UI si aplica).
-- No se expone INSERT/UPDATE/DELETE a roles que no sean service_role.

CREATE TABLE IF NOT EXISTS public.user_referrals (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code  TEXT NOT NULL,
  -- source: de dónde vino el código, ej. 'localStorage', 'body', 'db'
  source         TEXT,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_referrals ENABLE ROW LEVEL SECURITY;

-- Política de lectura: el propietario puede ver su propio registro.
-- service_role bypasea RLS y tiene acceso total (para INSERT desde el backend).
DROP POLICY IF EXISTS user_referrals_own_select ON public.user_referrals;
CREATE POLICY user_referrals_own_select ON public.user_referrals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Solo lectura para authenticated. El INSERT lo realiza service_role.
GRANT SELECT ON public.user_referrals TO authenticated;
