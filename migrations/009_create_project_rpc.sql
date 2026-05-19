-- Migration 009: server-side project creation RPC + auth diagnostics.
--
-- Some clients reach a state where supabase.auth.getUser() returns a valid
-- user but the JWT actually sent on PostgREST requests has no recognizable
-- `sub` claim, so auth.uid() is NULL server-side and projects_insert_owner
-- rejects every insert even with matching owner_id from the client.
--
-- This migration adds:
--   * whoami_diag()         — observability: return what the server sees.
--   * create_project_secure — single-source-of-truth project creation that
--                             derives owner_id from auth.uid() instead of
--                             trusting the client payload. It still requires
--                             a valid authenticated session.

BEGIN;

-- ── 1. Diagnostics ─────────────────────────────────────────
-- Returns whatever the server can extract from the current JWT. Safe to
-- expose to authenticated users (no sensitive data, just self-introspection).
CREATE OR REPLACE FUNCTION public.whoami_diag()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'uid',       auth.uid(),
    'email',     auth.email(),
    'role',      auth.role(),
    'jwt_sub',   current_setting('request.jwt.claim.sub',  true),
    'jwt_role',  current_setting('request.jwt.claim.role', true),
    'jwt_email', current_setting('request.jwt.claim.email', true)
  );
$$;

REVOKE ALL ON FUNCTION public.whoami_diag() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whoami_diag() TO authenticated;

-- ── 2. Secure project creation ─────────────────────────────
-- Server derives the owner from the JWT, so RLS denial scenarios driven by
-- a stale or sub-less client token no longer apply. Also auto-registers the
-- creator as a project_member to keep the existing membership invariant.
CREATE OR REPLACE FUNCTION public.create_project_secure(
  p_name        TEXT,
  p_description TEXT,
  p_config      JSONB
)
RETURNS projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  uid        UUID := auth.uid();
  user_email TEXT := auth.email();
  full_name  TEXT;
  new_proj   projects;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required (auth.uid is NULL)'
      USING ERRCODE = '28000';
  END IF;

  full_name := COALESCE(
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    user_email,
    ''
  );

  INSERT INTO projects (name, description, config, owner_id)
  VALUES (
    TRIM(COALESCE(p_name, '')),
    TRIM(COALESCE(p_description, '')),
    COALESCE(p_config, '{}'::jsonb),
    uid
  )
  RETURNING * INTO new_proj;

  -- Mirror the previous client-side flow: ensure the creator is registered.
  INSERT INTO project_members (project_id, email, name, user_id)
  VALUES (new_proj.id, user_email, full_name, uid)
  ON CONFLICT (project_id, email)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    name    = COALESCE(NULLIF(EXCLUDED.name, ''), project_members.name);

  RETURN new_proj;
END;
$$;

REVOKE ALL ON FUNCTION public.create_project_secure(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_project_secure(TEXT, TEXT, JSONB) TO authenticated;

COMMIT;

-- ── Verification (run manually after applying) ─────────────
-- select public.whoami_diag();
-- -- expected: { "uid": "<your-uuid>", "role": "authenticated", ... }
--
-- select * from public.create_project_secure('Prueba RPC', '', '{}'::jsonb);
-- -- expected: a new row in projects with owner_id = auth.uid()
