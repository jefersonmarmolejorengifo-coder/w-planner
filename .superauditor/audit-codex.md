# Auditoría Codex — 1a90dc1..52ca539

## Metadatos
- Auditor: Codex (OpenAI)
- Fecha: 2026-06-22
- Modelo: GPT-5 (Codex)
- Proyecto: C:/Users/jefer/proyectos/w-planner

## Resumen
El proyecto es una app Vite/React con funciones serverless en `api/*`, Supabase como BD/Auth, Mercado Pago para suscripciones, Resend para email y Anthropic/Gemini para IA. El rango auditado endurece varias áreas, pero todavía deja riesgos relevantes en pagos, webhooks, RPCs `SECURITY DEFINER` y aislamiento de sesiones de chat. La mayor deuda arquitectónica sigue concentrada en un frontend monolítico que mezcla onboarding, billing, dashboard, IA, proyectos y configuración. No detecté secretos reales versionados; sí placeholders y documentación.

## Hallazgos

### Eje 1 — Arquitectura

### H-001 | ALTO | Arquitectura | `ProductivityPlus.jsx` concentra dominios críticos no relacionados

**Evidencia:** `src/ProductivityPlus.jsx:2535`, `src/ProductivityPlus.jsx:4518`, `src/ProductivityPlus.jsx:7204`, `src/ProductivityPlus.jsx:8155`

**Descripción:** El mismo archivo contiene billing/premium, landing de proyectos, evolutivo IA, chat IA y selección de planes. Esto mezcla flujos de negocio, UI, llamadas a Supabase y lógica de pago en una sola unidad.

**Impacto:** Aumenta el blast radius de cambios, dificulta pruebas focalizadas y hace más probable romper billing o IA al tocar UI.

**Recomendación:** Separar por dominios: `features/billing`, `features/projects`, `features/ai-reports`, `features/chat`, con hooks de datos y componentes pequeños.

**Esfuerzo estimado:** ALTO

### H-002 | MEDIO | Arquitectura | Planes y límites viven en dos fuentes de verdad

**Evidencia:** `src/plans.js:5`, `src/plans.js:13`, `api/mp-subscribe.js:44`, `migrations/028_chat_to_pro_power.sql:14`

**Descripción:** El cobro usa `src/plans.js`, pero el gating real depende de `tier_limits` y RPCs en Supabase. El propio comentario advierte que cambiar límites en código exige una migración manual.

**Impacto:** Un despliegue con código y migraciones desalineadas puede cobrar un plan que no desbloquea sus features, o mostrar límites distintos a los aplicados.

**Recomendación:** Usar una fuente canónica server-side para precio, límites y features, o agregar verificación automática de consistencia en build/deploy.

**Esfuerzo estimado:** MEDIO

### Eje 2 — Seguridad

### H-003 | ALTO | Seguridad | Webhook de Mercado Pago procesa eventos sin firma si falta el secreto

**Evidencia:** `api/mp-webhook.js:22`, `api/mp-webhook.js:119`, `api/mp-webhook.js:124`, `api/mp-webhook.js:175`

**Descripción:** Si `MP_WEBHOOK_SECRET` no está configurado, `verifyMpSignature` devuelve `null` y el handler continúa procesando eventos, incluyendo escrituras en `users_premium` con service role.

**Impacto:** Un error de configuración deja abierto un endpoint que modifica estado de suscripción. Aunque consulta MP, la superficie queda expuesta a abuso y replay no autenticado.

**Recomendación:** Fail-closed: en producción rechazar todo webhook sin secreto o firma válida. Validar `MP_WEBHOOK_SECRET` al arranque/deploy.

**Esfuerzo estimado:** BAJO

### H-004 | MEDIO | Seguridad | RPCs `SECURITY DEFINER` exponen estado de features/cuotas a `anon`

**Evidencia:** `migrations/017_pricing_and_features.sql:30`, `migrations/017_pricing_and_features.sql:46`, `migrations/023_enterprise_price_and_chat_quota.sql:22`, `migrations/023_enterprise_price_and_chat_quota.sql:57`

**Descripción:** `project_has_feature`, `project_can_use_chat` y `project_chat_quota_remaining` corren como `SECURITY DEFINER` y algunas están concedidas a `anon` sin validar membresía del proyecto.

**Impacto:** Con IDs de proyecto, un cliente anónimo puede inferir estado premium, features activas y uso mensual del chat.

**Recomendación:** Revocar grants a `anon` y validar `auth.uid()` como owner/miembro dentro de cada RPC antes de devolver datos.

**Esfuerzo estimado:** MEDIO

### H-005 | MEDIO | Seguridad | Chat IA no limita tamaño de `userMessage`

**Evidencia:** `api/chat-stream.js:112`, `api/chat-stream.js:113`, `api/chat-stream.js:185`, `api/chat-stream.js:202`

**Descripción:** Solo se valida que `userMessage` exista y no esté vacío. Luego se persiste completo y se envía al LLM.

**Impacto:** Permite abuso de costo, latencia y almacenamiento con mensajes excesivos.

**Recomendación:** Definir límite de caracteres/tokens por mensaje, rechazar con 413 y aplicar conteo antes de persistir o llamar a Anthropic.

**Esfuerzo estimado:** BAJO

### Eje 3 — Pentesting interno

### H-006 | ALTO | Seguridad/Pentesting | `sessionId` de chat permite contaminación entre proyectos y bypass de cuota

**Tipo de vulnerabilidad:** IDOR / lógica de negocio

**Superficie:** `POST /api/chat-stream`

**Evidencia:** `api/chat-stream.js:122`, `api/chat-stream.js:146`, `api/chat-stream.js:170`, `api/chat-stream.js:185`

**Vector intentado (resumido):** Un owner puede enviar `projectId` de un proyecto y `sessionId` de otro proyecto propio. El código valida acceso al `projectId`, pero carga la sesión solo por `id` y persiste mensajes en esa sesión.

**Resultado:** VULNERABLE

**Fix recomendado:** Al buscar sesión, filtrar también por `project_id` y `owner_user_id`; si no coincide, devolver 403. La cuota debe cobrarse sobre la sesión/proyecto donde se persiste.

**Esfuerzo estimado:** BAJO

### H-007 | MEDIO | Seguridad/Pentesting | Inyección HTML en correos de retrospectiva vía nombre de sprint

**Tipo de vulnerabilidad:** HTML injection / phishing interno

**Superficie:** `/api/open-retro` → email Resend

**Evidencia:** `api/open-retro.js:25`, `api/open-retro.js:32`, `api/open-retro.js:36`, `api/open-retro.js:144`

**Vector intentado (resumido):** El nombre del sprint se interpola en HTML y asunto sin escape previo. Un sprint con marcado HTML controlado por usuario puede alterar el correo enviado a participantes.

**Resultado:** VULNERABLE

**Fix recomendado:** Escapar `sprint.name` antes de insertarlo en HTML y normalizarlo para asunto de correo.

**Esfuerzo estimado:** BAJO

### Eje 4 — Conexiones

### H-008 | ALTO | Conexión | Checkout puede iniciar aunque Supabase admin no pueda reconciliar el pago

**Conexión afectada:** C-002 Mercado Pago + C-001 Supabase

**Evidencia:** `api/mp-subscribe.js:52`, `api/mp-subscribe.js:93`, `api/mp-subscribe.js:95`, `api/mp-webhook.js:98`

**Síntoma:** `mp-subscribe` exige `MP_ACCESS_TOKEN`, pero si falta `SUPABASE_SERVICE_ROLE_KEY` solo omite guardar el estado pending y aun devuelve `init_point`.

**Impacto:** El usuario puede pagar y quedar sin upgrade si el webhook tampoco puede escribir en Supabase.

**Recomendación:** Validar Supabase admin antes de crear la preapproval en MP. Si falta, responder 503 y no iniciar cobro.

**Esfuerzo estimado:** BAJO

### H-009 | BAJO | Conexión | Metadata de modelo IA inconsistente

**Conexión afectada:** C-004 Anthropic

**Evidencia:** `api/generate-report.js:409`, `api/generate-report.js:489`, `src/ProductivityPlus.jsx:2721`

**Síntoma:** El endpoint semanal llama `claude-sonnet-4-6`, pero responde header `X-Wplanner-Model: claude-opus-4-7` y la UI declara “Opus 4.7”.

**Impacto:** Costos, auditoría de modelos e historial quedan incorrectos.

**Recomendación:** Centralizar constantes de modelo y reutilizarlas en request, headers y UI.

**Esfuerzo estimado:** BAJO

### Eje 5 — UX/UI

### H-010 | MEDIO | UX | Modales principales no declaran semántica de diálogo ni foco accesible

**Pantalla / componente afectado:** Planes, captura de nombre, tour guiado, confirmación de borrado

**Evidencia:** `src/ProductivityPlus.jsx:8183`, `src/ProductivityPlus.jsx:8276`, `src/NameCaptureModal.jsx:50`, `src/Onboarding.jsx:591`

**Descripción:** Los overlays son `div` sin `role="dialog"`, sin `aria-modal`, sin trampa de foco y sin manejo visible de `Esc`.

**Criterio violado:** WCAG / patrón estándar de modal accesible

**Recomendación:** Usar un componente modal común con `role="dialog"`, `aria-modal="true"`, foco inicial, retorno de foco, cierre por `Esc` y bloqueo de tabulación fuera.

**Esfuerzo estimado:** MEDIO

### H-011 | MEDIO | UX | Foco visible eliminado en inputs críticos

**Pantalla / componente afectado:** Login/onboarding/proyectos

**Evidencia:** `src/NameCaptureModal.jsx:73`, `src/NameCaptureModal.jsx:84`, `src/ProductivityPlus.jsx:4818`, `src/ProductivityPlus.jsx:4935`

**Descripción:** Inputs críticos usan `outline: "none"` y no se observa reemplazo de foco equivalente en el mismo estilo.

**Criterio violado:** WCAG 2.4.7 — foco visible

**Recomendación:** Definir estilo `:focus-visible` común para inputs, selects, textareas y botones, con contraste suficiente.

**Esfuerzo estimado:** BAJO

## Notas para el orquestador
Auditoría estática, limitada al código del proyecto y al rango solicitado. No ejecuté pentest contra servicios externos ni llamé APIs de terceros. `npm audit` y `npm run lint` fueron bloqueados por la política del entorno, por lo que no reporto resultados dinámicos de dependencias o lint. El worktree ya tenía `.superauditor/audit-codex.md` modificado antes de esta revisión; no hice cambios.