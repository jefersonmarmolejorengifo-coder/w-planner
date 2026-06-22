-- Migration 031: Revocar anon de las RPCs SECURITY DEFINER de features/cuota (H-020).
--
-- Problema: project_has_feature / project_can_use_evolutivo / project_can_use_chat /
-- project_chat_quota_remaining / user_can_use_ia_on_project son SECURITY DEFINER
-- (bypass RLS) y estaban concedidas a `anon`. Un usuario no autenticado podía
-- enumerar el estado de features y el uso de chat de CUALQUIER proyecto por id.
--
-- Fix: revocar `anon` y dejar solo `authenticated`. La app exige login (magic
-- link) y el frontend, ya con sesión, invoca estas RPCs con el rol `authenticated`
-- (no `anon`), así que no se ve afectado.
--
-- NOTA deliberada: NO se añade un guard is_project_member() dentro de las
-- funciones porque cron.js las llama con service_role (auth.uid() = NULL) para los
-- reportes programados; un guard de membresía las haría devolver false y rompería
-- el cron. El service_role no depende del grant a anon, así que esta revocación no
-- lo afecta.
--
-- Ejecutar después de 030. Idempotente.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.project_has_feature(BIGINT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_can_use_evolutivo(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_can_use_chat(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_chat_quota_remaining(BIGINT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_can_use_ia_on_project(BIGINT) FROM anon;

-- Reafirma el grant correcto (idempotente).
GRANT EXECUTE ON FUNCTION public.project_has_feature(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_can_use_evolutivo(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_can_use_chat(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.project_chat_quota_remaining(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_use_ia_on_project(BIGINT) TO authenticated;

COMMIT;
