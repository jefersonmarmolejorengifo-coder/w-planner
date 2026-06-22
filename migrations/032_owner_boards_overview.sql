-- Migration 032: Agregación server-side de la visión consolidada del dueño (H-015).
--
-- Antes, ConsolidatedDashboard traía TODAS las tareas de TODOS los tableros del
-- owner (select sobre tasks .in(project_id, ids)) y agregaba en el cliente. Con
-- muchos tableros/tareas eso transfiere miles de filas por cada apertura.
--
-- Esta RPC calcula los KPIs por tablero en SQL y devuelve un JSONB compacto:
-- una entrada por proyecto + el total global de personas distintas. Scoped al
-- owner vía auth.uid() (SECURITY DEFINER). Solo authenticated (no anon, H-020).
--
-- Ejecutar después de 031. Idempotente.

BEGIN;

CREATE OR REPLACE FUNCTION public.owner_boards_overview()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH my_projects AS (
    SELECT id, name, description, ia_enabled
    FROM public.projects
    WHERE owner_id = auth.uid()
  ),
  today AS (
    SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS d
  ),
  task_agg AS (
    SELECT
      t.project_id,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE t.status = 'Finalizada')::int  AS done,
      COUNT(*) FILTER (WHERE t.status = 'Bloqueada')::int   AS blocked,
      COUNT(*) FILTER (WHERE t.status = 'Sin iniciar')::int AS not_started,
      COUNT(*) FILTER (
        WHERE t.status <> 'Finalizada'
          AND t.end_date IS NOT NULL AND t.end_date <> ''
          AND t.end_date < (SELECT d FROM today)
      )::int AS overdue,
      COUNT(DISTINCT t.responsible) FILTER (
        WHERE t.responsible IS NOT NULL AND t.responsible <> ''
      )::int AS people_count
    FROM public.tasks t
    JOIN my_projects p ON p.id = t.project_id
    GROUP BY t.project_id
  ),
  resp_agg AS (
    SELECT
      t.project_id,
      t.responsible,
      SUM(COALESCE(t.aporte_snapshot, 0)) AS ap,
      ROW_NUMBER() OVER (
        PARTITION BY t.project_id
        ORDER BY SUM(COALESCE(t.aporte_snapshot, 0)) DESC
      ) AS rn
    FROM public.tasks t
    JOIN my_projects p ON p.id = t.project_id
    WHERE t.responsible IS NOT NULL AND t.responsible <> ''
    GROUP BY t.project_id, t.responsible
  ),
  top2 AS (
    SELECT project_id,
      jsonb_agg(jsonb_build_object('name', responsible, 'ap', ap) ORDER BY rn) AS top
    FROM resp_agg
    WHERE rn <= 2
    GROUP BY project_id
  ),
  active_sprint AS (
    SELECT DISTINCT ON (s.project_id) s.project_id, s.name
    FROM public.sprints s
    JOIN my_projects p ON p.id = s.project_id
    WHERE s.status = 'active'
    ORDER BY s.project_id, s.id DESC
  ),
  okr_agg AS (
    SELECT o.project_id, COUNT(*)::int AS okr_count
    FROM public.okrs o
    JOIN my_projects p ON p.id = o.project_id
    WHERE o.status = 'active'
    GROUP BY o.project_id
  )
  SELECT jsonb_build_object(
    'boards', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'project_id',  p.id,
          'name',        p.name,
          'description', p.description,
          'ia_enabled',  p.ia_enabled,
          'total',       COALESCE(ta.total, 0),
          'done',        COALESCE(ta.done, 0),
          'blocked',     COALESCE(ta.blocked, 0),
          'not_started', COALESCE(ta.not_started, 0),
          'in_progress', COALESCE(ta.total, 0) - COALESCE(ta.done, 0) - COALESCE(ta.blocked, 0) - COALESCE(ta.not_started, 0),
          'overdue',     COALESCE(ta.overdue, 0),
          'people_count',COALESCE(ta.people_count, 0),
          'active_sprint', asp.name,
          'okr_count',   COALESCE(oa.okr_count, 0),
          'top',         COALESCE(top2.top, '[]'::jsonb)
        ) ORDER BY p.id
      )
      FROM my_projects p
      LEFT JOIN task_agg ta     ON ta.project_id   = p.id
      LEFT JOIN top2            ON top2.project_id = p.id
      LEFT JOIN active_sprint asp ON asp.project_id = p.id
      LEFT JOIN okr_agg oa      ON oa.project_id   = p.id
    ), '[]'::jsonb),
    'distinct_people', COALESCE((
      SELECT COUNT(DISTINCT t.responsible)
      FROM public.tasks t
      JOIN my_projects p ON p.id = t.project_id
      WHERE t.responsible IS NOT NULL AND t.responsible <> ''
    ), 0)
  );
$$;

REVOKE ALL ON FUNCTION public.owner_boards_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_boards_overview() TO authenticated;

COMMIT;
