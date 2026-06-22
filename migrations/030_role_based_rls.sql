-- Migration 030: Aplicar permisos por ROL en RLS, no solo en la UI (H-007).
--
-- Problema previo: las policies *_member_all conceden FOR ALL a CUALQUIER
-- miembro del proyecto. La UI esconde tabs por rol (OKRs solo po/scrum_master,
-- Sprints solo scrum_master), pero un miembro podía mutar esas tablas llamando
-- la API de Supabase directamente, saltándose el gating de la UI.
--
-- Solución: un helper has_project_role() y separar cada policy FOR ALL en:
--   - SELECT abierto a cualquier miembro (leer no es el riesgo; hay dashboards
--     y agregaciones que dependen de poder leer).
--   - INSERT/UPDATE/DELETE gated por rol, reflejando el gating de la UI.
-- El owner del proyecto SIEMPRE pasa (is_project_owner), sea cual sea su rol.
--
-- Tareas (tasks/task_history/notifications) NO se restringen: el Tablero es
-- colaborativo para los tres roles, así que mantener member_all es correcto.
--
-- Ejecutar después de 029. Idempotente.

BEGIN;

-- ─── Helper: ¿auth.uid() tiene alguno de estos roles en el proyecto? ───
-- El owner pasa siempre. STABLE + SECURITY DEFINER para evaluarse dentro de RLS.
CREATE OR REPLACE FUNCTION public.has_project_role(pid BIGINT, roles TEXT[])
RETURNS BOOLEAN AS $$
  SELECT is_project_owner(pid)
    OR EXISTS (
      SELECT 1 FROM public.project_members m
      WHERE m.project_id = pid
        AND (
          m.user_id = auth.uid()
          OR lower(m.email) = lower(COALESCE(auth.email(), ''))
        )
        AND m.role = ANY(roles)
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.has_project_role(BIGINT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_project_role(BIGINT, TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_project_role(BIGINT, TEXT[]) TO authenticated;

-- ─── OKRs: lectura para miembros; escritura solo po / scrum_master ───
DROP POLICY IF EXISTS okrs_member_all ON public.okrs;
DROP POLICY IF EXISTS okrs_member_select ON public.okrs;
DROP POLICY IF EXISTS okrs_role_insert ON public.okrs;
DROP POLICY IF EXISTS okrs_role_update ON public.okrs;
DROP POLICY IF EXISTS okrs_role_delete ON public.okrs;
CREATE POLICY okrs_member_select ON public.okrs FOR SELECT TO authenticated
  USING (is_project_member(project_id));
CREATE POLICY okrs_role_insert ON public.okrs FOR INSERT TO authenticated
  WITH CHECK (has_project_role(project_id, ARRAY['po','scrum_master']));
CREATE POLICY okrs_role_update ON public.okrs FOR UPDATE TO authenticated
  USING (has_project_role(project_id, ARRAY['po','scrum_master']))
  WITH CHECK (has_project_role(project_id, ARRAY['po','scrum_master']));
CREATE POLICY okrs_role_delete ON public.okrs FOR DELETE TO authenticated
  USING (has_project_role(project_id, ARRAY['po','scrum_master']));

-- ─── Key results: igual que OKRs (po / scrum_master) ───
DROP POLICY IF EXISTS key_results_member_all ON public.key_results;
DROP POLICY IF EXISTS key_results_member_select ON public.key_results;
DROP POLICY IF EXISTS key_results_role_insert ON public.key_results;
DROP POLICY IF EXISTS key_results_role_update ON public.key_results;
DROP POLICY IF EXISTS key_results_role_delete ON public.key_results;
CREATE POLICY key_results_member_select ON public.key_results FOR SELECT TO authenticated
  USING (is_project_member(project_id));
CREATE POLICY key_results_role_insert ON public.key_results FOR INSERT TO authenticated
  WITH CHECK (has_project_role(project_id, ARRAY['po','scrum_master']));
CREATE POLICY key_results_role_update ON public.key_results FOR UPDATE TO authenticated
  USING (has_project_role(project_id, ARRAY['po','scrum_master']))
  WITH CHECK (has_project_role(project_id, ARRAY['po','scrum_master']));
CREATE POLICY key_results_role_delete ON public.key_results FOR DELETE TO authenticated
  USING (has_project_role(project_id, ARRAY['po','scrum_master']));

-- ─── Sprints: lectura para miembros; escritura solo scrum_master ───
DROP POLICY IF EXISTS sprints_member_all ON public.sprints;
DROP POLICY IF EXISTS sprints_member_select ON public.sprints;
DROP POLICY IF EXISTS sprints_role_insert ON public.sprints;
DROP POLICY IF EXISTS sprints_role_update ON public.sprints;
DROP POLICY IF EXISTS sprints_role_delete ON public.sprints;
CREATE POLICY sprints_member_select ON public.sprints FOR SELECT TO authenticated
  USING (is_project_member(project_id));
CREATE POLICY sprints_role_insert ON public.sprints FOR INSERT TO authenticated
  WITH CHECK (has_project_role(project_id, ARRAY['scrum_master']));
CREATE POLICY sprints_role_update ON public.sprints FOR UPDATE TO authenticated
  USING (has_project_role(project_id, ARRAY['scrum_master']))
  WITH CHECK (has_project_role(project_id, ARRAY['scrum_master']));
CREATE POLICY sprints_role_delete ON public.sprints FOR DELETE TO authenticated
  USING (has_project_role(project_id, ARRAY['scrum_master']));

COMMIT;
