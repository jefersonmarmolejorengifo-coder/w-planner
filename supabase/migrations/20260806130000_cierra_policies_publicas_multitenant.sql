-- ─────────────────────────────────────────────────────────────────────────────
-- SEGURIDAD CRÍTICA — Cierra la fuga multi-tenant: cualquiera podía leer y
-- modificar los datos de TODOS los tableros sin iniciar sesión.
--
-- HALLAZGO
--   Sobrevivían 8 policies heredadas de la época pre-RLS, definidas
--   `TO public USING (true)` (o `TO anon`). En Postgres las policies permisivas
--   se combinan con OR, así que cada una de ellas ANULABA por completo a la
--   policy por miembro que se había añadido después. Como además los roles
--   `anon` y `authenticated` tienen GRANT de SELECT/INSERT/UPDATE/DELETE sobre
--   esas tablas, el resultado era acceso total con la anon key — que viaja
--   pública dentro del bundle JavaScript de la app.
--
--   Verificado ejecutando como rol `anon` contra producción (2026-08-06):
--     tasks           534 filas legibles  (y modificables/borrables)
--     participants     24
--     indicators       17
--     task_types        8
--     app_config        3
--     email_config      3   ← contiene `emails` (jsonb): destinatarios reales
--                             de los informes, es decir datos personales.
--
--   Las policies correctas (is_project_member / is_project_owner) ya existían y
--   son las que quedan mandando. `projects` y `project_members` nunca
--   estuvieron expuestas, por eso la fuga no se notaba desde la interfaz.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. Elimina las 8 policies permisivas.
--   2. Añade en `participants` las dos policies que faltaban para que un
--      miembro no dueño pueda crear y mantener SU PROPIA ficha (es lo único
--      legítimo que hacía a través de la policy abierta, en
--      useProjectData.loadAllForProject).
--   3. Revoca todos los privilegios de `anon` sobre las 6 tablas: defensa en
--      profundidad, para que una policy mal escrita en el futuro no vuelva a
--      abrir la puerta. La app exige sesión para todo; `anon` no necesita nada.
--
-- COMPROBADO ANTES DE ESCRIBIRLA — ningún camino de la app se rompe:
--   · tasks         → `tasks_member_all` (ALL para miembros) ya cubre todo.
--   · indicators    → se escriben solo desde Configuración, que es exclusiva
--                     del dueño (TABS_ALL: config -> allowedRoles []), y al
--                     crear el tablero desde plantilla, donde el creador ES el
--                     dueño. Cubierto por `indicators_owner_all`.
--   · task_types    → mismo caso (`saveTaskTypes` vive en Configuración).
--                     Cubierto por `task_types_owner_all` + lectura con
--                     `task_types_select_scoped`.
--   · app_config    → el cliente solo hace SELECT (`app_config_project_read`).
--                     claim_task_id() es SECURITY DEFINER y no depende de RLS.
--   · email_config  → lo lee/escribe ConfigTab (dueño) y api/cron.js con la
--                     service_role, que ignora RLS. Cubierto por
--                     `email_config_owner_all`.
--   · participants  → ConfigTab (dueño) + la ficha propia de cada miembro, que
--                     es justo lo que habilitan las policies nuevas. El alta
--                     por invitación la hace join_project_by_invite_code(), que
--                     es SECURITY DEFINER y tampoco depende de RLS.
--
-- IDEMPOTENTE: se puede correr varias veces sin efecto.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Fuera las policies abiertas ───────────────────────────────────────────
DROP POLICY IF EXISTS "public_all_tasks"        ON public.tasks;
DROP POLICY IF EXISTS "public_all_participants" ON public.participants;
DROP POLICY IF EXISTS "public_all_indicators"   ON public.indicators;
DROP POLICY IF EXISTS "public_all_config"       ON public.app_config;
DROP POLICY IF EXISTS "task_types_select"       ON public.task_types;
DROP POLICY IF EXISTS "task_types_insert"       ON public.task_types;
DROP POLICY IF EXISTS "task_types_delete"       ON public.task_types;
DROP POLICY IF EXISTS "allow all"               ON public.email_config;

-- ── 2. Un miembro gestiona su propia ficha de participante ───────────────────
-- Sin esto, quien no es dueño del tablero no podría registrarse como
-- participante al abrirlo y se quedaría sin usuario activo.
-- Nota: la creación del participante "Usuario" por defecto (sin auth_user_id)
-- queda reservada al dueño; es un residuo heredado y ningún miembro la necesita.
DROP POLICY IF EXISTS "participants_self_insert" ON public.participants;
CREATE POLICY "participants_self_insert" ON public.participants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(project_id) AND auth_user_id = auth.uid());

DROP POLICY IF EXISTS "participants_self_update" ON public.participants;
CREATE POLICY "participants_self_update" ON public.participants
  FOR UPDATE TO authenticated
  USING      (public.is_project_member(project_id) AND auth_user_id = auth.uid())
  WITH CHECK (public.is_project_member(project_id) AND auth_user_id = auth.uid());

-- ── 3. `anon` no tiene nada que hacer en estas tablas ────────────────────────
REVOKE ALL ON public.tasks         FROM anon;
REVOKE ALL ON public.participants  FROM anon;
REVOKE ALL ON public.indicators    FROM anon;
REVOKE ALL ON public.task_types    FROM anon;
REVOKE ALL ON public.app_config    FROM anon;
REVOKE ALL ON public.email_config  FROM anon;

COMMIT;

-- ─── Verificación (correr después de aplicar) ────────────────────────────────
--
-- 1) No debe quedar ninguna policy permisiva abierta:
--
-- SELECT tablename, policyname, roles::text, cmd
-- FROM pg_policies
-- WHERE schemaname='public' AND qual = 'true' AND roles::text ~ '(public|anon)';
--
-- 2) Barrido anónimo y aislamiento entre tableros:
--    scripts/smoke-rls-tenant-isolation.sql   (no debe reportar nada expuesto)
--
-- 3) El flujo de invitación tiene que seguir intacto:
--    scripts/smoke-join-invite.sql
