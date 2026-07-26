-- 025_roles_and_name.sql (Fase A del rediseño de onboarding)
-- 1. project_members.role: rol por proyecto (PO / SM / Participante).
--    El owner del proyecto sigue siendo authoritative vía projects.owner_id;
--    role solo define qué tour ve la persona y qué features se le habilitan.
-- 2. Backfill: el owner de cada proyecto queda como 'po' por defecto
--    (la decisión del usuario fue "Owner es PO por defecto, pero puede
--    reasignarse a sí mismo").
-- 3. RPCs:
--    - set_project_member_role: owner asigna rol a un miembro.
--    - project_members_with_role: lista miembros + rol (solo owner ve TODOS).
--    - my_role_in_project: el frontend lo usa para saber qué tour cargar.
-- 4. participants.is_legacy = true para personas ficticias (sin auth_user_id).
--    Los reales (auth_user_id NOT NULL) quedan is_legacy = false.

BEGIN;

-- ─── 1. Columna role en project_members ─────────────────
ALTER TABLE public.project_members
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'participant';

-- Limpia roles inválidos (defensivo) antes de añadir el CHECK
UPDATE public.project_members SET role = 'participant'
WHERE role NOT IN ('po', 'scrum_master', 'participant');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'project_members'
      AND constraint_name = 'project_members_role_check'
  ) THEN
    ALTER TABLE public.project_members
      ADD CONSTRAINT project_members_role_check
      CHECK (role IN ('po', 'scrum_master', 'participant'));
  END IF;
END $$;

-- ─── 2. Backfill: owner ⇒ 'po' por defecto ─────────────
UPDATE public.project_members pm
SET role = 'po'
FROM public.projects p
WHERE pm.project_id = p.id
  AND pm.user_id    = p.owner_id
  AND pm.role       = 'participant';

-- ─── 3. is_legacy en participants ───────────────────────
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT TRUE;

-- Participantes con cuenta real ⇒ no legacy
UPDATE public.participants
SET is_legacy = FALSE
WHERE auth_user_id IS NOT NULL;

-- Los demás (sin auth_user_id, ej. los 12 ficticios del demo seed) quedan
-- is_legacy = TRUE: siguen apareciendo en selects pero no son cuentas reales.

-- ─── 4. RPC: asignar rol a un miembro (solo owner) ─────
CREATE OR REPLACE FUNCTION public.set_project_member_role(
  p_project_id     BIGINT,
  p_member_user_id UUID,
  p_role           TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT owner_id INTO v_owner FROM public.projects WHERE id = p_project_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Proyecto no encontrado' USING ERRCODE = '02000';
  END IF;
  IF v_owner != auth.uid() THEN
    RAISE EXCEPTION 'Solo el owner puede asignar roles' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('po', 'scrum_master', 'participant') THEN
    RAISE EXCEPTION 'Rol invalido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.project_members
  SET role = p_role
  WHERE project_id = p_project_id AND user_id = p_member_user_id;

  -- Cuando el owner cambia el rol de alguien, conviene resetear el progreso
  -- del tour de ese usuario para que vea el nuevo tour la próxima vez.
  -- El estado vive en user_onboarding (global). Lo reseteamos:
  UPDATE public.user_onboarding
  SET current_step = 0, completed_at = NULL, skipped = FALSE
  WHERE user_id = p_member_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_project_member_role(BIGINT, UUID, TEXT) TO authenticated;

-- ─── 5. RPC: listar miembros con rol ────────────────────
CREATE OR REPLACE FUNCTION public.project_members_with_role(p_project_id BIGINT)
RETURNS TABLE(
  user_id    UUID,
  email      TEXT,
  name       TEXT,
  role       TEXT,
  is_owner   BOOLEAN,
  invited_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    pm.user_id,
    pm.email,
    pm.name,
    pm.role,
    (pm.user_id = p.owner_id) AS is_owner,
    pm.invited_at
  FROM public.project_members pm
  JOIN public.projects p ON p.id = pm.project_id
  WHERE pm.project_id = p_project_id
    AND (
      pm.user_id = auth.uid()
      OR p.owner_id = auth.uid()
    )
  ORDER BY (pm.user_id = p.owner_id) DESC, pm.invited_at;
$$;

GRANT EXECUTE ON FUNCTION public.project_members_with_role(BIGINT) TO authenticated;

-- ─── 6. RPC: mi rol en un proyecto ──────────────────────
CREATE OR REPLACE FUNCTION public.my_role_in_project(p_project_id BIGINT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.project_members
  WHERE project_id = p_project_id AND user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.my_role_in_project(BIGINT) TO authenticated;

-- ─── 7. RPC: actualizar nombre del usuario en TODAS sus
--      memberships (se llama después del NameCaptureModal) ──
CREATE OR REPLACE FUNCTION public.sync_my_name_across_projects(p_name TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Nombre invalido' USING ERRCODE = '22023';
  END IF;

  UPDATE public.project_members
  SET name = trim(p_name)
  WHERE user_id = auth.uid();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- También sincroniza en participants (donde haya auth_user_id)
  UPDATE public.participants
  SET name = trim(p_name)
  WHERE auth_user_id = auth.uid();

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_my_name_across_projects(TEXT) TO authenticated;

COMMIT;
