-- Migration 021: enforce 60 días entre generaciones del Evolutivo.
--
-- Hasta hoy un PO podría generar la tarjeta 100 veces al día e inflar el
-- gasto. Ahora la regla es: no puedes generar otra antes de 60 días desde
-- la última. La RPC can_generate_evolution() expone esto al frontend para
-- desactivar el botón y mostrar fecha disponible.

BEGIN;

CREATE OR REPLACE FUNCTION public.can_generate_evolution(p_project_id BIGINT)
RETURNS TABLE(
  can_generate BOOLEAN,
  last_generated_at TIMESTAMPTZ,
  next_available_at TIMESTAMPTZ,
  days_remaining INTEGER,
  reason TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH last AS (
    SELECT MAX(generated_at) AS last_at
    FROM public.user_evolutions
    WHERE project_id = p_project_id
  )
  SELECT
    CASE
      WHEN last.last_at IS NULL THEN true
      WHEN last.last_at + INTERVAL '60 days' <= NOW() THEN true
      ELSE false
    END AS can_generate,
    last.last_at AS last_generated_at,
    CASE
      WHEN last.last_at IS NULL THEN NULL
      ELSE last.last_at + INTERVAL '60 days'
    END AS next_available_at,
    CASE
      WHEN last.last_at IS NULL THEN 0
      ELSE GREATEST(0, EXTRACT(DAY FROM (last.last_at + INTERVAL '60 days' - NOW()))::int)
    END AS days_remaining,
    CASE
      WHEN last.last_at IS NULL THEN 'Primera vez disponible'
      WHEN last.last_at + INTERVAL '60 days' <= NOW() THEN 'Disponible para regenerar'
      ELSE 'Debe esperar 60 dias desde el ultimo evolutivo para evitar costos repetidos'
    END AS reason
  FROM last;
$$;

GRANT EXECUTE ON FUNCTION public.can_generate_evolution(BIGINT) TO authenticated;

COMMIT;
