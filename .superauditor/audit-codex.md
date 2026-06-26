# Auditoría Codex — 7681794..HEAD

## Metadatos
- Auditor: Codex (OpenAI)
- Fecha: 2026-06-24
- Modelo: GPT-5 (Codex)
- Proyecto: C:/Users/jefer/proyectos/w-planner

## Resumen
El rango introduce captura de referidos, persistencia previa al pago, notificación de pagos aprobados a un hub externo y ajustes de checkout/UX. El flujo de pago principal valida JWT, firma de Mercado Pago y `service_role` antes de cobrar (`api/mp-subscribe.js:47`, `api/mp-webhook.js:138`, `api/mp-subscribe.js:55`). Los riesgos relevantes están en robustez operativa: la comisión al hub es best-effort sin reintentos durables, las variables `HUB_*` no están documentadas y hay caminos que marcan éxito aunque la base aún no tenga la migración. No detecté secretos reales en el diff; el único match de búsqueda fue una integridad de `package-lock.json`.

## Hallazgos

### Eje 1 — Arquitectura

### H-001 | [MEDIO] | Arquitectura | Billing, referidos y navegación siguen creciendo dentro del componente raíz

**Evidencia:** `src/ProductivityPlus.jsx:1478`, `src/ProductivityPlus.jsx:1550`, `src/ProductivityPlus.jsx:1653`, `src/ProductivityPlus.jsx:2131`

**Descripción:** El componente raíz contiene `PlansLauncher`, `BillingReturnOverlay`, activación de hooks de referidos y lógica de navegación responsive. Son responsabilidades de billing, integración de pagos y shell UI mezcladas en el mismo archivo raíz.

**Impacto:** Dificulta pruebas aisladas del checkout y del retorno de Mercado Pago, aumenta riesgo de regresiones en la app shell y complica revisar cambios críticos de pagos sin leer un archivo grande.

**Recomendación:** Extraer `PlansLauncher`, `BillingReturnOverlay` y `TabsNav` a módulos de `src/features/billing/` y `src/features/navigation/`, con tests unitarios de estados principales.

**Esfuerzo estimado:** MEDIO

### H-002 | [MEDIO] | Arquitectura | El formato de `referral_code` está duplicado y no existe como restricción de datos

**Evidencia:** `src/hooks/useReferralCapture.js:19`, `api/capture-referral.js:34`, `api/mp-subscribe.js:71`, `migrations/034_referral_capture.sql:13`

**Descripción:** El mismo invariante de 8 caracteres alfanuméricos en mayúscula se define en frontend y en dos endpoints, pero la tabla guarda `referral_code TEXT NOT NULL` sin `CHECK`.

**Impacto:** Si un script admin, migración futura o endpoint nuevo escribe con `service_role`, puede persistir valores que el resto del flujo no espera y enviar datos inválidos al hub.

**Recomendación:** Agregar `CHECK (referral_code ~ '^[A-Z0-9]{8}$')`, centralizar el validador compartido y cubrir el caso con tests.

**Esfuerzo estimado:** BAJO

### Eje 2 — Seguridad

### H-003 | [MEDIO] | Seguridad | El cliente del hub puede registrar PII/metadata financiera en logs

**Evidencia:** `api/mp-webhook.js:278`, `api/mp-webhook.js:283`, `api/mp-webhook.js:285`, `api/_hub-client.js:137`

**Descripción:** El webhook construye un payload con email del pagador y datos de pago para el hub. Si el hub responde error con JSON, `_hub-client` registra `data?.error ?? data`, lo que puede incluir eco del payload o detalles sensibles.

**Impacto:** Exposición de PII y datos financieros en logs de servidor, con riesgo operativo y de cumplimiento.

**Recomendación:** Loguear solo `status`, `mp_payment_id` hasheado/parcial y un `request_id`; redactar emails y nunca imprimir el body completo del upstream.

**Esfuerzo estimado:** BAJO

### Eje 3 — Pentesting interno

### H-004 | [MEDIO] | Seguridad/Pentesting | `/api/capture-referral` permite abuso autenticado sin rate limit

**Tipo de vulnerabilidad:** Abuso de endpoint / consumo de recursos

**Superficie:** `POST /api/capture-referral`

**Evidencia:** `api/capture-referral.js:18`, `api/capture-referral.js:56`, `api/capture-referral.js:67`, `api/_auth.js:280`

**Vector intentado (resumido):** Una sesión autenticada puede repetir llamadas con códigos sintácticamente válidos; cada request llega a validación de JWT y a una escritura/upsert con cliente admin, sin usar el helper `enforceRateLimit`.

**Resultado:** VULNERABLE

**Fix recomendado:** Importar `enforceRateLimit`, aplicar una cuota por usuario antes del upsert y registrar 429 para abuso. Ejemplo conceptual: bucket `capture-referral:${user.id}` con ventana horaria baja.

**Esfuerzo estimado:** BAJO

### Eje 4 — Conexiones

### H-005 | [ALTO] | Conexión | La notificación al hub de comisiones no tiene reintento durable

**Conexión afectada:** C-001 Hub financiero de Soft a tu Medida

**Evidencia:** `api/mp-webhook.js:253`, `api/mp-webhook.js:256`, `api/mp-webhook.js:283`, `api/mp-webhook.js:296`, `api/_hub-client.js:87`

**Síntoma:** En pagos aprobados se actualiza `users_premium` y luego se llama al hub. Si el hub falla, solo se emite `console.warn`; no hay outbox, reintento posterior ni estado persistido de notificación pendiente.

**Impacto:** Un timeout o 5xx transitorio del hub puede perder una comisión aunque el cobro real haya sido aprobado.

**Recomendación:** Persistir un outbox `hub_payment_notifications` con `mp_payment_id`, estado, intentos y próximo retry; procesarlo con cron/backoff. Mantener idempotencia por `mp_payment_id`.

**Esfuerzo estimado:** MEDIO

### H-006 | [MEDIO] | Conexión | Las variables `HUB_*` requeridas no están documentadas en el manifiesto de entorno

**Conexión afectada:** C-001 Hub financiero de Soft a tu Medida

**Evidencia:** `api/_hub-client.js:29`, `api/_hub-client.js:33`, `.env.example:29`, `.env.example:45`, `docs/mercadopago-setup.md:17`

**Síntoma:** El cliente exige `HUB_WEBHOOK_URL`, `HUB_WEBHOOK_SECRET` y `HUB_APP_SLUG`, pero `.env.example` y la guía de Mercado Pago solo documentan variables de MP y `APP_BASE_URL`.

**Impacto:** El deploy puede quedar “verde” para pagos pero sin comisiones al hub; el fallo queda reducido a logs.

**Recomendación:** Agregar `HUB_WEBHOOK_URL`, `HUB_WEBHOOK_SECRET` y `HUB_APP_SLUG` a `.env.example`, `docs/deployment.md` y `docs/mercadopago-setup.md`, marcando cuáles son secretos.

**Esfuerzo estimado:** BAJO

### H-007 | [MEDIO] | Conexión | La falta de migración de `user_referrals` se reporta como éxito y bloquea reintentos

**Conexión afectada:** C-002 Supabase Postgres / tabla `user_referrals`

**Evidencia:** `api/capture-referral.js:79`, `api/capture-referral.js:81`, `src/hooks/useReferralSync.js:64`, `src/hooks/useReferralSync.js:66`

**Síntoma:** Si la tabla no existe, el endpoint devuelve 200 con `tabla_pendiente`; el frontend marca `wplanner_ref_synced=true` ante cualquier `res.ok`.

**Impacto:** En un despliegue con código antes que migración, el browser deja de reintentar y la atribución pre-pago puede perderse silenciosamente.

**Recomendación:** Devolver 503 cuando falte la tabla, o hacer que el frontend solo marque sincronizado con `{ ok: true }` sin `info: "tabla_pendiente"`; desplegar migración antes del código.

**Esfuerzo estimado:** BAJO

### Eje 5 — UX/UI

### H-008 | [MEDIO] | UX | El checkout cierra el modal antes de mostrar estado de redirección

**Pantalla / componente afectado:** Modal de planes / checkout Mercado Pago

**Evidencia:** `src/ProductivityPlus.jsx:1536`, `src/features/billing/PlanSelectionModal.jsx:32`, `src/features/billing/PlanSelectionModal.jsx:35`

**Descripción:** El botón tiene estado `busy` y texto “Redirigiendo…”, pero el padre desmonta el modal con `setOpen(false)` antes de iniciar `subscribe`. En latencia de API, el usuario queda sin feedback hasta que navegue o falle con `alert`.

**Criterio violado:** Estado de carga visible en acciones que dependen de red.

**Recomendación:** Mantener el modal abierto durante `subscribe`, deshabilitar CTAs y mostrar “Redirigiendo…” hasta recibir `init_point`; cerrar solo al navegar o al cancelar.

**Esfuerzo estimado:** BAJO

### H-009 | [BAJO] | UX | El botón de cierre del modal queda por debajo del tamaño táctil esperado

**Pantalla / componente afectado:** Modal de planes

**Evidencia:** `src/features/billing/PlanSelectionModal.jsx:56`, `src/features/billing/PlanSelectionModal.jsx:57`, `src/features/billing/PlanSelectionModal.jsx:143`

**Descripción:** El cierre mide 38×38 px. La guía de UX usada para esta auditoría pide targets móviles mínimos de 44×44 px.

**Criterio violado:** Touch target mínimo para móvil.

**Recomendación:** Subir el área interactiva a mínimo 44×44 px sin reducir el affordance visual.

**Esfuerzo estimado:** BAJO

## Notas para el orquestador
La revisión fue estática y limitada al código local del rango `7681794..HEAD`; no llamé a Mercado Pago, Supabase ni al hub externo. No modifiqué archivos. El árbol ya tenía cambios locales en `.superauditor/audit-codex.md`, `.superauditor/audit-gemini.md` y `VALIDACION_W-PLANNER.md`; los ignoré por estar fuera del alcance del diff auditado.