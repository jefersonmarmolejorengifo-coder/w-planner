-- 026_mp_webhook_idempotency.sql (SuperAuditor H-001)
-- Registro de eventos de webhook de Mercado Pago ya procesados, para
-- idempotencia frente a reintentos/duplicados de MP. La escritura la hace
-- api/mp-webhook.js vía service_role (que bypassa RLS). No hay políticas para
-- authenticated: la tabla es interna y nadie más la toca.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mp_webhook_events (
  event_id     TEXT PRIMARY KEY,          -- x-request-id (único por notificación) o "<type>:<data_id>"
  event_type   TEXT,
  data_id      TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mp_webhook_events_processed_at_idx
  ON public.mp_webhook_events(processed_at);

ALTER TABLE public.mp_webhook_events ENABLE ROW LEVEL SECURITY;
-- Sin políticas para authenticated/anon: acceso solo por service_role.

COMMIT;
