-- 040_webhook_dedup_status_and_outbox_claim.sql
--
-- Resuelve dos hallazgos de integridad de pagos:
--
-- #1 (ALTO) Envenenamiento de idempotencia del webhook MP
--   Agrega columna `status` a mp_webhook_events para distinguir un evento
--   "en vuelo" (processing) de uno completado (processed). El handler la lee
--   ante un 23505 para decidir si es duplicado real o reintento legítimo.
--
-- #6 (MEDIO) hub_outbox_claim no marcaba filas como reclamadas
--   El SELECT ... FOR UPDATE SKIP LOCKED soltaba el lock al retornar la RPC,
--   dejando la ventana para que dos crons solapados procesaran la misma fila.
--   La función reescrita hace UPDATE ... RETURNING dentro de la misma sentencia,
--   moviendo las filas a status='processing' con attempts ya incrementado.
--   El CHECK constraint de hub_outbox se amplía para incluir 'processing'.
--
-- Seguridad en caliente:
--   - ALTER TABLE con ADD COLUMN usa DEFAULT → no bloquea reads ni writes.
--   - DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT → sin downtime (valor 'processing'
--     solo se usa en filas reclamadas activas, no afecta filas históricas en
--     'pending'/'sent'/'failed'/'dead').
--   - CREATE OR REPLACE FUNCTION → atómica, sin DROP previo.
--   - Idempotente: todos los DDL usan IF NOT EXISTS / OR REPLACE / IF EXISTS.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 1: mp_webhook_events — columna status (#1)
-- ────────────────────────────────────────────────────────────────────────────

-- La tabla pudo haber sido creada por una migración anterior (no numerada).
-- Si no existe, la creamos aquí con todas las columnas necesarias.
CREATE TABLE IF NOT EXISTS public.mp_webhook_events (
  id         BIGSERIAL   PRIMARY KEY,
  event_id   TEXT        NOT NULL,
  event_type TEXT,
  data_id    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mp_webhook_events_event_id_unique UNIQUE (event_id)
);

-- Agregar columna status si no existe. ALTER TABLE ... ADD COLUMN IF NOT EXISTS
-- no bloquea DML en Postgres 9.6+; el DEFAULT se escribe en el catálogo y no
-- hace UPDATE de filas existentes (fast path para columnas con DEFAULT estático).
ALTER TABLE public.mp_webhook_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processed';
-- Default 'processed' para filas históricas (antes del fix): se asumen
-- procesadas, así los reintentos de MP los tratan como duplicados reales.

-- Aplicar el CHECK constraint de forma idempotente.
-- DROP + ADD en el mismo ALTER TABLE es atómico (una transacción en Postgres).
ALTER TABLE public.mp_webhook_events
  DROP CONSTRAINT IF EXISTS mp_webhook_events_status_check;
ALTER TABLE public.mp_webhook_events
  ADD CONSTRAINT mp_webhook_events_status_check
    CHECK (status IN ('processing', 'processed'));

-- Índice para acelerar el SELECT de status en el path de conflicto 23505.
CREATE INDEX IF NOT EXISTS mp_webhook_events_event_id_idx
  ON public.mp_webhook_events (event_id);

-- ────────────────────────────────────────────────────────────────────────────
-- PARTE 2: hub_outbox — CHECK amplificado + claim atómico (#6)
-- ────────────────────────────────────────────────────────────────────────────

-- Ampliar el CHECK para incluir 'processing' de forma idempotente.
ALTER TABLE public.hub_outbox
  DROP CONSTRAINT IF EXISTS hub_outbox_status_check;
ALTER TABLE public.hub_outbox
  ADD CONSTRAINT hub_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead'));

-- Índice para el drain: incluir 'processing' con next_attempt_at pasado permite
-- al cron recuperar filas bloqueadas por instancias muertas.
DROP INDEX IF EXISTS public.hub_outbox_drain_idx;
CREATE INDEX IF NOT EXISTS hub_outbox_drain_idx
  ON public.hub_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'failed', 'processing');

-- Reescritura de hub_outbox_claim (#6):
-- El SELECT ... FOR UPDATE SKIP LOCKED en una función SQL devuelve las filas
-- bloqueadas pero el lock se libera al retornar la RPC. Dos crons solapados
-- podían reclamar las mismas filas porque el SKIP LOCKED opera dentro de la
-- función, no en la transacción del caller (que es auto-commit vía REST).
--
-- La solución: usar UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)
-- RETURNING ... en una sola sentencia. El lock se toma, el UPDATE se aplica
-- y el RETURNING devuelve las filas modificadas, todo en una transacción interna.
-- Dos llamadas concurrentes no pueden actualizar las mismas filas porque el
-- UPDATE adquiere locks de fila exclusivos antes de modificarlas.
--
-- Invariante de attempts: el claim incrementa attempts +1. El cron usa el valor
-- recibido directamente como "intentos consumidos" sin volver a incrementar.
-- Eso evita el double-counting que ocurría cuando el cron calculaba newAttempts
-- = item.attempts + 1 sobre filas ya reclamadas.
--
-- Recuperación de instancias muertas (futuro): se puede agregar un cron de
-- cleanup que ponga de vuelta en 'pending' las filas en 'processing' con
-- updated_at > N minutos. Por ahora no se incluye para no ampliar este PR.
CREATE OR REPLACE FUNCTION public.hub_outbox_claim(p_limit INT DEFAULT 5)
RETURNS TABLE (
  id            BIGINT,
  mp_payment_id TEXT,
  payload       JSONB,
  attempts      INT,
  max_attempts  INT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.hub_outbox
  SET
    status         = 'processing',
    attempts       = attempts + 1,
    updated_at     = NOW()
  WHERE id IN (
    SELECT id
    FROM   public.hub_outbox
    WHERE  status IN ('pending', 'failed')
      AND  next_attempt_at <= NOW()
    ORDER  BY next_attempt_at ASC
    LIMIT  p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, mp_payment_id, payload, attempts, max_attempts;
$$;

-- Mantener los permisos (SECURITY DEFINER ya aplica service_role al llamar).
REVOKE EXECUTE ON FUNCTION public.hub_outbox_claim(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.hub_outbox_claim(INT) TO service_role;

COMMIT;

-- Verificaciones post-apply (correr manualmente si se desea):
--
-- CHECK #1: columna status en mp_webhook_events
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'mp_webhook_events' AND column_name = 'status';
--
-- CHECK #6: distribución de estados en hub_outbox
--   SELECT status, COUNT(*) FROM public.hub_outbox GROUP BY status;
--
-- CHECK #6: firma de la función actualizada
--   SELECT pg_get_functiondef(oid)
--     FROM pg_proc
--    WHERE proname = 'hub_outbox_claim';
