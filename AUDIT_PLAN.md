# AUDIT_PLAN.md — Plan de Mejora y Auditoría Triple

> Documento autoactualizable generado y mantenido por **SuperAuditor**.
> Auditoría ejecutada por IAs independientes: Claude (A), Codex/OpenAI (B) y Gemini/Google (C).
> NO editar manualmente las secciones marcadas con 🤖 — serán sobrescritas en la próxima auditoría.
> Las notas humanas van en la sección "Comentarios del equipo" al final.

---

## 📌 Resumen ejecutivo 🤖

- **Proyecto:** `w-planner` (Productivity-Plus)
- **Stack:** SPA Vite + React 19 · Supabase (Postgres + RLS) · Funciones Vercel (Node) · Mercado Pago · Resend · Anthropic/Gemini
- **Última auditoría:** `2026-06-22`
- **Auditores:** Claude (A) en `claude-opus-4-8` + Codex (B) en `gpt-5.5` *(xhigh)* + Gemini (C) en `Gemini 3.1 Pro (High)`.
- **Modo:** `COMPLETO` — los tres auditores concluyeron (triple contraste válido).
- **Commits cubiertos:** `1a90dc1..52ca539` (trabajo de esta sesión) sobre el estado completo del repo.
- **Foco solicitado:** escalabilidad/concurrencia (muchas personas creando tarjetas a la vez), calidad, uso, UX.

### Veredicto de producción
**Funcionalmente listo, pero con un cuello de botella de concurrencia que conviene cerrar antes de escalar usuarios.** El hallazgo dominante para "muchas personas a la vez" es **H-014 (`claim_task_id` global)** — exclusivo de Auditor A. No hay bloqueadores de seguridad nuevos sin mitigación, pero sí varios fail-open y un IDOR de chat a corregir.

### Estado actual

| Métrica | Valor |
|---|---|
| Consenso fuerte `[A+B+C]` | 2 |
| Consenso de pares `[A+B]/[A+C]/[B+C]` | 2 |
| Solo Claude `[A]` | 6 |
| Solo Codex `[B]` | 7 |
| Solo Gemini `[C]` | 2 |
| Discrepancias de severidad | 3 |
| **Cerrados esta ronda** | **3** |
| Críticos abiertos | 0 (1 condicional) |
| Altos abiertos | 6 |
| Medios abiertos | 8 |
| Bajos abiertos | 3 |

<!-- Divergencia: alta dispersión de hallazgos solo-uno (15 de 19). Esperable: A buscó concurrencia, B seguridad de pago/IDOR, C arquitectura/bundle. Revisar los tres lados. -->

### Top 3 prioridades inmediatas

1. **`claim_task_id` serializa la creación de tarjetas a nivel global** `[A]` `ALTO` — el contador vive en `app_config` con un `nextId` por proyecto y el UPDATE no filtra por proyecto → cada creación bloquea las filas de TODOS los tableros y empeora con la escala. Reemplazar por un `SEQUENCE` nativo. (H-014) **← responde directo a tu pregunta de concurrencia.**
2. **Webhook MP fail-open si falta el secreto** `[A+B+C]` `ALTO`/`CRÍTICO` — hacer fail-closed (rechazar sin firma válida). (H-013)
3. **IDOR de `sessionId` en el chat IA** `[B]` `ALTO` — filtrar la sesión por `project_id`+owner para evitar contaminación entre proyectos y bypass de cuota. (H-017)

---

## 🤝 Hallazgos de CONSENSO FUERTE `[A+B+C]` 🤖

### H-002 `[A+B+C]` | ALTO | Arquitectura | Frontend monolítico (`ProductivityPlus.jsx`, ~9.752 líneas)
**Severidad:** A=ALTO, B=ALTO, C=CRÍTICO → se adopta **ALTO** (ver discrepancia). **Esfuerzo:** ÉPICO.
**Evidencia:** `src/ProductivityPlus.jsx:1` (9.752 líneas); Codex: `:2535, :4518, :7204, :8155`.
**Descripción:** Un único componente concentra tablero, billing, reportes, chat, evolutivo, dashboards, onboarding y acceso directo a Supabase. C añade el ángulo de performance: todo entra al bundle inicial (sin code-splitting), penalizando TTI/First Paint.
**Recomendación:** Descomponer por dominio (`features/tasks|billing|reports|chat`), mover mutaciones a hooks/servicios, e introducir `React.lazy` para cargar paneles pesados (planes, reportes, config) bajo demanda.

### H-013 `[A+B+C]` | ALTO | Seguridad | Webhook de Mercado Pago procesa eventos aunque falte el secreto (fail-open)
**Severidad:** A=ALTO, B=ALTO, C=CRÍTICO → se adopta **ALTO** (CRÍTICO si el secreto llegara a faltar). **Esfuerzo:** BAJO.
**Evidencia:** `api/mp-webhook.js:21-26` (`verifyMpSignature` → `null` sin `MP_WEBHOOK_SECRET`), `:124-126` (solo `console.warn` y sigue), `:175` (escribe `users_premium` con service_role).
**Descripción:** Mejoró respecto a la ronda previa (ya valida `x-signature` cuando el secreto existe — H-001 cerrado), pero si la variable no está, no valida y concede premium igual. No es fail-closed.
**Recomendación:** Si no hay secreto o firma válida → 401/503 y no procesar. Validar `MP_WEBHOOK_SECRET` al arranque en producción.

---

## 🤝 Hallazgos de CONSENSO DE PARES 🤖

### H-008 `[A+B]` | MEDIO | UX | Modales sin semántica de diálogo ni control de foco
**Evidencia:** Codex `:8183, :8276`, `src/NameCaptureModal.jsx:50`, `src/Onboarding.jsx:591`; A confirma en los nuevos paneles (Visión consolidada, pastilla, planes).
**Descripción:** Overlays como `div` sin `role="dialog"`, `aria-modal`, trampa de foco ni cierre con `Esc`; `×` sin `aria-label`.
**Recomendación:** Componente modal accesible común (foco inicial/retorno, `Esc`, `aria-labelledby`).

### H-009 `[A+B]` | MEDIO | UX | `outline: none` sin foco visible equivalente (WCAG 2.4.7)
**Evidencia:** Codex `src/NameCaptureModal.jsx:73,84`, `src/ProductivityPlus.jsx:4818,4935`; patrón global.
**Recomendación:** `:focus-visible` global con contraste suficiente; quitar `outline:none` salvo reemplazo.

---

## 🅰️ Hallazgos solo de Claude (A) 🤖

### H-014 `[A]` | ALTO | Escalabilidad/Concurrencia | `claim_task_id()` serializa la creación de tarjetas a nivel GLOBAL ⭐
**Eje:** Arquitectura/Escalabilidad · **Severidad:** ALTO · **Esfuerzo:** MEDIO
**Evidencia:** `migrations/006_security_hardening.sql:81-92` (UPDATE sin `project_id`), `migrations/002_multiproject.sql:29` (un `nextId` por proyecto), `src/ProductivityPlus.jsx:1445` (se reserva al ABRIR el formulario, no al guardar).
**Descripción:** `UPDATE app_config SET value=value+1 WHERE key='nextId'` toca **todas** las filas `nextId` (una por proyecto) en cada llamada. Resultado: (1) contención cross-tenant — crear una tarjeta en un proyecto bloquea las filas de todos; (2) costo O(#proyectos) que empeora con la escala; (3) se dispara al abrir el formulario, amplificando el write global + broadcast realtime y quemando IDs.
**Impacto:** Es el cuello de botella directo de "muchas personas creando tarjetas a la vez". Funciona a baja escala (IDs únicos, locks de µs), pero no escala como debería para producción multi-tenant.
**Recomendación:** Reemplazar por un `SEQUENCE` de Postgres (`nextval`) lock-free, o `IDENTITY` en `tasks.id`; dejar `claim_task_id` como `SELECT nextval('tasks_id_seq')`. Reservar el ID al guardar, no al abrir.

### H-015 `[A]` | MEDIO | Escalabilidad | Visión consolidada agrega en el cliente sin paginación
**Evidencia:** `src/ProductivityPlus.jsx` ConsolidatedDashboard: `from("tasks").select(...).in("project_id", ids)`; mismo patrón en `loadAllForProject`.
**Recomendación:** RPC server-side que devuelva KPIs por tablero ya agregados; paginar/virtualizar listas largas.

### H-016 `[A]` | MEDIO | Concurrencia | UPDATE de tarjeta last-write-wins (lost updates)
**Evidencia:** `src/ProductivityPlus.jsx:9013` (`update().eq('id', task.id)` sin chequear `updated_at`).
**Recomendación:** Optimistic concurrency con `.eq('updated_at', prev)`; si 0 filas → avisar "la tarjeta cambió".

### H-003 `[A]` | ALTO | Calidad | Cero pruebas automatizadas *(consenso A+B en ronda previa; re-confirmado por A)*
**Evidencia:** sin `*.test.*`/`*.spec.*`; `package.json` sin script de test.
**Recomendación:** Vitest. Priorizar lógica pura (aporte, gating) y endpoints de pago/webhook (firma/idempotencia). CI por push.

### H-010 `[A]` | MEDIO | Seguridad | Sin rate limiting en endpoints que generan costo *(carry-forward)*
**Evidencia:** `api/invite.js`, `api/generate-*.js`, `api/chat-stream.js`. **Recomendación:** rate limit por usuario/IP + cap diario por proyecto.

### H-012 `[A]` | BAJO | Seguridad | HTML de IA (evolutivo) persistido sin sanitizar *(carry-forward)*
**Evidencia:** `save-evolution.js`/iframe `srcDoc`. iframe sin `allow-scripts` (riesgo práctico bajo). **Recomendación:** `sanitize-html` antes de persistir.

---

## 🅱️ Hallazgos solo de Codex (B) 🤖

### H-017 `[B]` | ALTO | Pentest (IDOR) | `sessionId` de chat permite contaminación entre proyectos y bypass de cuota
**Evidencia:** `api/chat-stream.js:122,146,170,185`. **Descripción:** valida acceso al `projectId` pero carga la sesión solo por `id`; un owner puede persistir mensajes en sesión de otro proyecto propio. **Fix:** filtrar sesión por `project_id`(+owner); cobrar cuota sobre la sesión real.

### H-018 `[B]` | MEDIO | Pentest (HTML injection) | Nombre de sprint sin escapar en correos de retro
**Evidencia:** `api/open-retro.js:25,32,36,144`. **Fix:** escapar `sprint.name` en HTML y asunto.

### H-019 `[B]` | ALTO | Conexión | El checkout MP inicia aunque falte `SUPABASE_SERVICE_ROLE_KEY`
**Evidencia:** `api/mp-subscribe.js:93-95`, `api/mp-webhook.js:98`. **Descripción:** si falta la key admin, omite guardar el pending pero igual devuelve `init_point` → el usuario paga y puede quedar sin upgrade. **Fix:** validar admin antes de crear la preapproval; si falta → 503.

### H-020 `[B]` | MEDIO | Seguridad | RPCs `SECURITY DEFINER` de features/cuota concedidas a `anon`
**Evidencia:** `migrations/017:30,46`, `migrations/023:22,57` (`project_has_feature`, `project_can_use_chat`, `project_chat_quota_remaining`). **Fix:** revocar `anon`; validar owner/miembro dentro de la RPC.

### H-021 `[B]` | MEDIO | Seguridad | Chat IA no limita el tamaño de `userMessage`
**Evidencia:** `api/chat-stream.js:112-113,185,202`. **Fix:** límite de caracteres/tokens, 413 al exceder, contar antes de persistir/llamar al LLM.

### H-023 `[B]` | MEDIO | Arquitectura | Planes en dos fuentes de verdad (código vs `tier_limits`)
**Evidencia:** `src/plans.js`, `api/mp-subscribe.js:44`, `migrations/028`. **Descripción:** precio en código, gating real en BD; desalineación posible entre cobro y features. **Fix:** fuente canónica server-side o verificación de consistencia en deploy.

### H-022 `[B]` | BAJO | Conexión | Metadata de modelo IA inconsistente (Sonnet llamado, header/UI dicen Opus 4.7)
**Evidencia:** `api/generate-report.js:409,489`, `src/ProductivityPlus.jsx:2721`. **Fix:** centralizar constantes de modelo.

### H-007 `[B]` | ALTO | Seguridad | Roles aplicados solo en UI, no en RLS *(carry-forward, no corregido)*
**Evidencia:** UI filtra tabs por `myRole`; policies `member_all` (`FOR ALL` a cualquier miembro) en `migrations/006:223,267,277`; `migrations/025` no toca RLS. **Fix:** permisos por rol en SQL/RPC; reemplazar `member_all`.

---

## 🅲️ Hallazgos solo de Gemini (C) 🤖

### H-024 `[C]` | MEDIO | Pentest | Sin validación estricta de esquema en los endpoints
**Evidencia:** `api/generate-scrum-report.js:234` y otros `req.body`. **Fix:** Zod/Joi para validar tipos/identificadores antes de procesar.

### H-025 `[C]` | MEDIO | Conexión | Cliente Supabase sin timeout (riesgo de retención de invocaciones)
**Evidencia:** `api/_auth.js:103-112` (`createClient` usa `fetch` por defecto). **Descripción:** las HTTP externas usan `fetchWithTimeout`, pero las queries Supabase no. **Fix:** pasar un `fetch` con `AbortSignal.timeout` en `global.fetch` del cliente.

---

## ⚖️ Discrepancias de severidad 🤖

- **H-002 (monolito):** A/B = ALTO, C = CRÍTICO. Se adopta ALTO (es deuda grave pero no rompe funcionalidad hoy).
- **H-013 (webhook fail-open):** A/B = ALTO, C = CRÍTICO. Se adopta ALTO; sería CRÍTICO si el secreto faltara en producción.
- **H-006 (gating IA fail-open si falta la RPC):** A = BAJO, B = ALTO *(carry-forward)*. Fix consensuado: fail-closed en prod con flag `ALLOW_IA_WITHOUT_RPC` solo en dev.

---

## ✅ Hallazgos cerrados esta ronda 🤖

> Trazabilidad histórica. NO eliminar.

### H-001 ✅ CERRADO (mitigado) | Webhook MP sin verificación de firma ni idempotencia
Se añadió `verifyMpSignature` (HMAC-SHA256 sobre `id;request-id;ts`) y la tabla `mp_webhook_events` (migración 026) para idempotencia. *Residual:* el comportamiento fail-open cuando falta el secreto se reabre como **H-013**.

### H-004 ✅ CERRADO | Llamadas a APIs externas sin timeout
Se introdujo `fetchWithTimeout` y se usa en las llamadas HTTP externas (mp-subscribe, webhook, invite, reportes, chat). *Residual:* el cliente Supabase aún sin timeout → **H-025**.

### H-005 ✅ CERRADO | Falta `.env.example`
Se agregó `.env.example` documentado (sin valores reales) y la excepción en `.gitignore`.

---

## 🗺️ Plan de mejora priorizado 🤖

### Sprint propuesto (antes de escalar usuarios)
1. **H-014 · `[A]` ALTO** — `SEQUENCE` para `tasks.id` (elimina la contención global de creación). *(MEDIO)* ⭐ concurrencia
2. **H-013 · `[A+B+C]` ALTO** — Webhook MP fail-closed. *(BAJO — quick win)*
3. **H-017 · `[B]` ALTO** — Cerrar IDOR de `sessionId` del chat. *(BAJO)*
4. **H-019 · `[B]` ALTO** — Validar Supabase admin antes de crear preapproval MP. *(BAJO)*
5. **H-007 · `[B]` ALTO** — Permisos por rol en RLS/RPC (reemplazar `member_all`). *(ALTO)*
6. **H-021 · `[B]` MEDIO** + **H-024 · `[C]` MEDIO** — Límite de tamaño + validación de esquema (Zod) en endpoints. *(BAJO-MEDIO)*

### Backlog (medio plazo)
- **H-003 · ALTO** — Vitest + primeras unitarias (aporte, webhook, gating).
- **H-015 / H-016 · `[A]` MEDIO** — Agregación server-side del dashboard + optimistic concurrency en tareas.
- **H-002 · `[A+B+C]` ALTO** — Descomponer el monolito + `React.lazy`. *(ÉPICO)*
- **H-020 / H-023 · `[B]` MEDIO** — RPCs sin `anon`; fuente canónica de planes.
- **H-008 / H-009 · `[A+B]` MEDIO** — Modal accesible + `:focus-visible`.
- **H-025 · `[C]` MEDIO** — Timeout en cliente Supabase.
- **H-010 · `[A]` MEDIO** — Rate limiting.

### Mejoras menores
- **H-022 · BAJO** — Constantes de modelo IA centralizadas.
- **H-012 · BAJO** — Sanitizar HTML del evolutivo.
- **H-006 · ⚖️** — Gating IA fail-closed en prod.

---

## 📜 Historial de auditorías 🤖

| Fecha | Modo | A+B+C | Pares | Solo A | Solo B | Solo C | Discrep. | Cerrados | Commits |
|---|---|---|---|---|---|---|---|---|---|
| 2026-06-19 | DEGRADADO (sin C) | — | 5 (A+B) | 3 | 3 | — | 1 | 0 | 96 (repo) |
| 2026-06-22 | COMPLETO (A+B+C) | 2 | 2 | 6 | 7 | 2 | 3 | 3 | 1a90dc1..52ca539 |

---

## 💬 Comentarios del equipo (editable manualmente)

> Esta sección NO es sobrescrita por SuperAuditor.

### Sprint 3 — concurrencia y datos (rama `fix/superauditor-sprint-3`)

| Hallazgo | Estado | Cambio |
|---|---|---|
| **H-016** lost updates | ✅ listo | `updateTask` aplica optimistic concurrency: el UPDATE filtra por `updated_at` cargado; si 0 filas → recarga la versión del servidor y avisa sin pisar (o detecta borrado). Refresca `updatedAt` local tras guardar. Sin migración (el trigger `set_task_auto_fields` ya bumpea `updated_at`). |
| **H-015** dashboard cliente | ✅ código listo · ⏳ migración pendiente | `migrations/032`: RPC `owner_boards_overview()` agrega los KPIs por tablero en SQL y devuelve JSONB compacto (antes traía todas las tareas de todos los tableros). `ConsolidatedDashboard` consume el RPC; report_history se sigue cargando (volumen bajo) para la pestaña de reportes. |

Pendiente operativo: aplicar **migración 032**. `npm test` 37/37 ✅, build ✅.

### Sprint pre-escalado — implementado (2026-06-22)

Se atacaron los 6 ALTOS priorizados. Estado por hallazgo:

| Hallazgo | Estado | Cambio |
|---|---|---|
| **H-014** concurrencia | ✅ código listo · ⏳ migración pendiente de aplicar | `migrations/029_task_id_sequence.sql`: `claim_task_id()` ahora es `SELECT nextval('tasks_id_seq')` (lock-free, sin contención cross-tenant ni broadcast). Frontend: el id se reserva **al guardar**, no al abrir el formulario (`openNew`/`save` en `ProductivityPlus.jsx`). |
| **H-013** webhook fail-open | ✅ listo | `api/mp-webhook.js`: sin `MP_WEBHOOK_SECRET` → 503 (fail-closed). Escape solo para dev con `ALLOW_MP_WEBHOOK_WITHOUT_SECRET=true`. |
| **H-017** IDOR sessionId | ✅ listo | `api/chat-stream.js`: la sesión entrante se valida contra `project_id` + `owner_user_id`. |
| **H-019** checkout sin admin | ✅ listo | `api/mp-subscribe.js`: valida `SUPABASE_SERVICE_ROLE_KEY` **antes** de crear la preapproval (503 si falta). |
| **H-007** roles en RLS | ✅ código listo · ⏳ migración pendiente | `migrations/030_role_based_rls.sql`: helper `has_project_role()`; OKRs/key_results escribibles solo por `po`/`scrum_master`, sprints solo por `scrum_master` (owner siempre pasa). Tasks siguen colaborativas. |
| **H-021 + H-024** validación | ✅ listo | `api/_auth.js`: helpers `requireString`/`requirePositiveInt`/`requireEnum` + `MAX_USER_MESSAGE_CHARS=8000`. Aplicados en `chat-stream.js` (límite 413 antes de persistir/LLM) y `generate-scrum-report.js`. Sin dependencia nueva (no Zod). |

**Pendiente operativo:** aplicar manualmente en Supabase SQL editor las migraciones **029** y **030** (en orden). Verificado: `npm run build` pasa; los errores de `npm run lint` son preexistentes y ajenos a estos cambios.

### H-003 — primera tanda de tests (2026-06-22)

Se introdujo **Vitest** (`npm test`). Cobertura inicial de la lógica de mayor riesgo:

- `src/lib/aporte.test.js` — cálculo de aporte (array + objeto legacy, piso de 1, dimensiones custom) y progreso por subtareas. `calcAporte`/`calcProgressFromSubtasks` se **extrajeron** del monolito a `src/lib/aporte.js` (testeable + primer corte de H-002).
- `api/mp-webhook.test.js` — verificación de firma HMAC del webhook MP (válida/inválida/secreto incorrecto/replay de otro evento/normalización), `mapStatus`, `parseExternalReference`.
- `api/_auth.validation.test.js` — helpers `requireString`/`requirePositiveInt`/`requireEnum` (incluye el 413 por tamaño de H-021).

**29 tests, todos en verde.** Pendiente backlog: CI por push y unitarias de gating (RPCs de plan/cuota).

### Sprint 2 — quick wins (rama `fix/superauditor-sprint-2`)

| Hallazgo | Estado | Cambio |
|---|---|---|
| **H-025** timeout Supabase | ✅ listo | `_auth.js`: `createAdminClient()` + `createSupabase` inyectan un `fetch` con `AbortSignal.timeout` (10s). Refactorizados 6 endpoints que creaban el cliente admin inline. |
| **H-012** HTML sin sanitizar | ✅ listo | `_email.js`: nuevo `sanitizeRichHtml` (misma allowlist que correos, sin exigir doctype). `save-evolution.js` lo aplica antes de persistir. |
| **H-022** metadata de modelo | ✅ listo | Nueva fuente única `src/aiModels.js` (solo server-side; no entra al bundle del cliente). **Decisión de producto:** NO se expone qué IA/modelo se usa en ningún punto visible. Se eliminaron las menciones de modelo/proveedor de la UI (REPORT_TYPES, visor de reportes, tour de Onboarding, status del evolutivo, "Claude IA"), se quitó el header `X-Wplanner-Model` de los endpoints, y se genericaron los mensajes de error que nombraban a Anthropic/Gemini. |
| **H-006** gating IA fail-open | ✅ verificado (sin cambios) | `assertProjectCanUseIa` ya hace fail-closed (503 sin RPC, salvo `ALLOW_IA_WITHOUT_RPC`) y todos los gates inline usan `!== true`. Ya estaba cerrado. |
| **H-020** RPCs con anon | ✅ aplicado | `migrations/031` (aplicada en Supabase): revoca `anon` de `project_has_feature`/`can_use_evolutivo`/`can_use_chat`/`chat_quota_remaining`/`user_can_use_ia_on_project`. Sin guard de membresía (cron las llama con service_role). |

**37 tests** en verde (+8: sanitización y consistencia de modelos). Migración 031 ya aplicada.

<!-- Escribe aquí libremente -->

---

*Generado por SuperAuditor — Orquestado por Claude Code (A=Opus 4.8). Motor B: Codex CLI (gpt-5.5 xhigh). Motor C: Antigravity CLI (Gemini 3.1 Pro).*
*Para regenerar: `/superauditor` en Claude Code.*
