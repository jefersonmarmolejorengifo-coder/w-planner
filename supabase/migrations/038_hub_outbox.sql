-- 038_hub_outbox.sql
-- H-048 (ALTO — dinero) — Durabilidad de notificaciones al hub financiero.
-- El webhook es fail-open con el hub: si el hub cae, el cobro entra pero la
-- comisión se perdia. Esta tabla outbox persiste el payload antes de notificar;
-- el cron drena los pendientes con reintentos y backoff exponencial. El hub
-- deduplica por mp_payment_id, asi que reintentar es idempotente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.hub_outbox (
  id               BIGSERIAL    PRIMARY KEY,
  mp_payment_id    TEXT         NOT NULL,
  payload          JSONB        NOT NULL,
  status           TEXT         NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','sent','failed','dead')),
  attempts         INT          NOT NULL DEFAULT 0,
  max_attempts     INT          NOT NULL DEFAULT 5,
  next_attempt_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_error       TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  sent_at          TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT hub_outbox_mp_payment_id_unique UNIQUE (mp_payment_id)
);

CREATE INDEX IF NOT EXISTS hub_outbox_drain_idx
  ON public.hub_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS hub_outbox_dead_idx
  ON public.hub_outbox (created_at) WHERE status = 'dead';

CREATE OR REPLACE FUNCTION public.hub_outbox_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS hub_outbox_updated_at ON public.hub_outbox;
CREATE TRIGGER hub_outbox_updated_at
  BEFORE UPDATE ON public.hub_outbox
  FOR EACH ROW EXECUTE FUNCTION public.hub_outbox_set_updated_at();

ALTER TABLE public.hub_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hub_outbox FROM PUBLIC, authenticated, anon;
GRANT USAGE, SELECT ON SEQUENCE public.hub_outbox_id_seq TO service_role;

-- Claim atomico para el drain del cron (FOR UPDATE SKIP LOCKED).
CREATE OR REPLACE FUNCTION public.hub_outbox_claim(p_limit INT DEFAULT 5)
RETURNS TABLE (id BIGINT, mp_payment_id TEXT, payload JSONB, attempts INT, max_attempts INT)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, mp_payment_id, payload, attempts, max_attempts
  FROM public.hub_outbox
  WHERE status IN ('pending', 'failed') AND next_attempt_at <= NOW()
  ORDER BY next_attempt_at ASC
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED;
$$;
REVOKE EXECUTE ON FUNCTION public.hub_outbox_claim(INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.hub_outbox_claim(INT) TO service_role;

COMMIT;

-- Verificacion: SELECT status, COUNT(*) FROM public.hub_outbox GROUP BY status;
