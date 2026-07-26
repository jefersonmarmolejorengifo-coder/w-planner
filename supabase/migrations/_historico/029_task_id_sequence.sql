-- Migration 029: Replace the global app_config 'nextId' counter with a native
-- Postgres SEQUENCE for task ids (H-014, escalabilidad/concurrencia).
--
-- Problema previo: claim_task_id() hacía
--     UPDATE app_config SET value = value + 1 WHERE key = 'nextId'
-- Como hay una fila 'nextId' por proyecto (migración 002), el UPDATE sin filtro
-- por project_id tocaba TODAS las filas en cada llamada → contención cross-tenant
-- (crear una tarjeta en un proyecto bloqueaba las filas de todos los tableros) y
-- costo O(#proyectos) que empeora con la escala. Además disparaba un broadcast
-- realtime sobre app_config en cada reserva.
--
-- Solución: una SEQUENCE global lock-free. nextval() no toma locks de fila, no
-- escribe en app_config y no produce broadcast. tasks.id ya es un PK global
-- (un solo contador compartido), así que la semántica de unicidad se conserva.
--
-- Ejecutar después de 028. Idempotente.

BEGIN;

-- 1. Secuencia global para ids de tareas.
CREATE SEQUENCE IF NOT EXISTS public.tasks_id_seq;

-- 2. Sembrar la secuencia por encima del máximo id ya existente y del contador
--    'nextId' heredado (que pudo quedar adelantado por ids reservados al abrir el
--    formulario sin guardar). GREATEST evita colisiones en ambos sentidos.
DO $$
DECLARE
  max_id  BIGINT;
  max_cfg BIGINT;
BEGIN
  SELECT COALESCE(MAX(id), 0) INTO max_id FROM public.tasks;
  -- 'nextId' puede estar guardado como jsonb o text; value::text::BIGINT cubre
  -- ambos casos (mismo cast que usaba la función legacy).
  SELECT COALESCE(MAX(value::text::BIGINT), 0) INTO max_cfg
    FROM public.app_config WHERE key = 'nextId';
  -- is_called=true → la próxima llamada a nextval devuelve seed+1, sin reusar el
  -- máximo ya tomado.
  PERFORM setval('public.tasks_id_seq', GREATEST(max_id, max_cfg, 1), true);
END $$;

-- 3. Reescribir claim_task_id() como un nextval() lock-free. Se mantiene la firma
--    y el nombre para no tocar el contrato con el frontend (supabase.rpc).
DROP FUNCTION IF EXISTS public.claim_task_id();

CREATE OR REPLACE FUNCTION public.claim_task_id()
RETURNS BIGINT AS $$
  SELECT nextval('public.tasks_id_seq');
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public;

-- 4. Re-aplicar los grants (igual que en 007): solo authenticated.
REVOKE ALL ON FUNCTION public.claim_task_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_task_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_task_id() TO authenticated;

COMMIT;
