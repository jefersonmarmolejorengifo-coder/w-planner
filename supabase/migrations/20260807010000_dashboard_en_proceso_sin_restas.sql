-- ─────────────────────────────────────────────────────────────────────────────
-- owner_boards_overview: "en proceso" dejaba de calcularse por resta.
--
-- EL FALLO
--   `in_progress` se obtenía restando: total − finalizadas − bloqueadas − sin
--   iniciar. Esa resta absorbe TODO lo demás: canceladas, en pausa y no
--   programadas. Un tablero con 10 tareas —1 en proceso, 2 finalizadas, 1
--   bloqueada, 3 sin iniciar, 2 canceladas y 1 en pausa— anunciaba "4 en
--   proceso" cuando solo había una.
--
--   Nadie lo notaba porque la cifra siempre es plausible y la barra siempre
--   suma 100%: para verlo hay que contar el kanban a mano.
--
-- CAMBIO
--   Se cuenta 'En proceso' explícitamente y se expone 'cancelled' aparte, para
--   que el dashboard pueda excluir las canceladas del avance igual que hace la
--   pestaña de Métricas ("Excluye canceladas y no programadas"). Hasta ahora el
--   MISMO tablero mostraba dos porcentajes distintos según dónde se mirara.
--
--   El resto del cuerpo es exactamente el que estaba en producción: se tomó con
--   pg_get_functiondef, no se reescribió de memoria.
--
-- IDEMPOTENTE: es un CREATE OR REPLACE.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION public.owner_boards_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      COUNT(*) FILTER (WHERE t.status = 'En proceso')::int  AS in_progress,
      COUNT(*) FILTER (WHERE t.status = 'Cancelada')::int   AS cancelled,
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
          'in_progress', COALESCE(ta.in_progress, 0),
          'cancelled',   COALESCE(ta.cancelled, 0),
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
$function$;

REVOKE ALL ON FUNCTION public.owner_boards_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_boards_overview() TO authenticated, service_role;

COMMIT;

-- ─── Verificación ────────────────────────────────────────────────────────────
-- Debe devolver in_progress contando solo 'En proceso', y cancelled aparte:
-- SELECT jsonb_pretty(public.owner_boards_overview());
