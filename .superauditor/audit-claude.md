# Auditoría A — Claude (Opus 4.8)

**Proyecto:** w-planner (Productivity-Plus)
**Rango:** `7681794..HEAD` (hub integration + admin plans migración 035 + rebrand/responsive v1.1.0)
**Fecha:** 2026-06-24
**Modelo Auditor A:** claude-opus-4-8 (el mejor de la línea — sin advertencia de fallback)
**Método:** orquestación de 5 subagentes especialistas (infra-scalability, ui-ux, security, backend-dev, frontend) sobre los 5 ejes.

> Nota: esta ronda audita PRINCIPALMENTE el código nuevo desde la última auditoría, pero re-verifica los hallazgos abiertos previos (H-007/H-013/H-014/H-017/H-019 dependen de migraciones 029/030 aún pendientes de aplicar).

---

## Eje 1 — Arquitectura

### A26 | ALTO | El orquestador sigue con ~2.300 líneas y 7-8 componentes de peso embebidos
**Evidencia:** `src/ProductivityPlus.jsx:536-680` (BoardSummaryPill 145 líneas), `:1302-1431` (TeamPulseTab+PulseList 130 líneas, NO lazy), `:682-1236` (ProjectLandingScreen 554 líneas), `:317-519` (IntroScreen 202 líneas, siempre cargada).
**Impacto:** estos componentes entran al chunk inicial. TeamPulseTab e IntroScreen deberían ser lazy.
**Esfuerzo:** BAJO (extraer a features/ + React.lazy).

### A27 | ALTO | Bundle inicial sin manualChunks: supabase-js (196 kB) en el chunk pesado
**Evidencia:** `vite.config.js` (sin `build.rollupOptions.output.manualChunks`); `dist/assets/index-*.js` 334 kB / 100 kB gz.
**Recomendación:** separar `@supabase/supabase-js` en vendor chunk para cachearlo entre deploys.
**Esfuerzo:** BAJO (5 líneas).

### A28 | MEDIO | PlansLauncher llama RPC user_ia_capacity en cada apertura del modal
**Evidencia:** `src/ProductivityPlus.jsx:1478-1543` (useEffect `[open]` sin caché).
**Esfuerzo:** BAJO.

---

## Eje 2 — Seguridad

### A29 | CRÍTICO | Secretos de producción reales en `.env.local`
**Evidencia:** `.env.local:3-16` — `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `GOOGLE_API_KEY`, `VERCEL_OIDC_TOKEN`.
**Impacto:** no comiteado (`.gitignore` cubre `*.local`), pero existe en disco en texto claro. La service-role bypassa toda RLS. Decisión del dueño: riesgo aceptado por ahora (repo privado), rotación diferida.
**Recomendación:** rotar todas; en local usar solo keys sandbox; pre-commit hook anti-secretos.
**Esfuerzo:** BAJO (rotación) — requiere acción del dueño en dashboards.

### A30 | ALTO | Posible grant residual a `anon` en `user_can_use_ia_on_project`
**Evidencia:** `migrations/016_premium_system.sql:149` (`GRANT ... TO authenticated, anon`); `migrations/031` revoca, pero el estado en prod depende de que 031 se aplicara. (Carry-forward parcial de H-020.)
**Recomendación:** verificar en prod `SELECT grantee FROM information_schema.routine_privileges WHERE routine_name='user_can_use_ia_on_project' AND grantee='anon'`; si hay fila → migración de saneamiento.
**Esfuerzo:** BAJO.

### A31 | OK-verificado | Migración 035 (admin_user_plans) bien blindada
**Evidencia:** `migrations/035_admin_user_plans.sql:35` (REVOKE vista a anon/authenticated), `:75` (REVOKE función), `:40` (search_path fijado).
**Veredicto:** NO filtra emails ni permite auto-upgrade. La service-role NO llega al cliente (`src/supabaseClient.js:4` usa solo anon key; grep de SERVICE_ROLE en src/ = 0; bundle inspeccionado limpio).

---

## Eje 3 — Pentesting interno (defensivo)

### A32 | CRÍTICO | Race condition de cuota de chat (doble gasto de tokens)
**Evidencia:** `api/chat-stream.js:144-151` (check de cuota es lectura) + `:205-208` (insert del mensaje después). Dos requests simultáneos pasan el check con el mismo `remaining`.
**Impacto:** quema 2 turnos contando 1; con varias pestañas el usuario excede la cuota y multiplica costo IA.
**Recomendación:** increment atómico en Postgres (insert + count en misma transacción/RPC).
**Esfuerzo:** MEDIO.

### A33 | ALTO | Endpoints de generación IA no validan `periodStart < periodEnd`
**Evidencia:** `api/generate-evolution.js:327`, `api/save-evolution.js:48`, `api/generate-monthly-report.js:312`, `api/generate-scrum-report.js:243` (solo `generate-report.js:318` lo hace).
**Impacto:** gasto de tokens con rango inválido + posible sobrescritura de histórico con un evolutivo vacío (upsert).
**Esfuerzo:** BAJO.

### A34 | MEDIO | `open-retro` reenvía emails con `trigger="manual"` saltando idempotencia
**Evidencia:** `api/open-retro.js:99-100` (`if (notifications_sent && trigger !== "manual")`), sin rate limit en el endpoint.
**Impacto:** owner puede spamear emails de retro a todo el equipo.
**Esfuerzo:** BAJO.

---

## Eje 4 — Integridad de conexiones / datos

### A35 | CRÍTICO | Trigger de límite de tableros: status no-activo no degrada bien
**Evidencia:** `migrations/027_project_limit_enforcement.sql:45` (condición de degradado). Un usuario con `status=pending` (checkout sin pagar) puede no caer a free.
**Recomendación:** degradar a free ante CUALQUIER status != 'active' (`IF v_status <> 'active' THEN v_tier := 'free'`).
**Esfuerzo:** BAJO (migración de saneamiento).

### A36 | ALTO | Pago recurrente no setea `tier` → usuario paga y queda en free
**Evidencia:** `api/mp-webhook.js:251` (upsert del evento `subscription_authorized_payment` sin `tier`); `migrations/016:51-56` (DEFAULT 'free'). Si no hubo evento preapproval previo, el usuario queda free con status active.
**Recomendación:** incluir `tier: tier || 'free'` con el tier parseado del external_reference (ya disponible).
**Esfuerzo:** BAJO.

### A37 | ALTO | Señales de retro: DELETE+INSERT no atómico → corrupción silenciosa
**Evidencia:** `api/submit-retro.js:57` (UPDATE) + `:63` (DELETE) + `:86-88` (INSERT). Si el proceso muere entre DELETE e INSERT, las señales quedan vacías sin error.
**Recomendación:** RPC transaccional o reordenar (INSERT antes de DELETE / ON CONFLICT).
**Esfuerzo:** MEDIO.

### A38 | ALTO | Over-fetch y N+1 en la carga del proyecto
**Evidencia:** `src/hooks/useProjectData.js:48` (`select('*')` sobre tasks/participants/etc.), `:86` (N+1 key_results tras OKRs); `src/features/board/TaskForm.jsx:264` y `BoardTab.jsx:241` (`task_history.select('*')`).
**Recomendación:** proyectar columnas; embedded select `okrs(*, key_results(*))`.
**Esfuerzo:** BAJO-MEDIO.

### A39 | MEDIO | Chat fail-open si `createAdminClient()` es null
**Evidencia:** `api/chat-stream.js:203-208` (`if (admin) {...}` envuelve el persist, pero el LLM se llama igual). Sin admin, se gastan tokens y la cuota nunca avanza.
**Recomendación:** fail-closed: validar `admin` al inicio del handler.
**Esfuerzo:** BAJO.

---

## Eje 5 — UX / UI técnico (incluye RESPONSIVE)

### A40 | ALTO | Header principal sin colapso responsive
**Evidencia:** `src/ProductivityPlus.jsx:2018` (`flexWrap:"wrap"` sin control). En <480px los 10+ controles explotan en filas solapadas; PDF/CSV con `marginLeft:auto` quedan sueltos.
**Esfuerzo:** MEDIO.

### A41 | ALTO | Bug latente del menú responsive (ResizeObserver) — CAMBIO RECIENTE
**Evidencia:** `src/ProductivityPlus.jsx:1887` (`tabsNeedWidthRef` arranca en 0 → expande mal en primer render estrecho) + `:1898` (effect con `tabsCollapsed` en deps → loop de reconexión disconnect/observe).
**Impacto:** parpadeo del menú en resize continuo / móvil; flash en primer render estrecho.
**Recomendación:** sacar `tabsCollapsed` de deps; espejo del estado en ref; inicializar `tabsNeedWidthRef` en useLayoutEffect.
**Esfuerzo:** BAJO (30 min, fix de alta confianza).

### A42 | ALTO | Gantt ancho fijo 660px + resizer solo-mouse → inservible en táctil/<870px
**Evidencia:** `src/features/board/GanttTab.jsx:30` (`CHART_W=660`); resizer con `mousemove`/`mouseup`.
**Esfuerzo:** ALTO.

### A43 | ALTO | `alert()`/`confirm()` nativos bloqueantes (consenso interno ui-ux + frontend)
**Evidencia:** `src/hooks/useTasks.js:36,77,139,155`, `src/ProductivityPlus.jsx:265,293`.
**Impacto:** rompen coherencia visual, bloquean hilo, inaccesibles.
**Recomendación:** componente Toast no bloqueante.
**Esfuerzo:** MEDIO.

### A44 | MEDIO | Panel de notificaciones y dropdown del hamburguesa sin clamp al viewport
**Evidencia:** `src/ProductivityPlus.jsx:2103` (notif `minWidth:300, right:0`), `:2155-2158` (dropdown `minWidth:220, left:0` sin `max-width: calc(100vw - 40px)`).
**Esfuerzo:** BAJO.

### A45 | MEDIO | Tooltip del tour se desborda en pantallas <440px
**Evidencia:** `src/Onboarding.jsx:579,588` (ancho fijo 440/520; el clamp da negativo si `innerWidth < tooltipW+32`).
**Esfuerzo:** MEDIO.

### A46 | BAJO | Guard huérfano de rebrand
**Evidencia:** `src/features/config/ConfigTab.jsx:190` (`if (target.name === "Jeferson Marmolejo") return;`). Dead code sin consecuencia de seguridad.
**Esfuerzo:** BAJO.

---

## Resumen Auditor A

| Eje | Nota | Hallazgos nuevos |
|---|---|---|
| Arquitectura | 6.5/10 | A26-A28 |
| Seguridad | 8.4/10 (no pasa gate 9.5) | A29-A31 |
| Pentesting interno | — | A32-A34 |
| Integridad conexiones/datos | 6.5/10 | A35-A39 |
| UX/UI + Responsive | UX 7 / Responsive 4.5 | A40-A46 |

**Críticos:** A29 (secretos), A32 (race cuota chat), A35 (trigger límite tableros).
**Re-verificar previos:** H-013/H-014/H-017/H-019/H-007 dependen de aplicar migraciones 029/030 — confirmar estado en prod.
