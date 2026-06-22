-- Migration 033: Rate limiting server-side para endpoints que generan costo (H-010).
--
-- Vercel es stateless, así que el contador vive en Postgres. Usamos una ventana
-- fija (fixed window) alineada al epoch: barato (un upsert por request) y
-- suficiente para frenar abuso/scripts contra invite, generate-* y chat.
--
-- La tabla solo se toca vía la RPC SECURITY DEFINER (y service_role); no se
-- exponen policies a authenticated/anon.
--
-- Ejecutar después de 032. Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key   TEXT        NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
-- Sin policies: inaccesible a authenticated/anon salvo a través de la RPC.

-- Incrementa el contador de la ventana actual para la clave y devuelve TRUE si
-- aún está dentro del límite (count <= p_max). Fixed-window alineado al epoch.
CREATE OR REPLACE FUNCTION public.check_rate_limit(p_key TEXT, p_max INT, p_window_seconds INT)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count        INT;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 OR p_max IS NULL OR p_max <= 0 THEN
    RETURN TRUE; -- configuración inválida: no bloquear
  END IF;

  v_window_start := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

  INSERT INTO public.api_rate_limits (bucket_key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = public.api_rate_limits.count + 1
  RETURNING count INTO v_count;

  -- Limpieza oportunista y barata de ventanas viejas (~2% de las llamadas).
  IF random() < 0.02 THEN
    DELETE FROM public.api_rate_limits WHERE window_start < now() - INTERVAL '1 day';
  END IF;

  RETURN v_count <= p_max;
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) TO authenticated;

COMMIT;
