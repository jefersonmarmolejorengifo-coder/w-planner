# AUDIT_PLAN.md — Plan de Mejora y Auditoría Triple

> Documento autoactualizable generado y mantenido por **SuperAuditor**.
> Auditoría ejecutada por IAs independientes: Claude (A), Codex/OpenAI (B) y Gemini/Google (C).
> NO editar manualmente las secciones marcadas con 🤖 — serán sobrescritas en la próxima auditoría.
> Las notas humanas van en la sección "Comentarios del equipo" al final.

---

## 🆕 Ronda 2026-06-27 — triple audit sobre los cambios de hoy (`87cb0d0..HEAD`) 🤖

**Los TRES auditores corrieron** ✅: **A = Claude Opus 4.8** (orquestador) · **B = Codex GPT-5** (vía API key de OpenAI; el login ChatGPT estaba revocado, se reactivó con `codex login --with-api-key`) · **C = Gemini 3.1 Pro (High)** vía Antigravity `agy` (suscripción Ultra, corrido sin `--sandbox` que bloqueaba el acceso a `F:\`). Modo: **TRIPLE completo**, cada auditor en su mejor modelo.

> Notas técnicas de la corrida: Codex requería `</dev/null` (esperaba stdin) + re-login (token revocado) + key sin BOM. Gemini requería login OAuth de Ultra + invocación sin sandbox. El profile de Codex se migró al formato nuevo (`~/.codex/superauditor.config.toml`).

### Veredicto de la ronda
**Los fixes de hoy resisten la auditoría triple: ningún auditor re-levantó los críticos/altos que cerramos** (race de cuota, tier en pago, retro atómico, responsive, alert/confirm). No hay críticos nuevos. Pero los tres convergen en deuda real de **integridad de pagos** y **arquitectura**, con hallazgos NUEVOS valiosos de Codex.

### Hallazgos por consenso (A=Claude, B=Codex, C=Gemini)

**🔴 Top nuevos (priorizados):**
1. **`[B]` ALTO · Pentest — envenenamiento de idempotencia del webhook MP (Codex H-005).** `api/mp-webhook.js:157-175`: el evento se marca como procesado (dedupe) ANTES de consultar MP y escribir el estado premium. Si hay un fallo transitorio tras el insert de dedupe → 500, pero el reintento con el mismo id se trata como **duplicado y el pago NUNCA se procesa**. Fix: estado `processing/failed/processed`; marcar definitivo solo tras completar las escrituras.
2. **`[B]` ALTO · Conexiones — upserts de `users_premium` no chequean `{ error }` (Codex H-006/H-008).** `mp-subscribe.js:156`, `mp-webhook.js:201,260`: si Supabase rechaza la escritura, el flujo sigue y devuelve éxito/200 → el usuario paga y queda sin plan, o MP deja de reintentar. Fix: desestructurar `{ error }` en cada escritura crítica; 500 a MP si no persiste.
3. **`[A+B]` ALTO · Seguridad — la cuota de chat cae a modo NO atómico / fail-open si falta `service_role` (Claude P3 + Codex H-003).** Si `createAdminClient()` es null, `chat-stream` no llama la RPC atómica y el LLM se invoca igual (solo lo frena el rate-limit de ráfaga). Fix: fail-closed en prod sin admin/RPC.
4. **`[C]` MEDIO · Pentest — `dataId` del webhook sin sanear (Gemini H-004).** `mp-webhook.js`: `data.id` se concatena a la URL de MP sin validar → posible path-traversal si el HMAC se comprometiera. Fix: validar numérico/alfanumérico antes del fetch.

**🤝 Consenso fuerte:**
- **`[A+B+C]` MEDIO · Arquitectura — centralización excesiva.** Los tres lo flaggean: `ProductivityPlus.jsx` (~2446 líneas: pantallas inline + permisos + nav) y `api/_auth.js` (cajón de sastre: auth+CORS+DB+billing+validación). Descomponer por dominio. Esfuerzo ALTO.
- **`[A+B]` MEDIO · Conexiones — `hub_outbox_claim` no marca filas como reclamadas (Claude C2 + Codex H-009).** El `FOR UPDATE SKIP LOCKED` solo hace SELECT; el lock se libera al retornar la RPC → crons solapados pueden enviar la misma fila. Fix: `UPDATE ... SET status='processing' ... RETURNING`.
- **`[B+C]` MEDIO · UX/a11y — deuda de accesibilidad.** Codex H-011/H-012 (tarjetas de `UserSelect` y el menú overflow nuevo con `role="menu"` sin patrón de teclado) + Gemini H-006/H-007 (visor de reportes y `AuthScreen` sin `role=dialog`/`htmlFor`). Las piezas de hoy (Toast/ConfirmDialog) SÍ son accesibles; el gap es código viejo + el `role="menu"` del overflow.

**Solo un auditor (revisar):**
- `[B]` MEDIO: sin tests del handler real de mp-webhook (H-002); `error.message` crudo al cliente en varios endpoints (H-004); tab "Pulso del equipo" visible a scrum_master pero la RPC/vista lo bloquea (H-010).
- `[C]` MEDIO: `MAX_USER_MESSAGE_CHARS=8000` alto (H-003).
- `[A]` MEDIO: `isDateOnly` acepta fechas inexistentes; gap de enqueue del outbox si Supabase cae al cobrar; BAJO: sin retry en el cliente Supabase, `IntroScreen` en cada carga.

> Reportes completos por auditor: `.superauditor/audit-claude.md`, `.superauditor/audit-codex.md`, `.superauditor/audit-gemini.md`.

---

## 📌 Resumen ejecutivo 🤖

- **Proyecto:** `w-planner` (Productivity-Plus)
- **Stack:** SPA Vite + React 19 · Supabase (Postgres + RLS) · Funciones Vercel (Node) · Mercado Pago · Resend · Anthropic/Gemini
- **Última auditoría:** `2026-06-24`
- **Auditores:** Claude (A) en `claude-opus-4-8` (orquestó 5 subagentes especialistas) + Codex (B) en `gpt-5.5` *(xhigh)*. Gemini (C) **OMITIDO** (CLI `agy` sin auth/red).
- **Modo:** `DUAL` (A+B) — Gemini no concluyó esta ronda.
- **Commits cubiertos:** `7681794..HEAD` (hub integration + admin plans migración 035 + rebrand/responsive v1.1.0).
- **Foco solicitado:** estructura, optimización, funcionamiento pleno, UX/responsive, integridad de datos en producción.

### Veredicto de producción (ronda 2026-06-24)
**El núcleo es sólido pero hay 3 CRÍTICOS y la seguridad no pasa el gate 9.5 (8.4/10).** Dominantes: secretos de producción en `.env.local` (riesgo aceptado por el dueño por ahora), race condition de cuota de chat (doble gasto de tokens), y bug del trigger de límite de tableros (status no-activo no degrada). Codex aporta señal nueva sobre la **fragilidad de la integración del hub** (comisiones sin reintento durable). El menú responsive recién desplegado tiene un bug latente de ResizeObserver con fix de alta confianza.

### Estado actual (ronda 2026-06-24, modo DUAL)

| Métrica | Valor |
|---|---|
| Consenso de pares `[A+B]` | 1 (monolito) |
| Solo Claude `[A]` | 18 (A26-A28, A30, A32-A46) |
| Solo Codex `[B]` | 8 (sus H-002..H-009) |
| **Verificado OK** | migración 035 (admin plans) — no filtra emails ni permite auto-upgrade |
| Críticos abiertos | 3 (H-028 secretos, H-030 race chat, H-033 trigger) |
| Altos abiertos | ~9 |
| Medios/Bajos abiertos | ~15 |

> ⚠️ **Baja coincidencia A↔B esperada por alcance distinto, no por contradicción:** Codex (B) auditó SOLO el diff `7681794..HEAD` (hub/referidos/billing); Claude (A) auditó todo el código. Los críticos de A (race de chat, trigger) viven en código previo al diff, por eso B no los vio. Tratar los `[A]` y `[B]` como complementarios.

### Top 3 prioridades inmediatas

1. **Race condition de cuota de chat** `[A]` `CRÍTICO` — `api/chat-stream.js:144-208`: el check de cuota es lectura y el insert va después; dos requests simultáneos queman doble token contando uno. Increment atómico en Postgres. (H-030)
2. **Trigger de límite de tableros no degrada con status no-activo** `[A]` `CRÍTICO` — `migrations/027:45`: un checkout `pending` puede crear tableros. Degradar a free ante cualquier status != active. (H-033)
3. **Notificación de comisión al hub sin reintento durable** `[B]` `ALTO` — `api/mp-webhook.js:253`: un 5xx transitorio del hub pierde la comisión aunque el cobro fue aprobado. Outbox + retry con backoff. (H-048)

> **Nota operativa heredada:** las migraciones **029** (SEQUENCE de task id, H-014) y **030** (roles en RLS, H-007) siguen marcadas como pendientes de aplicar en prod. Verificar su estado.

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
| 2026-06-24 | DUAL (sin C) | — | 1 (A+B) | 18 | 8 | — | 0 | 0 | 7681794..HEAD |

---

## 🆕 Hallazgos nuevos — ronda 2026-06-24 (modo DUAL A+B) 🤖

> Gemini (C) omitido esta ronda. IDs continúan desde H-025. Detalle completo en `VALIDACION_W-PLANNER.md` y `.superauditor/audit-claude.md` / `audit-codex.md`.

### 🤝 Consenso de pares `[A+B]`

- **H-002 (re-confirmado)** `[A+B]` `ALTO` Arquitectura — el orquestador `ProductivityPlus.jsx` (~2.300 líneas) sigue creciendo con billing/referidos. A: `:536-680,:1302-1431,:682-1236`. B: `:1478,:1550,:1653,:2131`. Sigue ÉPICO/incremental.

### 🔴 CRÍTICOS

- **H-028** `[A]` CRÍTICO Seguridad — secretos de producción en `.env.local:3-16` (service-role, MP, Resend, etc.). *Riesgo aceptado por el dueño (repo privado), rotación diferida.*
- **H-030** `[A]` CRÍTICO Pentest — race condition de cuota de chat: `api/chat-stream.js:144-208` (check de lectura + insert posterior) → doble gasto de tokens. Fix: increment atómico.
- **H-033** `[A]` CRÍTICO Conexión/datos — `migrations/027:45`: status no-activo (`pending`) no degrada a free → tableros sin pagar. Fix: `IF v_status <> 'active' THEN v_tier := 'free'`.

### 🟠 ALTOS

- **H-026** `[A]` Arquitectura — sin `manualChunks`; supabase-js (196kB) en el chunk pesado. `vite.config.js`.
- **H-031** `[A]` Pentest — endpoints IA no validan `periodStart < periodEnd`: `generate-evolution.js:327`, `save-evolution.js:48`, `generate-monthly-report.js:312`, `generate-scrum-report.js:243`.
- **H-034** `[A]` Conexión — pago recurrente no setea `tier`: `api/mp-webhook.js:251` → usuario paga y queda free. Fix: `tier: tier || 'free'`.
- **H-035** `[A]` Datos — señales de retro DELETE+INSERT no atómico: `api/submit-retro.js:57,63,86`. Fix: RPC transaccional / ON CONFLICT.
- **H-038** `[A]` Responsive — header sin colapso: `ProductivityPlus.jsx:2018` → en <480px explota.
- **H-039** `[A]` Frontend — bug latente ResizeObserver del menú responsive (cambio reciente): `ProductivityPlus.jsx:1887,1898` (deps + ref stale). Fix de alta confianza (30 min).
- **H-040** `[A]` Responsive — Gantt ancho fijo 660px + resizer solo-mouse: `GanttTab.jsx:30`.
- **H-048** `[B]` Conexión ⭐ — notificación de comisión al hub sin reintento durable: `api/mp-webhook.js:253` → 5xx transitorio pierde la comisión. Fix: outbox + backoff.

### 🟡 MEDIOS

- **H-027** `[A]` PlansLauncher llama RPC en cada apertura sin caché (`:1478-1543`).
- **H-029** `[A]` verificar grant residual a `anon` en `user_can_use_ia_on_project` (migr. 016 vs 031) en prod.
- **H-032** `[A]` `open-retro.js:99` reenvía emails con `trigger=manual` saltando idempotencia (sin rate limit).
- **H-036** `[A]` over-fetch `select('*')` + N+1 key_results en `useProjectData.js:48,86`.
- **H-037** `[A]` chat fail-open si `createAdminClient()` es null: `chat-stream.js:203-208`.
- **H-041** `[A]` `alert()`/`confirm()` nativos: `useTasks.js:36,77,139,155`. (Relacionado a H-008.)
- **H-042** `[A]` notif + dropdown hamburguesa sin clamp al viewport: `ProductivityPlus.jsx:2103,2155`.
- **H-043** `[A]` tooltip del tour se desborda <440px: `Onboarding.jsx:579,588`.
- **H-046** `[B]` `_hub-client.js:137` puede loguear PII/datos financieros del upstream.
- **H-047** `[B]` `/api/capture-referral` sin rate limit (`capture-referral.js`).
- **H-049** `[B]` vars `HUB_*` no documentadas en `.env.example` / docs.
- **H-050** `[B]` falta de migración `user_referrals` se reporta como éxito (200) → frontend deja de reintentar: `capture-referral.js:79`, `useReferralSync.js:64`.
- **H-051** `[B]` checkout cierra el modal antes de mostrar "Redirigiendo…": `PlanSelectionModal.jsx:32`.

### 🟢 BAJOS

- **H-044** `[A]` guard huérfano de rebrand: `ConfigTab.jsx:190`.
- **H-045** `[B]` `referral_code` sin `CHECK` en BD (`migrations/034:13`).
- **H-052** `[B]` botón cierre del modal 38px < 44px táctil: `PlanSelectionModal.jsx:56`.

### Verificado OK esta ronda

- **migración 035** (admin_user_plans): vista y función con REVOKE correcto a anon/authenticated; NO filtra emails ni permite auto-upgrade. Service-role NO llega al cliente.

---

## 💬 Comentarios del equipo (editable manualmente)

> Esta sección NO es sobrescrita por SuperAuditor.

### Sprint 39 — descomposición arquitectónica, paso B: pantallas del monolito (2026-06-27)

**Pista B `[frontend]` ✅:** se extrajeron las pantallas inline de `src/ProductivityPlus.jsx` (verbatim, prop-driven): `AuthScreen`/`UserSelectScreen`/`IntroScreen`/`ProjectLandingScreen` → `src/screens/`; `PlansLauncher` → `src/features/billing/`; `BoardSummaryPill` (+`ReportViewerDialog`) → `src/features/board/`; helper `joinProjectByCode` → `src/lib/joinProject.js`. **`ProductivityPlus.jsx`: 2470 → 1151 líneas (−53%)** — `App` queda como orquestador (auth/UI + render) + `TourMenu`/`BillingReturnOverlay`. Behavior-preserving. `vitest` 56/56 ✅, build ✅. Sin errores de lint NUEVOS (los 2 `set-state-in-effect` de BoardSummaryPill/ProjectLandingScreen son deuda preexistente que se movió de archivo; A28 sigue como mejora menor). Sin migración.

> **Épico de descomposición (consenso A+B+C) sustancialmente cerrado:** `_auth.js` −36% (Sprint 38) + `ProductivityPlus.jsx` −53% (este).

**Refinamientos del paso B `[lead]` ✅:** (a) **A28** — `PlansLauncher` disparaba el RPC `user_ia_capacity` por cada apertura del modal y por cada instancia (header+landing); ahora una promesa a nivel de módulo lo resuelve una sola vez por sesión (el upgrade navega a MP y recarga, reseteando el caché). (b) Los 2 `set-state-in-effect` que se movieron con el código (`BoardSummaryPill`, `ProjectLandingScreen`) se resolvieron moviendo el `setState` síncrono dentro del IIFE async del loader (behavior-preserving; de paso `ProjectLandingScreen` ganó guard `cancelled`). `vitest` 56/56 ✅, build ✅, lint de los 3 archivos limpio. (El repo conserva deuda de lint preexistente NO relacionada — 4 `set-state-in-effect` en el `App` de `ProductivityPlus` + otros — fuera del alcance de este épico.)

### Sprint 38 — descomposición arquitectónica, paso A.1: `_auth.js` → módulos (2026-06-27)

**Consenso A+B+C (descomposición, ÉPICO) — Pista A, paso 1 `[backend-dev]` ✅:** `api/_auth.js` era un cajón de sastre (auth+CORS+DB+billing+validación, 373 líneas). Se separó en módulos focalizados, dejando `_auth.js` como **barrel que re-exporta** → **cero cambios de imports** en los ~15 endpoints (behavior-preserving total):
- `api/_validation.js` (85, puro): `requireString`/`requirePositiveInt`/`requireEnum`/`isDateOnly`/`requireDateRange`/`BadRequestError`/`MAX_USER_MESSAGE_CHARS`.
- `api/_http.js` (106): CORS (`corsHeaders`/`applyCors`/`getOrigin`/`getAppBaseUrl`), `jsonResponse`, `fetchWithTimeout`, `handleApiError`.
- `api/_supabase.js` (72): env getters + `createSupabase`/`createAdminClient` + `supabaseFetch`.
- `api/_auth.js` (373→237, **-36%**): conserva auth/acceso/billing (`getAuthenticatedUser`/`assertProjectAccess`/`enforceRateLimit`/`assertProjectCanUseIa`) + barrel `export *` de los 3 módulos.

`vitest` **56/56** ✅, build ✅, lint limpio. Sin migración.

> Resta del épico: **Pista B** — extraer las pantallas inline de `ProductivityPlus.jsx` (`AuthScreen`/`UserSelectScreen`/`IntroScreen`/`ProjectLandingScreen`) a `src/screens/`, por pasos verificados.

### Sprint 37 — fix-auditoría: integridad de pagos + seguridad (ronda triple 2026-06-27) (2026-06-27)

**Subsanación de los hallazgos del triple-audit (A+B+C), batch backend `[backend-dev + security]`:**
- **#1 Idempotencia del webhook MP (ALTO, Codex H-005):** `mp_webhook_events.status` (`processing`/`processed`, migración 040). Ante `23505` se reprocesa si la fila está `processing`; se marca `processed` SOLO tras completar las escrituras → un pago que falla a mitad ya **no** queda como "duplicado" permanente.
- **#2 Upserts de `users_premium` chequean `{error}` (ALTO, Codex H-006/H-008):** el webhook → 500 (MP reintenta) si la persistencia falla; `mp-subscribe` no inicia el cobro si no registra el pending.
- **#3 Chat fail-closed sin `service_role` (ALTO, consenso A+B):** 503 si falta el admin client (salvo flag dev `ALLOW_CHAT_WITHOUT_ADMIN`) → no se llama al LLM sin control de cuota.
- **#4 `dataId` saneado (MEDIO, Gemini H-004):** regex `^[A-Za-z0-9_-]+$` antes de los fetch a MP (corta path-traversal/SSRF).
- **#6 `hub_outbox_claim` atómico (MEDIO, consenso A+B):** reescrito a `UPDATE ... FOR UPDATE SKIP LOCKED RETURNING` con estado `processing` (migración 040) → crons solapados ya no mandan la misma comisión; + recovery de filas `processing` huérfanas (>10 min) en el cron.
- **#9 errores genéricos (MEDIO, Codex H-004):** 6 endpoints de IA ya no filtran `err.message` crudo en errores ≥500 (log server-side + mensaje genérico).
- **#11 `MAX_USER_MESSAGE_CHARS` 8000→2000** · **#12 `isDateOnly` valida fecha real** (rechaza `2026-13-45`).

**Revisión de security:** el core de pagos pasó; cazó 2 gaps corregidos antes de mergear — H-BATCH-01 (fuga de `err.message` en el catch de auth, extendido a los 5 endpoints de IA) y H-BATCH-02 (recovery de filas huérfanas). `vitest` **56/56** ✅, build ✅, lint limpio. **Migración 040 aplicada en prod** (status en `mp_webhook_events` + claim atómico verificados).

**Batch a11y `[frontend]` ✅:** #7a tarjetas de perfil de `UserSelect` → `<button>` (Codex H-011); #7b menú overflow sin `role="menu"` a medias → botones navegables por Tab (Codex H-012, código de hoy); #7c visor de reportes con `useDialog` (foco/Esc/trampa, `role=dialog aria-modal`, Gemini H-006); #7d input de email con `htmlFor`/`id` (Gemini H-007); #10 tab "Pulso del equipo" alineado al acceso real (se quitó `scrum_master` de `allowedRoles` — la RPC/vista filtran por owner; Codex H-010). `vitest` 56/56 ✅, build ✅, lint en base. Sin migración.

> Difiere: **solo** la descomposición arquitectónica (`ProductivityPlus.jsx` + `_auth.js`, consenso A+B+C) — es ÉPICO, va a sprints dedicados. El resto de la auditoría triple quedó subsanado.

### Sprint 36 — Tanda 3 optimizaciones de carga (A-02, O-08; A-05 y O-03/05/06 evaluadas) (2026-06-26)

**A-02 (quick win) `[frontend]` ✅:** `TeamPulseTab` (+ `SprintPulseCard`, `PulseList`) estaba inline y eager en `ProductivityPlus.jsx` → extraído a `src/features/team/TeamPulseTab.jsx` + `React.lazy` + Suspense (mismo patrón que el resto de tabs). Sale del bundle inicial (chunk propio 5.46 kB).

**O-08 (caching) `[frontend]` ✅:** `vite.config.js` ahora fija `build.rolldownOptions.output.advancedChunks` (API nativa de Rolldown en Vite 8; `manualChunks` está deprecated). Dos vendor chunks: `vendor-react` (react+react-dom, 189 kB) y `vendor-supabase` (196 kB). **El `index` bajó de ~334 kB a 163 kB** (gzip 100→45.5): react y supabase quedan en vendors estables cacheables entre deploys, así un deploy típico solo invalida el index chico.

**A-05 — NO se lazifica (decisión correcta del frontend):** `IntroScreen` se muestra en CADA carga (`showIntro` arranca `true`, sin flag de primera visita; se resetea a `true` en SIGNED_OUT). Lazificarlo agregaría un round-trip de red justo en la pantalla inicial → peor. Se deja inline.

**O-03/05/06 — evaluadas, mayormente no aplican:** el "N+1 de key_results" en `useProjectData.js` **ya es una sola query batched** (`.in('okr_id', okrIds)`, no N+1). El `select('*')` es over-fetch real pero proyectar columnas es **riesgoso** (debe casar exacto con `dbToTask` + los handlers realtime) para ganancia marginal a la escala actual (datos scoped por proyecto). Se DEFIERE hasta tener un problema de performance medido.

`vitest` 53/53 ✅, build ✅ (chunks nuevos verificados), lint limpio (nuevos 0; ProductivityPlus en su base de 6 errores preexistentes). Sin migración.

> **Tanda 3 COMPLETA** (RESP-01/02 + smoke test visual + A-02 + O-08). Resta solo Tanda 4 (olas de validación) del roadmap.

### Sprint 35 — RESP-01/RESP-02: header y Gantt responsive (2026-06-26)

**RESP-01 + RESP-02 (eje responsive 4.5/10) `[ui-ux + frontend]` ✅:** diseño de **ui-ux**, implementación de **frontend**, verificado por el líder.
- Hook nuevo `src/hooks/useBreakpoint.js` (matchMedia → mobile<480 / tablet<768 / desktop).
- **Header** (`ProductivityPlus.jsx`): se quitó `flexWrap:wrap` (causa del solapamiento en <480) y se colapsa por breakpoint: logo→"P+", presencia→badge "N activos", sesión→avatar circular, y un **menú overflow "⋯"** (`role=menu`) que absorbe Tour/Salir/Planes/PDF/CSV/cambiar-proyecto según el tamaño. Estado del overflow separado del de notificaciones; spacer flex en móvil; `:focus-visible` vía clase `.pp-header-btn`.
- **Gantt** (`GanttTab.jsx`): ancho fijo 660px → **fluido** (ResizeObserver mide el contenedor; `CHART_W = chartW − effectiveLabelW`, mín 320 + scroll horizontal); resizer solo-mouse → **Pointer Events** (táctil) con `setPointerCapture`, oculto en móvil (labelWidth fijo 140).
Behavior-preserving. `vitest` 53/53 ✅, build ✅, lint de archivos nuevos/Gantt limpio (ProductivityPlus queda en su base preexistente de 6 errores del monolito, sin nuevos). Sin migración.

> ⏳ **Pendiente de validación visual** en 320/480/768px (recomendación de ui-ux). Quedan en Tanda 3: O-08 (manualChunks), A-02/A-05 (lazy), O-03/05/06 (over-fetch). Luego Tanda 4 (olas de validación).

### Sprint 34 — B-5 (retro atómico) + cierre de deuda de tests de validación (2026-06-26)

**B-5 (ALTO) `[backend-dev]` ✅ + migración 039 aplicada:** `api/submit-retro.js` hacía hasta 5 operaciones sin transacción (SELECT → UPDATE|INSERT del retro → DELETE de señales → INSERT de señales), y el error del INSERT de señales solo logueaba `console.warn` devolviendo 200 → corrupción silenciosa (señales borradas sin reinsertar). Ahora es UNA RPC transaccional: `migrations/039_submit_retro_atomic.sql` crea `submit_sprint_retro(...)` (PL/pgSQL, **SECURITY INVOKER** → respeta las RLS existentes de migración 020; `respondent_user_id = auth.uid()` nunca del cliente; upsert ON CONFLICT + DELETE/INSERT de señales todo-o-nada). El endpoint llama la RPC y devuelve 500 con el error real (sin pérdida silenciosa). El UNIQUE(period_id, respondent_user_id) ya existía (020).

**#7 deuda de tests `[backend-dev]` ✅:** se extrajo `isDateOnly` + `requireDateRange(start,end,{startName,endName})` a `api/_auth.js` (junto a los otros `require*`, lanzan `BadRequestError` 400) y se reemplazaron los checks inline de B-3 en los 3 endpoints. +9 tests en `api/_auth.validation.test.js` (rango válido, start===end, start>end, formato inválido start/end, status 400).

Implementación de **backend-dev**, verificado por el líder + **migración 039 aplicada en prod** (función SECURITY INVOKER confirmada). `vitest` **53/53** ✅, build ✅, lint limpio.

> Nota de comportamiento: el upsert ON CONFLICT evalúa la policy INSERT WITH CHECK (período abierto), así que editar un retro tras cerrar el período ahora se bloquea por RLS — más correcto, y la UI ya gatea el form al período abierto.

> **Tanda 2 COMPLETA** (#5 H-048 · #6 B-5 · #7 tests). Siguiente: **Tanda 3** (RESP-01/02 responsive + optimizaciones de carga).

### Sprint 33 — H-048: outbox durable para la comisión al hub (2026-06-26)

**H-048 (ALTO — dinero) `[infra-scalability + backend-dev]` ✅ + migración 038 aplicada:** la notificación de comisión al hub era fire-and-forget — un 5xx o timeout transitorio del hub perdía la comisión aunque el cobro entró. Ahora hay durabilidad con **outbox + reintento**: `migrations/038_hub_outbox.sql` (tabla `hub_outbox` con UNIQUE `mp_payment_id`, RLS service_role-only, índices parciales para el drain, RPC `hub_outbox_claim` con `FOR UPDATE SKIP LOCKED`). `api/mp-webhook.js` ahora **encola siempre** (upsert idempotente) y hace un envío inmediato best-effort (marca `sent` o `failed`). `api/cron.js` (horario) **drena** los pendientes con backoff exponencial (2^intento min, máx 5 intentos → `dead` con log de alerta), usando `service_role`. Idempotente en 4 capas (dedup de eventos MP + UNIQUE outbox + dedup del hub por payment_id + guards de estado). Diseño de **infra-scalability**, implementación de **backend-dev**, verificado por el líder (corrigió el `next_attempt_at` NOT NULL en el branch `dead`). `vitest` 44/44 ✅, build ✅, lint limpio. **Migración 038 aplicada en prod por el líder** (tabla + función + 4 índices verificados, 0 filas). El cobro nunca se bloquea (fail-open preservado).

> **Tanda 2 #5 COMPLETA.** Quedan: B-5 (submit-retro atómico), tests del flujo de cuota (036), Tanda 3 (responsive RESP-01/02 + optimizaciones de carga).

### Sprint 32 — U-01/U-02/R-11: alert/confirm nativos → Toast + diálogo accesible (2026-06-26)

**U-01/U-02/R-11 (consenso ui-ux + frontend) `[frontend]` ✅:** se eliminaron TODOS los `alert()`/`confirm()` nativos (bloqueantes, sin estilo, sin a11y) — 18 sitios en 8 archivos. Nuevos componentes en `src/ui/`: `ToastProvider`/`useToast()` (notificaciones no bloqueantes, apilables, auto-dismiss, `aria-live`) y `ConfirmProvider`/`useConfirm()` (diálogo de confirmación **async** que devuelve `Promise<boolean>`, reutiliza el hook accesible `useDialog` — foco/Esc/trampa, botón rojo `danger` para destructivos). Providers montados en `src/main.jsx` sobre `<App/>`. Los `confirm` pasaron a `await confirm(...)` (handlers async). Delegado a **frontend** (con criterio ui-ux), verificado por el líder (corrigió 3 lint nuevos: `useRef` muerto + `react-refresh/only-export-components` en los dos archivos provider+hook). `vitest` 44/44 ✅, `vite build` ✅, lint de archivos nuevos/tocados limpio (los 17 restantes de `src` son preexistentes del monolito). Grep final: 0 `alert(`/`confirm(` nativos en `src`. Sin migración.

> **Tanda 1 del roadmap COMPLETA** (#1 R-01/R-02 · #2 B-3 · #3 O-07 · #4 alert/confirm→Toast). Siguiente: **Tanda 2 — #5 H-048** (reintento durable de comisión al hub, ALTO/dinero).

### Sprint 31 — B-3 (validación de periodos) + O-07 (modelo evolutivo) (2026-06-26)

**B-3 (ALTO) `[backend]` ✅:** los endpoints del evolutivo/mensual validaban el formato de fecha pero NO el orden, así que un periodo invertido o de duración cero (fin ≤ inicio) gastaba tokens del LLM y podía sobrescribir histórico (el upsert del evolutivo usa `(project_id, period_start, period_end)` como clave única). Se agrega guard `start >= end → 400` ANTES de cualquier query/LLM en `api/generate-evolution.js`, `api/save-evolution.js` y `api/generate-monthly-report.js` (este último valida `monthStart`/`monthEnd` del body). Comparación lexicográfica (válida para `YYYY-MM-DD`).

**O-07 (quick win) `[backend]` ✅:** `src/aiModels.js` — modelo del evolutivo `claude-opus-4-7` (legacy) → `claude-opus-4-8`; test de consistencia `src/aiModels.test.js` actualizado al nuevo id.

Delegado a **backend-dev**, verificado por el líder (el test de modelo lo cazó el líder al correr la suite). `vitest` 44/44 ✅, `vite build` ✅, lint limpio. Sin migración. **Deuda anotada:** la validación de orden es inline (closures locales); extraer `requireDateRange()` a `_auth.js` + test en `_auth.validation.test.js` queda para un PR aparte.

> Tanda 1: #1 R-01/R-02 ✅ · #2 B-3 ✅ · #3 O-07 ✅. Resta #4 (alert/confirm → Toast).

### Sprint 30 — R-01/R-02 menú responsivo (ResizeObserver) (2026-06-26)

**R-01/R-02 (ALTO) `[frontend]` ✅:** el menú de tabs responsivo (`src/ProductivityPlus.jsx:1877`) tenía dos bugs del rebrand v1.1.0: (1) el ResizeObserver se reconectaba en cada colapso/expansión (dependía de `tabsCollapsed`) y `setTabsCollapsed` se llamaba dentro de su propio callback → loop + warning "ResizeObserver loop completed with undelivered notifications"; (2) `tabsNeedWidthRef` quedaba stale (=0) en el primer render estrecho → flip-flop/parpadeo. Fix (delegado al especialista **frontend**, verificado por el líder): RO **persistente** (deps solo `[TABS.length]`, lee `tabsCollapsed` vía ref espejo `tabsCollapsedRef`), todos los `setState` dentro de `requestAnimationFrame` con guards de igualdad (no dispara renders redundantes), y guard `needWidth > 0` antes de re-expandir. Behavior-preserving, sin tocar JSX ni estilos. `vite build` ✅, `vitest` 44/44 ✅, lint del bloque limpio (los 6 errores restantes de `ProductivityPlus.jsx` son preexistentes del monolito: `set-state-in-effect` en otros effects + el `_`). Sin migración.

> Primer item de la **Tanda 1** del roadmap priorizado (quick wins de alto impacto). Siguientes: B-3 (validar periodos en evolutivo), O-07 (modelo opus-4-8), U-01/U-02/R-11 (alert/confirm → toast).

### Sprint 29 — críticos de la validación 2026-06-24 (H-030 race de chat + B-4 + H-033) (2026-06-25)

> ⚠️ **Entorno sin git/node/npm en PATH.** Esta máquina no tiene git (no se pudo crear la rama `fix/superauditor-sprint-29` ni commitear): los cambios quedan en el árbol de trabajo de `main`. Las verificaciones se corrieron con el `node.exe` de Playwright (`v24`) invocando los binarios locales de `node_modules`.

**H-030 `[A]` CRÍTICO — race condition de la cuota mensual de chat (✅ código listo · ⏳ migración 036 pendiente de aplicar):**
- Antes `api/chat-stream.js` leía `project_chat_quota_remaining` (un `COUNT` sobre `chat_messages`) y luego insertaba el mensaje: el consumo era implícito, así que dos requests concurrentes veían el mismo `remaining`, pasaban ambos y quemaban **doble token contando uno**.
- `migrations/036_chat_quota_atomic.sql`: tabla `chat_monthly_usage` (contador por proyecto/mes, RLS on + sin grants) como **fuente de verdad única** del consumo, sembrada (backfill) desde `chat_messages` del mes en curso. RPC `project_chat_consume_quota()` reserva 1 mensaje en una sola sentencia `INSERT .. ON CONFLICT DO UPDATE .. WHERE used < quota` (atómica: Postgres serializa la fila). RPC `project_chat_release_quota()` devuelve la reserva si el LLM falla antes de generar. `project_chat_quota_remaining()` se reescribe para leer el contador (el display del frontend sigue cuadrando). Consume/release solo `service_role`.
- `api/chat-stream.js`: la reserva se hace con el cliente admin tras validar el acceso (ownerOnly); fallback no-atómico si falta `service_role` (dev) o la migración 036 (código `42883`). Se libera la reserva en los 3 paths pre-gasto (sin API key, fallo de red/timeout, respuesta no-ok del LLM).

**B-4 `[A]` ALTO — el cobro recurrente no fijaba el tier (✅ listo, solo código):**
- `api/mp-webhook.js` (`subscription_authorized_payment`): el upsert seteaba `status='active'` pero **no** `tier`, teniéndolo resuelto del `external_reference`. Si el evento de payment llegaba antes/sin el de preapproval-activo, el usuario pagaba y quedaba en `free`. Fix: en pago aprobado con tier resoluble, el upsert ahora fija `update.tier = tier` (en `past_due` no se toca; el trigger ya limita por status).

**H-033 / B-1 `[A]` — VERIFICADO / NO REPRODUCIBLE (✅ + ⏳ migración 037 de saneamiento pendiente):**
- El trigger `enforce_project_limit` (027:45) **ya degrada** a `free` cualquier `tier!='free' AND status!='active'`. Además `users_premium.status` es `NOT NULL CHECK IN (active,pending,past_due,cancelled)` (016:56) → no puede ser NULL en una fila existente, y `mp-subscribe` escribe `tier='free'` para los `pending`. No hay camino donde un no-pagador termine con `tier!='free' AND status='active'`: la "creación de tableros sin pagar" **no es reproducible**. El auditor razonó sobre el trigger en aislamiento.
- `migrations/037_tier_status_sanitation.sql` (segura, idempotente): normaliza residuos históricos (`tier!='free'` en `pending`/`cancelled` → `free`; `past_due` se deja, MP puede reactivar) + queries de auditoría comentadas para inspeccionar a mano posibles víctimas de B-4 (pagaron pero quedaron en `free`; su tier real no es deducible en SQL, se corrige con `admin_set_user_plan`).

**S-001 / H-028 `[A]` CRÍTICO — secretos de producción en `.env.local`: PENDIENTE DE JEFER.** Rotar TODAS las llaves (service-role, MP, Resend, OpenAI, etc.) desde los dashboards. El equipo no tiene acceso; es una PARADA.

**Verificación:** `vitest run` **44/44 ✅**, `vite build` ✅, `eslint api/chat-stream.js api/mp-webhook.js` limpio.
**Operativo:** migraciones **036**, **037** (y las previas **029/030/032/033**) **aplicadas por Jefer el 2026-06-26** ✅. Resta: rotar secretos de producción (**S-001 / H-028**), acción exclusiva de Jefer.

### Sprint 28 — monolito fase 23 · núcleo, fase D.5 / FINAL (useProjectData — consolidación) (rama `fix/superauditor-sprint-28`)

**H-002 (núcleo, fase D — paso 5, cierre):** se consolida el spine por **composición**, sin deshacer los hooks de dominio.

- `useProjectData({ activeUser, setActiveUser })` → `src/hooks/useProjectData.js`: compone `useProjectConfig` + `useTaskFieldDefs` + `useTasks`, y posee el spine — estado de nivel proyecto (`projectId`/`project`/`loading`/`okrs`/`keyResults`/`sprints`/`currentUserId`), la carga masiva (`loadAllForProject`) y el **canal realtime**. El spine vive junto a los setters que muta (sin pasar 20 parámetros, que era el anti-patrón a evitar).
- `App` pasa a consumir **un único hook** de datos + `usePresence`, y conserva solo auth/UI (authUser/showAuth/showIntro/showProjectLanding/activeUser/depEditTask/tabs), la orquestación de sesión (`init`/`routeAfterAuth`) y el render.
- El orden de hooks se preserva (useProjectData ejecuta config→fieldDefs→tasks, luego usePresence): sin violación de rules-of-hooks; el effect realtime sigue re-suscribiéndose solo al cambiar `projectId`. Comportamiento idéntico.
- Limpieza: imports muertos en el monolito retirados (`dbToTask`, y los hooks de dominio que ahora solo usa `useProjectData`).

**App: ~9.700 → 2.088 líneas.** Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint del hook nuevo limpio (el monolito solo conserva el `_` preexistente). Sin migración.

**Fase D y descomposición del núcleo COMPLETAS.** El monolito quedó reducido a `App` (orquestación auth/UI + render) + pantallas auxiliares; toda la lógica de dominio vive en hooks (`useProjectData`, `useTasks`, `useProjectConfig`, `useTaskFieldDefs`, `usePresence`) y features lazy.

### Sprint 27 — monolito fase 22 · núcleo, fase D.4 (usePresence) (rama `fix/superauditor-sprint-27`)

**H-002 (núcleo, fase D — paso 4):** se levanta el subsistema de presencia, la costura segura dentro del bloque de sesión (es cohesivo y NO llama a `loadAllForProject`).

- `usePresence({ projectId, activeUser, setActiveUser, setCurrentUserId })` → `src/hooks/usePresence.js`: posee `activeUsers`/`kickedMsg`/`conflictUser` + los refs (`sessionIdRef`, `presenceChannelRef`, `activeUserRef`), los 3 effects (sync de ref, canal de presencia, track/untrack) y los handlers `handleForceEntry`/`handleChangeUser`.
- `activeUser`/`currentUserId` permanecen en `App` (los puebla el spine y los consume `useTasks`); se pasan al hook junto con sus setters.
- Limpieza lint-driven: `useRef` ya no se usa en el monolito → retirado del import de React. El warning de exhaustive-deps del canal se documenta con un disable (el setter de `useState` es estable; el canal solo debe re-suscribirse al cambiar de proyecto — comportamiento idéntico al original).

`App` se aligera ~90 líneas más. Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint del hook nuevo limpio. Sin migración.

Resta de la fase D: el **spine** propiamente dicho (auth `init`/`routeAfterAuth` + `loadAllForProject` + canal realtime), que es mutuamente dependiente y escribe en ~13 piezas de estado de todos los hooks. Es el núcleo más sensible; pendiente de evaluación.

### Sprint 26 — monolito fase 21 · núcleo, fase D.3 (useProjectConfig) (rama `fix/superauditor-sprint-26`)

**H-002 (núcleo, fase D — paso 3):** se levantan los catálogos del proyecto.

- `useProjectConfig({ projectId, project, setProject })` → `src/hooks/useProjectConfig.js`: posee `participants`/`indicators`/`taskTypes`/`dimensions` y `saveParticipants`/`saveIndicators`/`saveTaskTypes`/`saveDimensions`/`saveProjectPin`.
- La llamada va tras la declaración de `project`/`projectId` (que el hook necesita) y **antes** de `useTasks` (que recibe `dimensions` como input). Expone los setters para el spine.
- `DEFAULT_DIMENSIONS` permanece importado en el monolito (lo usan `createProject`/`createFromTemplate` de ProjectLandingScreen).

`App` se aligera ~65 líneas más. Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint del hook nuevo limpio. Sin migración.

Resta de la fase D: `useAuthSession` (auth/sesión/presencia) y mover el spine (`loadAllForProject` + canal realtime) a hook — el código más sensible, al final.

### Sprint 25 — monolito fase 20 · núcleo, fase D.2 (useTasks) (rama `fix/superauditor-sprint-25`)

**H-002 (núcleo, fase D — paso 2):** se levanta el dominio de tareas.

- Prerequisito: `dbToTask`/`taskToDb` (mapeo snake_case ↔ camelCase, funciones puras) → `src/lib/taskMapping.js`, para que el hook (archivo aparte) y el spine del App (`loadAllForProject` + realtime) los compartan sin ciclos.
- `useTasks({ projectId, dimensions, hasCustomFieldsSchema, activeUser, taskFieldDefs })` → `src/hooks/useTasks.js`: posee `tasks`/`nextId` y `createTask`/`updateTask`/`deleteTask`/`exportCSV` (incluida la concurrencia optimista por `updated_at` y el log a `task_history`). Recibe del App el contexto necesario; expone `setTasks`/`setNextId` para que el spine los siga poblando.
- La llamada al hook va tras `useTaskFieldDefs` (necesita `projectId`/`dimensions`/`activeUser`/`taskFieldDefs`).
- Limpieza lint-driven de imports muertos en el monolito: `getColombiaNow`, `readCustomFieldValue`, `calcAporte`, `taskToDb`.
- Detalle de calidad: el BOM del CSV (`﻿`) se escribió como `String.fromCharCode(0xFEFF)` para evitar el carácter invisible que ESLint marca como *irregular whitespace*.

`App` se aligera ~210 líneas más. Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint de archivos nuevos limpio. Sin migración.

Siguientes (por evaluar): `useProjectConfig` (participants/indicators/taskTypes/dimensions + saves), `useAuthSession`.

### Sprint 24 — monolito fase 19 · núcleo, fase D.1 (useTaskFieldDefs) (rama `fix/superauditor-sprint-24`)

**H-002 (núcleo, fase D — levantar estado de App a hooks, paso 1):** la fase D se ejecuta **en pasos seguros validados**, un hook por PR (no big-bang), de menor a mayor acoplamiento. Primer dominio: el más aislado.

- `useTaskFieldDefs(projectId)` → `src/hooks/useTaskFieldDefs.js`: posee el estado `taskFieldDefs`/`hasCustomFieldsSchema` y las 4 funciones CRUD (`addTaskFieldDef`, `updateTaskFieldDefById`, `deleteTaskFieldDef`, `reorderTaskFieldDefs`).
- Decisión de diseño (behavior-preserving): el hook **expone los setters** porque el "spine" del App —`loadAllForProject` (carga masiva) y el **canal realtime único** (compartido con participants/indicators/tasks/…)— los sigue poblando. Partir ese canal habría cambiado comportamiento (más conexiones), así que se mantiene en App; solo la lógica de mutación se mueve al hook.

`App` se aligera ~110 líneas y el CRUD queda aislado/testeable. Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint del hook nuevo limpio (los errores restantes del monolito son preexistentes). Sin migración.

Siguientes pasos de la fase D (por evaluar uno a uno): `useTasks` (tasks/nextId + createTask/updateTask/deleteTask/exportCSV), `useProjectConfig` (participants/indicators/taskTypes/dimensions + saves), `useAuthSession`. Cada uno depende del spine, así que se valorará si conviene mover también `loadAllForProject`/realtime o mantener el patrón de setters expuestos.

### Sprint 23 — monolito fase 18 · núcleo, fase C (BoardTab + GanttTab → lazy) (rama `fix/superauditor-sprint-23`)

**H-002 (núcleo — tablero y Gantt):** extracción verbatim del clúster del tablero, ahora con code-splitting.

- `BoardTab` (~175 líneas) + sus privados (`emptyTask`, `formatCardCustomField`, `TaskCard`, `TaskCardWithClick`, `Modal`) → `src/features/board/BoardTab.jsx`, cargado con `React.lazy` + `<Suspense>`. Importa `TaskForm` (del sprint 22), que ahora **viaja en este chunk**.
- `GanttTab` (~245 líneas, autónomo) → `src/features/board/GanttTab.jsx`, lazy.
- Limpieza de imports muertos tras la extracción (lint-driven): `memo`, `useId` (React), `useDialog`, `parseDeps`, `inp` (su único usuario era TaskForm; AuthScreen/ProjectLandingScreen tienen su propio `inp` local), `calcProgressFromSubtasks`, y el import completo de `./lib/depGraph` (`computeDepLayout` + `NODE_*`, muerto desde la extracción de DependenciesTab — resuelve un error de lint preexistente).

**Impacto en bundle:** `BoardTab` → chunk 35.95 kB (10.37 kB gzip), `GanttTab` → 8.42 kB (2.80 kB gzip). El index inicial baja de **~373 kB a 328.5 kB** (gzip ~110 → 99 kB). Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint de archivos nuevos limpio. Sin migración.

**Núcleo: solo resta la fase D** — adelgazar el cuerpo de `App` levantando estado a hooks (`useTasks`, `useProjectData`). Es opcional y de mayor riesgo; se hará solo si aporta claridad sin comprometer comportamiento.

### Sprint 22 — monolito fase 17 · núcleo, fase A/B (clúster TaskForm) (rama `fix/superauditor-sprint-22`)

**H-002 (núcleo — extracción del clúster de edición de tarea):** primer paso del núcleo. Nota clave: `BoardTab`/`TaskForm` ya estaban dirigidos 100% por props, así que esto es **extracción verbatim** (no rewrite de estado). El "levantar estado de App" se reserva para la fase D, al final.

- `TaskForm` (~475 líneas) + sus privados (solo usados por él) → `src/features/board/TaskForm.jsx`: `StarRating`, `F` (field wrapper), `TaskSuperLinksEditor`, `TaskCommentsThread` (+ helpers `commentTimeAgo`/`commentInitials`/`commentColorOf`) y la constante `CLOSE_STATES`.
- Estilos `inp`/`readonlyInp` (compartidos por TaskForm, AuthScreen y ProjectLandingScreen) → `src/lib/formStyles.js`. El monolito importa `inp`.
- `TaskForm` se importa **eager** porque `BoardTab` (aún en el monolito) lo usa directo. La ganancia de bundle llegará en la fase C, cuando `BoardTab` pase a lazy y arrastre a `TaskForm` a su chunk.

~900 líneas fuera del monolito. Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint de archivos nuevos limpio. Sin migración.

Siguientes: fase C) `BoardTab` (+ `TaskCard`/`TaskCardWithClick`/`Modal`/`formatCardCustomField`/`emptyTask`) y `GanttTab` → feature, lazy · fase D) levantar estado de `App` a hooks (`useTasks`, `useProjectData`) — solo si aporta.

### Sprint 21 — monolito fase 16 · ConfigTab por fases, paso 5 / FINAL (rama `fix/superauditor-sprint-21`)

**H-002 (ConfigTab, fase 5/5 — orquestador → lazy):**
- `ConfigTab` (~600 líneas: orquestador con invitaciones, roles, PIN, participantes, indicadores, tipos de tarea, dimensiones, campos personalizados, panel premium y reportes IA) → `src/features/config/ConfigTab.jsx`, cargado con `React.lazy` + `<Suspense>` (igual que el resto de pestañas pesadas).
- Migraron con él sus imports propios (ya no usados en el monolito): `RoleAssignmentSection`, `ConfigSection`, `DimensionEditor`, `FieldDefEditor`, `PremiumPanel`, `ReportsConfigSection`.
- Limpieza: se eliminó la función muerta `addP` (+ estado `newP`/`setNewP`) — "agregar participante a mano" ya no existe desde Fase D del onboarding; era un error de lint preexistente.

**Impacto en bundle:** ConfigTab queda en su propio chunk (58.9 kB / 14.5 kB gzip), fuera del bundle inicial. El index baja de ~432 kB a ~373 kB (~110 kB gzip). Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint del archivo nuevo limpio. Sin migración.

**ConfigTab descompuesto al 100%.** Resta solo el núcleo (`BoardTab`/`TaskForm`/`App`), que requiere levantar estado y se aborda en sesión dedicada.

### Sprint 20 — monolito fase 15 · ConfigTab por fases, paso 4 (rama `fix/superauditor-sprint-20`)

**H-002 (ConfigTab, fase 4/N — editores):**
- `DimensionEditor` (~117 líneas: pesos de aporte que suman 100%) → `src/features/config/DimensionEditor.jsx`.
- `FieldDefEditor` + sus constantes `FIELD_TYPE_LABELS`/`FIELD_TYPE_HINTS` (~310 líneas: editor del esquema de campos personalizados, soft-delete) → `src/features/config/FieldDefEditor.jsx`.
- `DEFAULT_DIMENSIONS` se mueve a `src/lib/aporte.js` (compartido por calculadora, plantillas y editor; 5 usos) e importado donde hace falta.
- Limpieza: tras la extracción, `AUTO_FIELD_SOURCE_LABELS` y `slugifyKey` ya no se usan en el monolito → se quitan de su import de `lib/customFields` (queda `readCustomFieldValue`).

Ambos importados eager por ConfigTab (que sigue en el monolito hasta la fase 5). Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint de archivos nuevos limpio. Sin migración.

Siguiente: 5) ConfigTab orquestador → lazy.

### Sprint 19 — monolito fase 14 · ConfigTab por fases, paso 3 (rama `fix/superauditor-sprint-19`)

**H-002 (ConfigTab, fase 3/N — PremiumPanel):**
- `PremiumPanel` (~165 líneas: estado de suscripción + toggle IA por proyecto) → `src/features/config/PremiumPanel.jsx` (importado eager por ConfigTab, que sigue en el monolito hasta la fase 5). Deps: solo `supabase` + hooks. De paso se eliminó la función muerta `subscribe` (el upgrade se hace por el botón ✨ Planes) y su import `getAuthJsonHeaders`, ahora innecesario.

Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint del archivo nuevo limpio. Sin migración.

Siguientes: 4) DimensionEditor/FieldDefEditor · 5) ConfigTab (lazy).

### Sprint 18 — monolito fase 13 · ConfigTab por fases, paso 2 (rama `fix/superauditor-sprint-18`)

**H-002 (ConfigTab, fase 2/N — cluster de reportes):**
- `ConfigSection` (wrapper sección, 18 usos) → `src/lib/ConfigSection.jsx` (compartido).
- `REPORT_TYPES` + `DAY_NAMES_ES` + `ReportsConfigSection` + `ReportCard` → `src/features/config/ReportsConfigSection.jsx` (importado eager por ConfigTab, que sigue en el monolito hasta la fase 5). Deps: supabase, getAuthJsonHeaders (lib). De paso se quitó el prop muerto `onSend` de ReportCard (el envío manual ya no existe).

~395 líneas fuera del monolito. Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint de archivos nuevos limpio. Sin migración.

Siguientes: 3) PremiumPanel · 4) DimensionEditor/FieldDefEditor · 5) ConfigTab (lazy).

### Sprint 17 — monolito fase 12 · ConfigTab por fases, paso 1 (rama `fix/superauditor-sprint-17`)

**H-002 (ConfigTab, fase 1/N — groundwork):** extraídos los helpers de campos personalizados (compartidos por `TaskForm`, `FieldDefEditor` y otras vistas) a `src/lib/`:
- `src/lib/customFields.js` — `AUTO_FIELD_SOURCES`, `AUTO_FIELD_SOURCE_LABELS`, `slugifyKey`, `readCustomFieldValue` (puros).
- `src/lib/CustomFieldsRenderer.jsx` — el componente (separado para no romper `react-refresh/only-export-components`).

Refactor behavior-preserving (~210 líneas fuera del monolito). `npm test` 42/42 ✅, build ✅, lint de archivos nuevos limpio. Sin migración. (El bundle inicial no cambia: estos helpers los usa TaskForm, siempre presente.)

Siguientes pasos de ConfigTab: 2) cluster de reportes, 3) PremiumPanel, 4) DimensionEditor/FieldDefEditor/ConfigSection, 5) ConfigTab.

### Sprint 16 — monolito fase 11 (rama `fix/superauditor-sprint-16`)

**H-002 (continuación):** extraído "Mi Día" + su cluster de retros (cohesivo y solo usado por FocusTab): `RETRO_EMOJIS` + `SprintRetroForm` + `PendingRetrosBanner` + `FocusTab` → `src/features/focus/FocusTab.jsx`, cargado con `React.lazy`. Helper `getColombiaNow` movido a `src/lib/format.js` (usado por FocusTab + creación/edición de tareas en el monolito). `index` baja a **432 kB**; chunk `FocusTab` ~11.2 kB. Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint de archivos nuevos sin errores. Sin migración.

Quedan: `ConfigTab` (~600 líneas, con DimensionEditor/FieldDefEditor/PremiumPanel/ReportsConfigSection) y el núcleo (`BoardTab`/`TaskForm`/`App`, requiere levantar estado).

### Sprint 15 — monolito fase 10 (rama `fix/superauditor-sprint-15`)

**H-002 (continuación):** extraída la unidad de Super-tareas (la más grande, ~565 líneas): `SuperTaskJar` + `SuperTaskExpanded` + `SuperTasksTab` → `src/features/tasks/SuperTasksTab.jsx`, cargado con `React.lazy`. Reutiliza `PresentationCard` (módulo hoja) y `SuperTaskCreatorModal` (lazy, ya extraído). Se limpiaron del monolito el import de `PresentationCard` y el lazy de `SuperTaskCreatorModal` (ya no usados allí), y se removió el prop `participants` que estaba sin uso (antes suprimido con `eslint-disable`). `index` baja a **442.8 kB**; chunk `SuperTasksTab` ~15.3 kB. Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint del archivo nuevo limpio. Sin migración.

Quedan: `FocusTab` (mover mapper `dbToTask`/`taskToDb` a `lib/` primero), `ConfigTab`, y el núcleo (`BoardTab`/`TaskForm`/`App`).

### Sprint 14 — monolito fase 9 (rama `fix/superauditor-sprint-14`)

**H-002 (continuación):** extraída la vista de Presentación.
- `PresentationCard` + `LinkedTaskChip` → `src/features/presentation/PresentationCard.jsx` (módulo hoja compartido: lo usan PresentationTab y `SuperTaskExpanded` del monolito, que ahora lo importa). Solo depende de `parseDeps`.
- `PresentationTab` (+ `PresentationGraph` + `StatCard`) → `src/features/presentation/PresentationTab.jsx`, cargado con `React.lazy`. Usa `lib/depGraph`, `lib/deps`, `constants` y el PresentationCard hoja.

`index` baja a **464.2 kB**; chunk `PresentationTab` ~10.3 kB. (PresentationCard queda eager porque SuperTaskExpanded lo usa; se volverá lazy-compartible cuando se extraiga Super-tareas.) Refactor behavior-preserving. `npm test` 42/42 ✅, build ✅, lint de archivos nuevos sin errores. Sin migración.

Quedan: `SuperTasksTab` (usa el PresentationCard hoja — ya listo para extraer), `FocusTab`, `ConfigTab`, y el núcleo.

### Sprint 13 — monolito fase 8 (rama `fix/superauditor-sprint-13`)

**Groundwork de helpers compartidos:**
- `ESTADOS` / `TIPOS` / `DEFAULT_TASK_TYPES` → `src/constants.js`.
- `getUserColor` / `getInitials` (+ `USER_COLORS`) → `src/lib/format.js`.

**Extracción:** `MetricsTab` (+ sub-componentes `MetricsSection`/`MetricCard`/`MetricRow`) → `src/features/metrics/MetricsTab.jsx`, cargado con `React.lazy`. `TYPE_COLORS` y `daysBetween` (exclusivos de Métricas) viven dentro del feature. Refactor behavior-preserving. `index` baja a **474.7 kB**; chunk `MetricsTab` ~9 kB. `npm test` 42/42 ✅, build ✅, lint de archivos nuevos sin errores. Sin migración.

Quedan (más entrelazados): `PresentationTab`, `SuperTasksTab`, `FocusTab`, `ConfigTab`, y el núcleo (`BoardTab`/`TaskForm`/`App`, requiere levantar estado).

### Sprint 12 — monolito fase 7 (rama `fix/superauditor-sprint-12`)

**H-002 (continuación):** extraído `SprintsTab` → `src/features/sprints/SprintsTab.jsx`, cargado con `React.lazy`. **Optimización:** su `SprintCard` era un componente-en-render (se remontaba en cada render); se movió a nivel de módulo con los handlers (`onStart`/`onCloseSprint`/`onDelete`) por props, y los estilos puros (`btn`/`si`) a nivel de módulo. Usa `STATUS_COLORS` desde `constants`. Refactor behavior-preserving. `index` baja a **483 kB**; chunk `SprintsTab` ~8.7 kB. `npm test` 42/42 ✅, build ✅, lint del archivo nuevo limpio. Sin migración.

Pendiente: `MetricsTab` (mover `ESTADOS`/`DEFAULT_TASK_TYPES`/`daysBetween`/`getUserColor`/`getInitials` a `lib/` primero).

### Sprint 11 — monolito fase 6 (rama `fix/superauditor-sprint-11`)

**Groundwork de constantes/helpers compartidos:**
- `STATUS_COLORS` / `STATUS_LIGHT` → `src/constants.js` (las usan tablero, métricas, red de tareas, sprints).
- `parseDeps` → `src/lib/deps.js`.
- `computeDepLayout` + `NODE_*` → `src/lib/depGraph.js` (compartido entre la Red de Tareas y la Presentación; **se detectó vía chequeo de referencias** que `PresentationGraph` también los usaba antes de mergear).

**Extracción:** `DependenciesTab` → `src/features/deps/DependenciesTab.jsx`, cargado con `React.lazy`. Refactor behavior-preserving. `index` baja a **491 kB**; chunk `DependenciesTab` ~11.9 kB. `npm test` 42/42 ✅, build ✅, lint de archivos nuevos sin errores. Sin migración.

Pendientes para la próxima tanda (ya con `STATUS_COLORS`/`STATUS_LIGHT` en constants): `SprintsTab` (tiene `SprintCard` como componente-en-render: conviene moverlo fuera al extraer) y `MetricsTab` (arrastra `ESTADOS`/`DEFAULT_TASK_TYPES`/`daysBetween`/`getUserColor`/`getInitials` + `TYPE_COLORS`: mover esos helpers a `lib/` primero).

### Sprint 10 — monolito fase 5 (rama `fix/superauditor-sprint-10`)

**H-002 (continuación):** extraído `OKRsTab` → `src/features/okrs/OKRsTab.jsx`, cargado con `React.lazy` (tab on-demand, prop-driven, sin dependencias compartidas: solo `supabase` + hooks). Refactor behavior-preserving (copia verbatim). `npm test` 42/42 ✅, build ✅ (chunk OKRsTab ~10 kB), lint del archivo nuevo limpio. Sin migración.

Próximos candidatos mapeados (cada uno su PR verificado): `SprintsTab` y `MetricsTab` y `DependenciesTab` — requieren primero mover las constantes compartidas `STATUS_COLORS`/`STATUS_LIGHT` a `src/constants.js` y mover sus sub-componentes privados (`SprintCard`, `MetricCard/Row/Section`, `computeDepLayout`). `FocusTab` depende de mappers (`dbToTask`/`taskToDb`/`calcAporte`), más entrelazado. El núcleo (`BoardTab`, `TaskForm`, `App` orquestador) requiere levantar estado a hooks/contexto antes de extraerse.

### Sprint 9 — monolito fase 4 (rama `fix/superauditor-sprint-9`)

**H-002 (continuación):** extraídos dos paneles pesados on-demand, cargados con `React.lazy`:
- `EvolutionTab` (+ `EvolutionRender` interno) → `src/features/evolution/EvolutionTab.jsx`
- `ChatEnterpriseTab` (+ `ChatBubble` interno) → `src/features/chat/ChatEnterpriseTab.jsx`

Helper compartido `getAuthJsonHeaders` movido a `src/lib/authHeaders.js` (lo usan ambos paneles y 6 sitios del monolito).

**Efecto en el bundle (honesto):** al haber varios `import()` dinámicos, Rolldown hoisteó `@supabase/supabase-js` a un chunk propio `supabaseClient` (~196 kB / 50 kB gzip) que se cachea aparte, y separó `jsx-runtime` (~8 kB). El `index` queda en ~512 kB. La carga inicial total es similar (supabase siempre se necesita), pero ahora **~42 kB de paneles** (`PlanSelection`, `Consolidated`, `SuperTaskCreator`, `Evolution`, `Chat`) salen del arranque y se descargan solo al abrirlos, y supabase es un chunk vendor cacheable entre navegaciones.

Refactor behavior-preserving (copia verbatim). `npm test` 42/42 ✅, build ✅, lint de archivos nuevos sin errores (1 warning preexistente de exhaustive-deps). Sin migración.

### Sprint 8 — monolito fase 3 (rama `fix/superauditor-sprint-8`)

**H-002 (continuación):** extraído `SuperTaskCreatorModal` → `src/features/tasks/SuperTaskCreatorModal.jsx`, cargado con `React.lazy` (panel on-demand). Refactor behavior-preserving (copia verbatim). Bundle inicial baja a **721.8 kB** (gzip 192.9 kB); nuevo chunk `SuperTaskCreatorModal` ~6.3 kB. `npm test` 42/42 ✅, build ✅, lint del archivo nuevo limpio. Sin migración.

Acumulado de chunks on-demand: `PlanSelectionModal` (~10.8 kB), `ConsolidatedDashboard` (~11.9 kB), `SuperTaskCreatorModal` (~6.3 kB).

### Sprint 7 — monolito fase 2 (rama `fix/superauditor-sprint-7`)

**H-002 (continuación):** extraído `ConsolidatedDashboard` → `src/features/dashboard/ConsolidatedDashboard.jsx`, cargado con `React.lazy`. Constante compartida `REPORT_TYPE_LABEL` movida a `src/constants.js` (la usan el dashboard y `BoardSummaryPill`). De paso se **corrigió un anti-patrón**: el `Shell` interno (componente-en-render que se remontaba en cada render) se movió a un `DashboardShell` de módulo.

Resultado del code-splitting acumulado: el bundle inicial baja a **727.7 kB** (gzip 194 kB) desde 755 kB; chunks separados `PlanSelectionModal` (~10.8 kB) y `ConsolidatedDashboard` (~11.9 kB) se descargan solo al abrirlos.

Refactor **behavior-preserving** (copia verbatim + fix del Shell), verificado: `npm test` 42/42 ✅, build ✅, lint de archivos nuevos sin errores. Sin migración.

### Sprint 6 — accesibilidad (cierre) + monolito fase 1 (rama `fix/superauditor-sprint-6`)

**Accesibilidad pendiente (cerrada):** se aplicó `useDialog` + semántica de diálogo a `SuperTaskCreatorModal`; el tour de `Onboarding` recibió `role="dialog"`/`aria-label` + Escape-para-saltar (sin focus-trap, para no romper la navegación del tour).

**H-002 — descomposición del monolito (fase 1):**
- Se introdujo el patrón de **code-splitting con `React.lazy` + `Suspense`** y la estructura `src/features/`.
- Extraído `PlanSelectionModal` → `src/features/billing/PlanSelectionModal.jsx`, cargado con `lazy`. Verificado: sale a su propio chunk (~10.8 kB / 3.5 kB gzip) y el bundle inicial baja.
- Piezas ya extraídas en sprints previos: `calcAporte` → `lib/aporte.js`, `aiModels.js`, `useDialog.js`.

> **H-002 es ÉPICO e incremental.** Próximas fases sugeridas (cada una su PR, con build verificado): extraer y `lazy`-cargar `ConsolidatedDashboard` (requiere mapear sus fronteras: Shell componente-en-render + visor de reportes anidado), luego paneles de reportes/evolutivo/chat, y mover constantes compartidas (`TASK_DONE`/`TASK_BLOCKED`) a `src/constants.js`. No hacer todo en un solo PR: el archivo es central y el riesgo de regresión es alto.

### Sprint 5 — accesibilidad (rama `fix/superauditor-sprint-5`)

| Hallazgo | Estado | Cambio |
|---|---|---|
| **H-009** foco visible | ✅ listo | `src/index.css`: regla global `:focus-visible` con `box-shadow` (no la pisa el `outline:none` inline; visible en claro y oscuro). Sin migración. |
| **H-008** modales accesibles | ✅ listo (núcleo) | Nuevo hook `src/useDialog.js` (foco inicial, trampa de foco, Escape, devolución de foco). Aplicado al `Modal` compartido (formulario de tareas), `NameCaptureModal`, `PlanSelectionModal` + semántica `role="dialog"`/`aria-modal`/`aria-labelledby` y `aria-label="Cerrar"`. La Visión consolidada (Shell componente-en-render) recibió `role`/`aria` + Escape a nivel de componente. Pendiente menor: aplicar el hook a `SuperTaskCreatorModal` y al tour de Onboarding. |

`npm test` 42/42 ✅, build ✅. Sin migración (cambios solo de frontend).

### Sprint 4 — rate limiting (rama `fix/superauditor-sprint-4`)

| Hallazgo | Estado | Cambio |
|---|---|---|
| **H-010** sin rate limiting | ✅ código listo · ⏳ migración pendiente | `migrations/033`: tabla `api_rate_limits` + RPC `check_rate_limit` (ventana fija, limpieza oportunista). Helper `enforceRateLimit` en `_auth.js` (429; fail-open si la RPC falta). Aplicado en: invite (30/h), chat (30/min, además de la cuota mensual), y generación IA report/monthly/scrum (20/h por usuario + 50/día por proyecto) y evolution (20/h; el cap por proyecto ya lo da el gap de 60 días). Cron interno no se limita. |

Pendiente operativo: aplicar **migración 033**. `npm test` 42/42 ✅, build ✅.

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

*Generado por SuperAuditor — Orquestado por Claude Code (A=Opus 4.8, orquestó 5 especialistas). Motor B: Codex CLI (gpt-5.5 xhigh). Motor C: Antigravity CLI (Gemini) — OMITIDO esta ronda (sin auth/red).*
*Última ronda: 2026-06-24, modo DUAL. Para regenerar con Gemini: hacé `agy` interactivo → login OAuth, y reintentá `/superauditor`.*
*Para regenerar: `/superauditor` en Claude Code.*
