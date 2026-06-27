# Auditoría Codex — 87cb0d0..HEAD

## Metadatos
- Auditor: Codex (OpenAI)
- Fecha: 2026-06-27
- Modelo: GPT-5 Codex
- Proyecto: F:/proyectos/w-planner

## Resumen
El proyecto es una app Vite/React con funciones serverless, Supabase, Mercado Pago, Resend, Anthropic/Gemini y un nuevo outbox hacia un hub financiero. No detecté secretos reales versionados, solo placeholders en `.env.example`. El mayor riesgo está en integridad de pagos/webhooks: varias escrituras críticas no verifican `error` de Supabase o deduplican eventos antes de completar el procesamiento. En frontend hay avances de lazy loading y diálogos, pero persisten inconsistencias de permisos visibles y accesibilidad básica en flujos de entrada.

## Hallazgos

### Eje 1 — Arquitectura

### H-001 | MEDIO | Arquitectura | `ProductivityPlus.jsx` sigue concentrando demasiadas responsabilidades

**Evidencia:** `src/ProductivityPlus.jsx:1`, `src/ProductivityPlus.jsx:1731`, `src/ProductivityPlus.jsx:1752`, `src/ProductivityPlus.jsx:2303`, `src/ProductivityPlus.jsx:2446`

**Descripción:** Aunque varios tabs ya fueron extraídos con `React.lazy`, el componente principal aún concentra imports globales, autenticación, selección de proyecto, definición de tabs por rol, composición de todos los módulos y layout general en un archivo de 2446 líneas.

**Impacto:** Mantener permisos, navegación y estado global en el mismo componente aumenta el riesgo de regresiones cruzadas; por ejemplo, un cambio en roles o tabs puede afectar vistas no relacionadas.

**Recomendación:** Separar un shell de aplicación, un módulo de navegación/permisos y componentes de estado de proyecto/auth. Mantener `ProductivityPlus.jsx` como composición del shell, no como dueño de todos los flujos.

**Esfuerzo estimado:** ALTO

### H-002 | MEDIO | Arquitectura | No hay pruebas del handler real de Mercado Pago

**Evidencia:** `api/mp-webhook.test.js:13`, `api/mp-webhook.test.js:55`, `api/mp-webhook.test.js:74`, `api/mp-webhook.js:201`, `api/mp-webhook.js:260`

**Descripción:** Las pruebas cubren helpers (`verifyMpSignature`, `mapStatus`, `parseExternalReference`), pero no ejercitan el handler completo ni los efectos críticos: dedupe, fetch a MP, upsert de `users_premium`, encolado en `hub_outbox` y respuestas ante errores de Supabase.

**Impacto:** Los bugs de integridad detectados en pagos no quedarían atrapados por CI aunque rompan el flujo de cobro.

**Recomendación:** Agregar tests del handler con mocks de `createAdminClient`, MP API y hub para cubrir éxito, error de upsert, evento duplicado, fallo después de dedupe y webhook sin secreto.

**Esfuerzo estimado:** MEDIO

### Eje 2 — Seguridad

### H-003 | ALTO | Seguridad | La cuota mensual del chat IA degrada a modo no atómico si falta `service_role`

**Evidencia:** `api/_auth.js:183`, `api/_auth.js:188`, `api/chat-stream.js:153`, `api/chat-stream.js:162`, `api/chat-stream.js:181`, `api/chat-stream.js:184`, `api/chat-stream.js:239`, `migrations/036_chat_quota_atomic.sql:120`

**Descripción:** `createAdminClient()` puede devolver `null`; si ocurre, `chat-stream` no llama `project_chat_consume_quota` y cae a `project_chat_quota_remaining`, que solo lee el contador. Además, la persistencia de mensajes también se omite si `admin` es `null`.

**Impacto:** Una mala configuración de `SUPABASE_SERVICE_ROLE_KEY` deja el chat Enterprise con control mensual incompleto: el usuario puede consumir proveedor LLM sujeto solo al rate limit de ráfaga.

**Recomendación:** Para chat, hacer fail-closed si no existe cliente admin o si falta la RPC atómica, salvo un flag explícito de desarrollo. El fallback de lectura no debe permitir llamadas al LLM en producción.

**Esfuerzo estimado:** BAJO

### H-004 | MEDIO | Seguridad | Errores internos se devuelven al cliente en endpoints sensibles

**Evidencia:** `api/submit-retro.js:82`, `api/generate-evolution.js:412`, `api/generate-evolution.js:470`, `api/generate-monthly-report.js:362`, `api/generate-monthly-report.js:431`, `api/chat-stream.js:295`

**Descripción:** Varios endpoints devuelven `error.message` de Postgres/Supabase o del proveedor IA directamente al cliente.

**Impacto:** Puede revelar nombres de tablas, constraints, detalles de proveedor o comportamiento interno útil para enumeración y diagnóstico ofensivo.

**Recomendación:** Loguear el detalle server-side y devolver mensajes genéricos por clase de fallo. Mantener códigos HTTP específicos, pero no propagar `message` sin allowlist.

**Esfuerzo estimado:** BAJO

### Eje 3 — Pentesting interno

### H-005 | ALTO | Seguridad/Pentesting | La deduplicación del webhook MP puede bloquear reintentos legítimos

**Tipo de vulnerabilidad:** Webhook idempotency poisoning / pérdida de evento

**Superficie:** `/api/mp-webhook`

**Evidencia:** `api/mp-webhook.js:157`, `api/mp-webhook.js:164`, `api/mp-webhook.js:175`, `api/mp-webhook.js:388`, `api/mp-webhook.js:394`

**Vector intentado (resumido):** El endpoint registra el evento como procesado antes de consultar MP y antes de escribir el estado premium. Si ocurre un fallo transitorio después del insert de dedupe, el endpoint devuelve 500, pero el siguiente reintento con el mismo id se responde como duplicado y ya no procesa el pago.

**Resultado:** VULNERABLE

**Fix recomendado:** Persistir el evento con estado `processing/failed/processed`, no tratarlo como duplicado si no llegó a `processed`, o mover el marcado definitivo después de completar todas las escrituras críticas.

**Esfuerzo estimado:** MEDIO

### H-006 | ALTO | Seguridad/Pentesting | Fallos de escritura en plan premium no alteran la respuesta exitosa

**Tipo de vulnerabilidad:** Business logic integrity / fallo silencioso de autorización de pago

**Superficie:** `/api/mp-subscribe` y `/api/mp-webhook`

**Evidencia:** `api/mp-subscribe.js:156`, `api/mp-subscribe.js:165`, `api/mp-webhook.js:201`, `api/mp-webhook.js:210`, `api/mp-webhook.js:260`, `api/mp-webhook.js:384`

**Vector intentado (resumido):** Las llamadas `upsert` a `users_premium` no inspeccionan `{ error }`. Si Supabase rechaza la escritura o hay un error de constraint/conexión, el flujo continúa y devuelve éxito al cliente o a Mercado Pago.

**Resultado:** VULNERABLE

**Fix recomendado:** Desestructurar `{ error }` en cada escritura crítica y fallar/reintentar según el caso. En webhook, no devolver 200 a MP si el estado premium no quedó persistido.

**Esfuerzo estimado:** BAJO

### Eje 4 — Conexiones

### H-007 | ALTO | Conexión | Variables del hub financiero no están declaradas en `.env.example`

**Conexión afectada:** C-004 Hub financiero Soft a tu Medida

**Evidencia:** `api/_hub-client.js:29`, `api/_hub-client.js:33`, `.env.example:53`

**Síntoma:** El cliente requiere `HUB_WEBHOOK_URL`, `HUB_WEBHOOK_SECRET` y `HUB_APP_SLUG`, pero `.env.example` termina sin documentarlas.

**Impacto:** Un deploy siguiendo el ejemplo queda con outbox acumulando fallos; las comisiones al hub no se notifican aunque los pagos entren.

**Recomendación:** Agregar las tres variables a `.env.example`, README/deployment docs y validación operativa. Considerar un healthcheck que alerte si el hub está desconfigurado.

**Esfuerzo estimado:** BAJO

### H-008 | ALTO | Conexión | Escrituras críticas de Mercado Pago no verifican error de Supabase

**Conexión afectada:** C-002 Mercado Pago + C-001 Supabase

**Evidencia:** `api/mp-subscribe.js:156`, `api/mp-webhook.js:201`, `api/mp-webhook.js:260`

**Síntoma:** `admin.from("users_premium").upsert(...)` se espera con `await`, pero no se revisa el objeto `{ error }` que devuelve Supabase.

**Impacto:** El usuario puede pagar y quedar sin plan activo, o MP puede dejar de reintentar porque recibió 200 aunque la actualización local falló.

**Recomendación:** Validar `error` en todos los upserts de `users_premium`; en webhook, retornar 500 para reintento cuando la persistencia falle.

**Esfuerzo estimado:** BAJO

### H-009 | MEDIO | Conexión | `hub_outbox_claim` no marca filas como reclamadas

**Conexión afectada:** C-004 Hub financiero / outbox

**Evidencia:** `migrations/038_hub_outbox.sql:45`, `migrations/038_hub_outbox.sql:54`, `api/cron.js:297`, `api/cron.js:308`

**Síntoma:** La función usa `FOR UPDATE SKIP LOCKED`, pero solo hace `SELECT`. Al volver al caller, la transacción de la RPC terminó y el lock ya no protege el envío externo posterior.

**Impacto:** Cron jobs solapados pueden reclamar y enviar la misma fila antes de que una la marque como `sent/failed`. El hub deduplica por `mp_payment_id`, pero se generan llamadas duplicadas y métricas de intentos engañosas.

**Recomendación:** Cambiar `hub_outbox_claim` a `UPDATE ... SET status='processing', attempts=attempts+1 ... RETURNING` y luego transicionar desde `processing`.

**Esfuerzo estimado:** MEDIO

### Eje 5 — UX/UI

### H-010 | MEDIO | UX | El tab “Pulso del equipo” se muestra a Scrum Master pero la vista lo bloquea

**Pantalla / componente afectado:** Navegación principal / TeamPulseTab

**Evidencia:** `src/ProductivityPlus.jsx:1744`, `src/ProductivityPlus.jsx:1752`, `src/features/team/TeamPulseTab.jsx:114`, `src/features/team/TeamPulseTab.jsx:115`, `migrations/020_sprint_retros.sql:15`, `migrations/020_sprint_retros.sql:251`

**Descripción:** La navegación permite `pulse` para `po` y `scrum_master`, pero `TeamPulseTab` muestra “solo owner” a cualquier no-owner, y la RPC también filtra por owner.

**Criterio violado:** Consistencia de navegación y prevención de callejones sin salida.

**Recomendación:** Decidir el contrato: si Scrum Master debe verlo, ajustar RPC y prop `isOwner` a permisos por rol; si no, quitar `scrum_master` de `allowedRoles`.

**Esfuerzo estimado:** BAJO

### H-011 | MEDIO | UX | Tarjetas de selección de perfil no son operables por teclado

**Pantalla / componente afectado:** `UserSelectScreen`

**Evidencia:** `src/ProductivityPlus.jsx:261`, `src/ProductivityPlus.jsx:265`

**Descripción:** Cada perfil es un `<div>` con `onClick`, sin `role="button"`, `tabIndex` ni manejo de Enter/Espacio.

**Criterio violado:** WCAG 2.1.1 — teclado.

**Recomendación:** Usar `<button>` estilizado para cada tarjeta o agregar semántica completa con `role`, `tabIndex`, `onKeyDown` y foco visible.

**Esfuerzo estimado:** BAJO

### H-012 | MEDIO | UX | Menús con `role="menu"` no implementan comportamiento de menú accesible

**Pantalla / componente afectado:** Menú overflow del header

**Evidencia:** `src/ProductivityPlus.jsx:2163`, `src/ProductivityPlus.jsx:2167`, `src/ProductivityPlus.jsx:2172`, `src/ProductivityPlus.jsx:2183`

**Descripción:** El menú usa roles ARIA de menú, pero no se observa manejo de flechas, Escape, foco inicial ni retorno de foco. Con roles `menu/menuitem`, los lectores esperan ese patrón completo.

**Criterio violado:** Patrón ARIA menu button / navegación por teclado.

**Recomendación:** Implementar el patrón completo o retirar `role="menu"` y usar una lista de botones normal dentro de un popover.

**Esfuerzo estimado:** BAJO

## Notas para el orquestador
- No modifiqué archivos.
- `npm test` no pudo ejecutarse: el entorno rechazó el comando por política de shell.
- El worktree ya tenía `.superauditor/audit-codex.md` modificado antes de mi revisión; lo ignoré por estar fuera del código auditado.