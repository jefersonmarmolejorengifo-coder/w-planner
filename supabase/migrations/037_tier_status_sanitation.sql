-- 037_tier_status_sanitation.sql
-- H-033 / B-1 (verificación + saneamiento) y rastro de B-4.
--
-- VEREDICTO H-033: el trigger enforce_project_limit (migración 027) YA degrada
-- a 'free' cualquier fila con tier!='free' AND status!='active', y mp-subscribe
-- escribe tier='free' para los checkouts 'pending'. Además users_premium.status
-- es NOT NULL con CHECK IN ('active','pending','past_due','cancelled'), así que
-- el COALESCE(status,'active') del trigger solo aplica a usuarios SIN fila (=free).
-- => No existe en el código actual un camino donde un no-pagador termine con
--    tier!='free' AND status='active'. La "creación de tableros sin pagar" NO es
--    reproducible. Se marca H-033 como verificado/no-reproducible.
--
-- Esta migración NO cambia el trigger (ya es correcto). Hace dos cosas seguras:
--   1. Saneamiento idempotente de RESIDUOS HISTÓRICOS: filas con un tier de pago
--      pero en un estado que NO paga ('pending' = nunca pagó, 'cancelled' =
--      terminal). Se normaliza su tier a 'free' para que el dato almacenado sea
--      honesto y la vista admin_user_plans no muestre un plan que no aplica.
--      ('past_due' se DEJA intacto: MP puede reintentar y reactivar.)
--   2. Queries de AUDITORÍA (comentadas) para revisar a mano posibles víctimas
--      de B-4 (pagaron pero quedaron en 'free'); su tier real no es deducible en
--      SQL (el metadata.target_tier lo sobrescriben los eventos del webhook), así
--      que se corrigen con admin_set_user_plan(email, tier) tras inspección.

BEGIN;

-- ── 1. Saneamiento seguro de residuos históricos ─────────────────────────────
-- Un tier de pago en estado 'pending'/'cancelled' es incoherente: ese usuario no
-- está pagando. El trigger ya les niega tableros extra; esto solo alinea el dato.
UPDATE public.users_premium
   SET tier = 'free'
 WHERE tier <> 'free'
   AND status IN ('pending', 'cancelled');

COMMIT;

-- ── 2. Auditoría manual (correr en el SQL editor; no modifican nada) ──────────
--
-- 2a. Filas con tier de pago en estado no-activo que quedan (solo 'past_due', a
--     propósito): el trigger ya las limita, pero conviene vigilarlas.
--   SELECT user_id, tier, status, current_period_end, last_payment_at
--   FROM public.users_premium
--   WHERE tier <> 'free' AND status <> 'active';
--
-- 2b. Posibles VÍCTIMAS DE B-4 (pagaron, pero el upsert del pago no fijó el tier):
--     status='active', tier='free', con suscripción MP asociada y SIN ser
--     cortesía admin. Revisar cada una y, si corresponde, promover con
--     admin_set_user_plan(email, '<tier_real>').
--   SELECT up.user_id, au.email, up.status, up.tier, up.mp_preapproval_id,
--          up.last_payment_at, up.metadata
--   FROM public.users_premium up
--   JOIN auth.users au ON au.id = up.user_id
--   WHERE up.status = 'active'
--     AND up.tier = 'free'
--     AND up.mp_preapproval_id IS NOT NULL
--     AND COALESCE(up.metadata->>'grant', '') <> 'comp';
--
-- 2c. Tableros por encima del límite del plan vigente (deuda histórica anterior
--     al enforcement de 027; el trigger es BEFORE INSERT y no borra lo ya creado):
--   SELECT p.owner_id, COALESCE(up.tier,'free') AS tier,
--          tl.total_projects AS limite, COUNT(*) AS tableros
--   FROM public.projects p
--   LEFT JOIN public.users_premium up ON up.user_id = p.owner_id
--   LEFT JOIN public.tier_limits tl
--     ON tl.tier = CASE WHEN COALESCE(up.tier,'free') <> 'free'
--                        AND COALESCE(up.status,'active') <> 'active'
--                       THEN 'free' ELSE COALESCE(up.tier,'free') END
--   GROUP BY p.owner_id, COALESCE(up.tier,'free'), tl.total_projects
--   HAVING COUNT(*) > tl.total_projects;
