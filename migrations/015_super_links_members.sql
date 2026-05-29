-- Migration 015: permitir a miembros del proyecto enlazar/desenlazar tareas
-- a super-tareas (task_super_links), sin permitirles crear o borrar super-
-- tareas (super_tasks queda owner-only).
--
-- Decisión de producto: el PO define las super-tareas (objetivos macro),
-- pero cualquier miembro del equipo puede conectar sus tareas a esos
-- objetivos sin pasar por el PO. Esto reduce fricción y acelera que el
-- grafo de aporte refleje el estado real.

BEGIN;

-- Elimina la política owner-only que dejó la migración 014.
DROP POLICY IF EXISTS task_super_links_owner_all ON public.task_super_links;

-- Nueva política: miembros del proyecto pueden INSERT/UPDATE/DELETE en
-- task_super_links sobre super-tareas que pertenezcan a proyectos donde
-- son miembros u owners.
DROP POLICY IF EXISTS task_super_links_member_write ON public.task_super_links;
CREATE POLICY task_super_links_member_write ON public.task_super_links
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.super_tasks s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = task_super_links.super_task_id
        AND (p.owner_id = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.project_members m
               WHERE m.project_id = p.id AND m.user_id = auth.uid()
             ))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.super_tasks s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = task_super_links.super_task_id
        AND (p.owner_id = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.project_members m
               WHERE m.project_id = p.id AND m.user_id = auth.uid()
             ))
    )
  );

-- super_tasks NO se toca: sigue siendo owner-only para insert/update/delete.

COMMIT;

-- ── Verificación ───────────────────────────────────────────
-- SELECT polname, polcmd, polqual FROM pg_policy
--   WHERE polrelid = 'public.task_super_links'::regclass;
