-- Migration 007: Tighten RPC execution grants after RLS hardening.
-- Run after 006_security_hardening.sql.

BEGIN;

REVOKE ALL ON FUNCTION public.claim_task_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_task_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_task_id() TO authenticated;

REVOKE ALL ON FUNCTION public.is_project_owner(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_owner(BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_owner(BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.is_project_member(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_member(BIGINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_project_member(BIGINT) TO authenticated;

REVOKE ALL ON FUNCTION public.join_project_by_invite_code(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_project_by_invite_code(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_project_by_invite_code(TEXT) TO authenticated;

COMMIT;
