# AUDIT_PLAN.md — Plan de Mejora y Auditoría Dual

> Documento autoactualizable generado y mantenido por **SuperAuditor**.
> Auditoría ejecutada por IAs independientes: Claude (Auditor A) y Codex (Auditor B). Gemini (Auditor C) no concluyó esta ronda.
> NO editar manualmente las secciones marcadas con 🤖 — serán sobrescritas en la próxima auditoría.
> Las notas humanas van en la sección "Comentarios del equipo" al final.

---

## 📌 Resumen ejecutivo 🤖

- **Proyecto:** `w-planner` (Productivity-Plus)
- **Stack detectado:** SPA Vite + React 19 · Supabase (Postgres + RLS) · Funciones Vercel (Node/Edge) · Mercado Pago · Resend · Anthropic API
- **Última auditoría:** `2026-06-19`
- **Auditores:** Claude (A) en `claude-opus-4-8` + Codex (B) en `gpt-5.5` *(reasoning xhigh)*. Gemini (C) **omitido**.
- **Modo:** `DEGRADADO` *(Auditor C/Gemini falló: el CLI devolvió `IneligibleTierError` — las cuentas individuales ya no son elegibles tras la migración de Google a Antigravity. A y B sí concluyeron, por lo que el contraste dual es válido.)*
- **Commits cubiertos:** auditoría completa del repositorio (96 commits, HEAD=1a90dc1)

### Estado actual

| Métrica | Valor |
|---|---|
| Hallazgos de consenso (A+B) — alta confianza | 5 |
| Hallazgos solo Claude (A) | 3 |
| Hallazgos solo Codex (B) | 3 |
| Discrepancias de severidad | 1 |
| Hallazgos abiertos totales | 12 |
| Hallazgos cerrados esta ronda | 0 |
| Hallazgos cerrados (acumulado) | 0 |
| Críticos abiertos | 1 |
| Altos abiertos | 5 |
| Medios abiertos | 3 |
| Bajos abiertos | 2 |

<!-- Divergencia: 5 de 12 hallazgos en consenso (42%) ≥ 30% → sin alerta. -->

### Top 3 prioridades inmediatas

> Siempre se priorizan los hallazgos de consenso (A+B) cuando los hay.

1. **Webhook de Mercado Pago sin verificación de firma** `[A+B]` `CRÍTICO` — endpoint público que escribe `users_premium` con `service_role` sin validar `x-signature`. (H-001)
2. **Llamadas a APIs externas sin timeout** `[A+B]` `ALTO` — quick win: envolver cada `fetch` en `AbortSignal.timeout`. (H-004)
3. **Roles solo aplicados en la UI, no en RLS** `[B]` (confirmado por A) `ALTO` — un participante puede editar tasks/OKRs/sprints vía el cliente Supabase saltándose las tabs. (H-007)

---

## 🤝 Hallazgos de CONSENSO (A + B) — alta confianza 🤖

> Ambas IAs detectaron este problema independientemente. Probabilidad alta de que sea cierto.

### H-001 `[A+B]` | CRÍTICO | Seguridad | Webhook de Mercado Pago sin verificación de firma ni idempotencia

**Auditores que lo reportan:** Claude (A, ALTO) y Codex (B, CRÍTICO) — severidades adyacentes; se adopta CRÍTICO.
**Eje:** Seguridad / Pentesting / Conexiones
**Detectado:** 2026-06-19
**Severidad:** CRÍTICO
**Esfuerzo estimado:** MEDIO

**Evidencia:**
- `api/mp-webhook.js:50-75` (procesa `type`/`data.id` sin validar firma)
- `api/mp-webhook.js:101`, `api/mp-webhook.js:130` (`upsert` a `users_premium` vía `service_role`)

**Descripción (Claude):**
Cualquiera puede hacer POST a `/api/mp-webhook` con un `data.id` arbitrario. El re-fetch a la API de MP mitiga la *forja de datos* (no se puede inventar un pago "authorized"), pero no la invocación: un tercero puede forzar reprocesamiento de preapprovals ajenos y abusar de la cuota de la API de MP. Además no hay registro de `event_id` procesados → un reintento desordenado puede pisar `status` con un valor stale.

**Descripción (Codex):**
La ruta pública procesa `type` y `dataId` sin validar firma/origen antes de usar `service_role` para actualizar `users_premium` (webhook spoofing / replay).

**Impacto:**
Manipulación del estado de suscripción de cuentas ajenas, abuso de cuota de la API de MP, e inconsistencia de `users_premium` bajo reintentos. Riesgo financiero/integridad de datos de pago.

**Recomendación:**
Validar `x-signature` (HMAC-SHA256 sobre `ts` + `data.id`) con `MP_WEBHOOK_SECRET`; rechazar 401 si no valida. Añadir tabla `mp_webhook_events(event_id PK, processed_at)` para idempotencia y orden de eventos.

---

### H-002 `[A+B]` | ALTO | Arquitectura | Frontend monolítico de ~8.900 líneas

**Auditores que lo reportan:** Claude (A) y Codex (B) — consenso de severidad ALTO.
**Eje:** Arquitectura
**Detectado:** 2026-06-19
**Severidad:** ALTO
**Esfuerzo estimado:** ÉPICO

**Evidencia:**
- `src/ProductivityPlus.jsx` (8914 líneas; resto del frontend <1.300)
- Codex: `src/ProductivityPlus.jsx:1429, 2534, 2771, 3116, 5278, 7709`

**Descripción:**
Un único componente concentra tablero, billing, reportes, configuración, sprints, auth, chat, evolutivo y acceso directo a Supabase. La lógica de negocio y seguridad queda acoplada a la UI.

**Impacto:**
Onboarding lento, alto riesgo de regresión, sin code-splitting por pantalla (todo al bundle inicial), PRs y merges costosos.

**Recomendación:**
Extraer por dominio (`features/tasks`, `features/billing`, `features/reports`, `features/sprints`) y mover las mutaciones Supabase a hooks/servicios tipados. Empezar por las piezas ya delimitadas (ChatEnterpriseTab, vista Evolutivo, Presentación).

---

### H-003 `[A+B]` | ALTO | Arquitectura | Ausencia total de pruebas automatizadas

**Auditores que lo reportan:** Claude (A) y Codex (B) — consenso de severidad ALTO.
**Eje:** Arquitectura
**Detectado:** 2026-06-19
**Severidad:** ALTO
**Esfuerzo estimado:** ALTO

**Evidencia:**
- No existe ningún `*.test.*`/`*.spec.*`/`__tests__/`; `package.json` solo define `dev`/`build`/`lint`/`preview`.
- Codex: `package.json:6-9`, `docs/operations.md:270` ("Agregar tests automatizados" como pendiente).

**Descripción:**
Lógica financiera (suscripciones MP), cálculo de aporte por snapshot, scheduling de reportes (ventanas 4h/5d/25d) y gating por rol/tier sin una sola prueba.

**Impacto:**
RLS, webhooks, pagos, cron e IA pueden romperse sin detección previa; cada cambio se valida en producción.

**Recomendación:**
Añadir Vitest. Priorizar unitarias de alto valor: `shouldSendNow`/`computeRange` (cron), `mapStatus`/`parseExternalReference` (mp-webhook), cálculo de aporte; luego integración de `api/*` con mocks de Supabase/Resend/MP/LLM.

---

### H-004 `[A+B]` | ALTO | Conexión | Llamadas a APIs externas sin timeout

**Auditores que lo reportan:** Claude (A, esfuerzo BAJO) y Codex (B, esfuerzo MEDIO) — consenso de severidad ALTO.
**Eje:** Conexiones
**Detectado:** 2026-06-19
**Severidad:** ALTO
**Esfuerzo estimado:** BAJO

**Evidencia:**
- `api/mp-webhook.js:15-27`, `api/mp-subscribe.js:85`, `api/invite.js:84`, `api/send-report.js:67`, `api/chat-stream.js:208`, `api/cron.js:140,336`, `api/generate-report.js:394`, `api/generate-scrum-report.js:321`

**Descripción:**
Ningún `fetch` externo usa `AbortController`/`AbortSignal.timeout` ni política de retry/backoff.

**Impacto:**
Un proveedor lento cuelga la función hasta el `maxDuration` (30-60s), agota cómputo y retrasa el resto del lote del cron.

**Recomendación:**
Wrapper HTTP con timeout 10-15s; retry con backoff solo para operaciones idempotentes; **no** reintentar cobros sin idempotency key.

---

### H-005 `[A+B]` | MEDIO | Arquitectura | Entorno sin contrato ejecutable (validación perezosa, falta `.env.example`)

**Auditores que lo reportan:** Claude (A, BAJO) y Codex (B, MEDIO) — severidades adyacentes; se adopta MEDIO.
**Eje:** Arquitectura / Conexiones
**Detectado:** 2026-06-19
**Severidad:** MEDIO
**Esfuerzo estimado:** BAJO

**Evidencia:**
- `api/_auth.js:93-102` (validación al primer uso); `src/supabaseClient.js:3-6`; no existe `.env.example`.

**Descripción:**
Las variables de entorno se validan en runtime, no al desplegar; no hay `.env.example` ni validación centralizada.

**Impacto:**
Deploys con env incompleta parecen sanos hasta que un usuario dispara el flujo; errores ambiguos y degradación silenciosa.

**Recomendación:**
Módulo `config/env` que valide el set requerido al arrancar + `.env.example` sin valores reales.

---

## 🅰️ Hallazgos solo de Claude (A) 🤖

> Solo el Auditor A reportó esto. Puede ser cierto o un falso positivo — vale la pena revisar manualmente.

### H-010 `[A]` | MEDIO | Seguridad | Sin rate limiting en endpoints que generan costo

**Eje:** Seguridad · **Detectado:** 2026-06-19 · **Severidad:** MEDIO · **Esfuerzo:** MEDIO

**Evidencia:** `api/invite.js` (email real vía Resend), `api/generate-report.js`, `api/generate-monthly-report.js`, `api/generate-scrum-report.js`, `api/chat-stream.js`. Sin throttle.

**Descripción:** Hay gating por tier y cuota mensual de chat, pero ningún límite de frecuencia por minuto. Un owner puede invocar `invite` o los endpoints IA en bucle.

**Impacto:** DoS económico (factura LLM/Resend); posible uso de `invite` para spam con plantilla de marca.

**Recomendación:** Rate limit por usuario/IP (Upstash Ratelimit o tabla con ventana deslizante) en `invite` y endpoints IA; cap diario por proyecto.

---

### H-011 `[A]` | BAJO | Conexión | Cliente admin de Supabase instanciado por request

**Eje:** Conexiones · **Detectado:** 2026-06-19 · **Severidad:** BAJO · **Esfuerzo:** BAJO

**Evidencia:** `api/mp-webhook.js:65`, `api/mp-subscribe.js:104`, `api/chat-stream.js:177-179`, `api/save-evolution.js`.

**Descripción:** Se crea un `createClient` con service_role en cada invocación en lugar de reutilizar uno a nivel de módulo. Deuda menor.

**Recomendación:** Factorizar `getAdminClient()` memoizado en `_auth.js`.

---

### H-012 `[A]` | BAJO | UX | HTML de IA renderizado sin sanitización previa (contenido aislado)

**Eje:** UX/Seguridad · **Detectado:** 2026-06-19 · **Severidad:** BAJO · **Esfuerzo:** BAJO

**Evidencia:** `src/ProductivityPlus.jsx:6968-6973` (`srcDoc={html}` con HTML del LLM persistido sin `sanitize-html` en `save-evolution.js`).

**Descripción:** El iframe usa `sandbox="allow-same-origin"` **sin** `allow-scripts`, por lo que el JS no se ejecuta (riesgo práctico nulo). Aun así, el HTML de IA se guarda sin sanitizar, a diferencia del pipeline de email (`sanitizeReportHtml`).

**Recomendación:** Aplicar `sanitize-html` antes de persistir el evolutivo (defensa en profundidad y coherencia).

---

## 🅱️ Hallazgos solo de Codex (B) 🤖

> Solo el Auditor B reportó esto. Puede ser cierto o un falso positivo — vale la pena revisar manualmente.

### H-007 `[B]` (confirmado por A en verificación) | ALTO | Seguridad | Roles aplicados solo en la UI, no en RLS

**Eje:** Seguridad / Pentesting · **Detectado:** 2026-06-19 · **Severidad:** ALTO · **Esfuerzo:** ALTO

**Evidencia:**
- `src/ProductivityPlus.jsx:8507, 8512, 8525` (UI filtra tabs por `myRole`)
- `migrations/006_security_hardening.sql:223, 267, 277` (policies `member_all` = `FOR ALL` a cualquier miembro)
- `migrations/025_roles_and_name.sql:1-19` (comentario explícito: *"role solo define qué tour ve la persona y qué features se le habilitan"*)

**Descripción (Codex):** La UI filtra tabs por `myRole`, pero RLS permite `FOR ALL` a cualquier miembro en `tasks`, `okrs`, `key_results`, `sprints`, `task_history`, `notifications`. Un participante puede saltarse la UI y modificar recursos que visualmente no debería administrar.

**Verificación (Claude):** Confirmado. La migración 025 añade `project_members.role` pero **no** modifica las policies `member_all` de la 006; el rol nunca se evalúa en la capa de datos. Un miembro con rol `participant` puede, con su JWT + anon key, hacer INSERT/UPDATE/DELETE directo sobre esas tablas.

**Impacto:** Broken Access Control intra-proyecto. Mitigado parcialmente porque todos son colaboradores invitados del mismo proyecto (confianza media), pero el control de rol es puramente cosmético.

**Recomendación:** Modelar permisos por rol en SQL: funciones `can_edit_tasks`/`can_manage_sprints`/`can_manage_okrs` y reemplazar las policies `member_all` por policies por acción/rol, o mover las operaciones sensibles a RPCs con validación de rol.

---

### H-008 `[B]` | ALTO | UX | Modales sin semántica accesible ni control de foco

**Eje:** UX · **Detectado:** 2026-06-19 · **Severidad:** ALTO · **Esfuerzo:** MEDIO

**Evidencia:** `src/ProductivityPlus.jsx:1379, 1399` (Modal genérico).

**Descripción (Codex):** El modal no declara `role="dialog"`, `aria-modal`, título asociado, trampa de foco ni cierre con Escape; el botón `×` no tiene `aria-label`. *(No verificado a fondo por A — revisar manualmente.)*

**Criterio violado:** WCAG 2.1 AA, navegación por teclado, semántica de diálogos.

**Recomendación:** Componente modal accesible con foco inicial, retorno de foco, Escape, `aria-labelledby` y botón cerrar etiquetado.

---

### H-009 `[B]` | MEDIO | UX | `outline: none` sin reemplazo de foco visible consistente

**Eje:** UX · **Detectado:** 2026-06-19 · **Severidad:** MEDIO · **Esfuerzo:** BAJO

**Evidencia:** `src/ProductivityPlus.jsx:1543, 2244, 3727, 4421, 5851`.

**Descripción (Codex):** Muchos controles usan `outline: none` sin una estrategia global de foco visible. *(No verificado a fondo por A — revisar manualmente.)*

**Criterio violado:** WCAG 2.4.7 — Focus Visible.

**Recomendación:** Definir `:focus-visible` global y eliminar `outline: none` salvo que haya reemplazo equivalente.

---

## ⚖️ Discrepancias de severidad 🤖

> Mismo hallazgo, distinta calificación entre las dos IAs. Decide tú con qué severidad lo tratas.

### H-006 ⚖️ | Discrepancia de severidad | Seguridad | `assertProjectCanUseIa` falla abierto si la RPC no existe

**Evidencia:** `api/_auth.js:212-230` (ante error `42883` hace `return` y deja pasar la llamada IA); `api/generate-report.js:329`, `api/generate-scrum-report.js:250`, `api/generate-monthly-report.js:323`.

**Opinión de Claude (A):** Severidad **BAJO** — "tolerancia pensada para entornos sin la migración 016; el riesgo solo se materializa si la RPC se renombra/borra por error de despliegue".

**Opinión de Codex (B):** Severidad **ALTO** — "un ambiente con migraciones incompletas habilita reportes IA pagados sin validar plan, generando costos".

**Decisión pendiente del equipo:** ambos coinciden en el fix → **fail-closed en producción**, permitir bypass solo con flag explícito de desarrollo (`ALLOW_IA_WITHOUT_RPC`). La severidad depende de cuán probable consideres un deploy con migración 016 ausente.

---

## ✅ Hallazgos cerrados 🤖

> Trazabilidad histórica. NO eliminar.

*(Ninguno — primera auditoría.)*

---

## 🗺️ Plan de mejora priorizado 🤖

> Recalculado en cada auditoría. Orden: consenso primero (por severidad × esfuerzo), luego solo-A y solo-B, luego discrepancias.

### Sprint propuesto (próximas 1-2 semanas)

1. **H-001 · `[A+B]` CRÍTICO** — Validar firma `x-signature` de MP + idempotencia por `event_id`. *(MEDIO)*
2. **H-004 · `[A+B]` ALTO** — Wrapper `fetch` con `AbortSignal.timeout(10-15s)` en todas las llamadas externas. *(BAJO — quick win)*
3. **H-007 · `[B]`✔ ALTO** — Permisos por rol en RLS/RPC; reemplazar policies `member_all`. *(ALTO)*
4. **H-006 · ⚖️** — Hacer fail-closed el gating de IA en producción. *(BAJO)*
5. **H-005 · `[A+B]` MEDIO** — `.env.example` + validación de entorno al arranque. *(BAJO)*
6. **H-003 · `[A+B]` ALTO** — Bootstrap de Vitest + primeras unitarias de cron/webhook/aporte. *(ALTO, arrancar ahora)*

### Backlog (medio plazo)

- **H-002 · `[A+B]` ALTO** — Descomponer el monolito `ProductivityPlus.jsx` por dominios. *(ÉPICO)*
- **H-008 · `[B]` ALTO** — Modal accesible (WCAG AA). *(MEDIO)*
- **H-010 · `[A]` MEDIO** — Rate limiting en `invite` y endpoints IA. *(MEDIO)*
- **H-009 · `[B]` MEDIO** — Estrategia global de `:focus-visible`. *(BAJO)*

### Mejoras menores (cuando sobre tiempo)

- **H-011 · `[A]` BAJO** — `getAdminClient()` memoizado.
- **H-012 · `[A]` BAJO** — Sanitizar HTML del evolutivo antes de persistir.

---

## 📜 Historial de auditorías 🤖

| Fecha | Modo | Consenso | Solo A | Solo B | Discrepancias | Cerrados esta ronda | Commits |
|---|---|---|---|---|---|---|---|
| 2026-06-19 | DEGRADADO (sin C/Gemini) | 5 | 3 | 3 | 1 | 0 | 96 (repo completo) |

---

## 💬 Comentarios del equipo (editable manualmente)

> Esta sección NO es sobrescrita por SuperAuditor. Úsala para anotar decisiones, postergar deliberadamente un hallazgo, justificar por qué algo se considera "aceptado como riesgo", o anotar por qué le diste la razón a A o a B en una discrepancia.

<!-- Escribe aquí libremente -->

---

*Generado por SuperAuditor v2 — Orquestado por Claude Code, motor B: Codex CLI (OpenAI).*
*Para regenerar manualmente: `/superauditor` en Claude Code.*
