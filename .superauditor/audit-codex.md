# Auditoría Codex — auditoría completa del repositorio (96 commits, estado actual de HEAD=1a90dc1)

## Metadatos
- Auditor: Codex (OpenAI)
- Fecha: 2026-06-19
- Modelo: GPT-5 (Codex)
- Proyecto: /c/Users/jefer/proyectos/w-planner

## Resumen
El proyecto es una app React/Vite con funciones Vercel, Supabase/RLS, Resend, Mercado Pago y APIs de IA. La superficie crítica está en autorización por roles, webhooks de pago, costos de IA y resiliencia de integraciones externas. No encontré secretos versionados en archivos no ignorados; `.env.local` está ignorado. La deuda principal es que mucho comportamiento de negocio vive en un monolito frontend y no hay pruebas automatizadas que cubran pagos, RLS, cron o generación de reportes.

## Hallazgos

### Eje 1 — Arquitectura

### H-001 | ALTO | Arquitectura | Frontend monolítico concentra UI, datos y negocio

**Evidencia:** `src/ProductivityPlus.jsx:1429`, `src/ProductivityPlus.jsx:2534`, `src/ProductivityPlus.jsx:2771`, `src/ProductivityPlus.jsx:3116`, `src/ProductivityPlus.jsx:5278`, `src/ProductivityPlus.jsx:7709`

**Descripción:** Un único archivo contiene tablero, billing, reportes, configuración, sprints, auth, chat, evolutivo y acceso directo a Supabase.

**Impacto:** Cambios de negocio o seguridad quedan acoplados a UI; aumenta riesgo de regresiones y dificulta aislar permisos por dominio.

**Recomendación:** Separar por dominios (`features/tasks`, `features/billing`, `features/reports`, `features/sprints`) y mover mutaciones Supabase a servicios/hook APIs tipados.

**Esfuerzo estimado:** ÉPICO

### H-002 | ALTO | Arquitectura | No hay pruebas automatizadas para flujos críticos

**Evidencia:** `package.json:6`, `package.json:7`, `package.json:8`, `package.json:9`, `README.md:150`, `README.md:155`, `README.md:156`, `docs/operations.md:270`

**Descripción:** Los scripts solo incluyen `dev`, `build`, `lint` y `preview`; la propia documentación deja “Agregar tests automatizados” como pendiente.

**Impacto:** RLS, webhooks, pagos, cron e IA pueden romperse sin detección previa.

**Recomendación:** Añadir tests unitarios para helpers/RPC wrappers y tests de integración para APIs `api/*` con mocks de Supabase, Resend, Mercado Pago y modelos IA.

**Esfuerzo estimado:** ALTO

### Eje 2 — Seguridad

### H-003 | ALTO | Seguridad | Roles de UI no están respaldados por RLS

**Evidencia:** `src/ProductivityPlus.jsx:8507`, `src/ProductivityPlus.jsx:8512`, `src/ProductivityPlus.jsx:8525`, `migrations/006_security_hardening.sql:223`, `migrations/006_security_hardening.sql:267`, `migrations/006_security_hardening.sql:277`

**Descripción:** La UI filtra tabs por `myRole`, pero RLS permite `FOR ALL` a cualquier miembro en `tasks`, `okrs`, `key_results`, `sprints`, `task_history` y `notifications`.

**Impacto:** Un participante puede saltarse la UI y modificar recursos que visualmente no debería administrar.

**Recomendación:** Modelar permisos por rol en SQL/RPC: funciones `can_edit_tasks`, `can_manage_sprints`, `can_manage_okrs`; reemplazar policies `member_all`.

**Esfuerzo estimado:** ALTO

### H-004 | ALTO | Seguridad | Gating premium de IA falla abierto si falta la RPC

**Evidencia:** `api/_auth.js:210`, `api/_auth.js:212`, `api/_auth.js:217`, `api/_auth.js:218`, `api/generate-report.js:329`, `api/generate-scrum-report.js:250`, `api/generate-monthly-report.js:323`

**Descripción:** `assertProjectCanUseIa` permite continuar cuando `user_can_use_ia_on_project` no existe.

**Impacto:** Un ambiente con migraciones incompletas puede habilitar reportes IA pagados sin validar plan, generando costos.

**Recomendación:** Fallar cerrado en producción; permitir bypass solo con flag explícito de desarrollo.

**Esfuerzo estimado:** BAJO

### Eje 3 — Pentesting interno

### H-005 | ALTO | Seguridad/Pentesting | Bypass conceptual de permisos por API Supabase directa

**Tipo de vulnerabilidad:** Broken Access Control / autorización insuficiente

**Superficie:** Cliente Supabase directo sobre tablas de proyecto

**Evidencia:** `migrations/006_security_hardening.sql:267`, `migrations/006_security_hardening.sql:272`, `migrations/006_security_hardening.sql:277`, `src/ProductivityPlus.jsx:8507`, `src/ProductivityPlus.jsx:8512`

**Vector intentado (resumido):** Un miembro autenticado puede usar su sesión para llamar directamente a Supabase y modificar OKRs o sprints aunque la tab esté oculta para su rol.

**Resultado:** VULNERABLE

**Fix recomendado:** Mover operaciones sensibles a RPCs con validación de rol y restringir RLS por acción/rol.

**Esfuerzo estimado:** ALTO

### H-006 | CRÍTICO | Seguridad/Pentesting | Webhook de Mercado Pago sin verificación de firma

**Tipo de vulnerabilidad:** Webhook spoofing / replay

**Superficie:** `/api/mp-webhook`

**Evidencia:** `api/mp-webhook.js:50`, `api/mp-webhook.js:57`, `api/mp-webhook.js:69`, `api/mp-webhook.js:101`, `api/mp-webhook.js:130`

**Vector intentado (resumido):** La ruta pública procesa `type` y `dataId` sin validar firma/origen antes de usar `service_role` para actualizar `users_premium`.

**Resultado:** VULNERABLE

**Fix recomendado:** Validar cabeceras de firma de Mercado Pago, rechazar eventos no firmados y registrar IDs procesados para idempotencia/replay.

**Esfuerzo estimado:** MEDIO

### Eje 4 — Conexiones

### H-007 | ALTO | Conexión | Llamadas externas sin timeout ni reintentos controlados

**Conexión afectada:** C-001 Mercado Pago, C-002 Resend, C-003 Anthropic, C-004 Gemini, C-005 APIs internas por cron

**Evidencia:** `api/mp-subscribe.js:85`, `api/mp-webhook.js:15`, `api/send-report.js:67`, `api/invite.js:84`, `api/cron.js:140`, `api/generate-report.js:394`, `api/generate-scrum-report.js:321`

**Síntoma:** `fetch` se usa sin `AbortController`, timeout explícito, política de retry o backoff.

**Impacto:** Una integración lenta puede colgar funciones serverless, duplicar cron jobs o agotar duración de Vercel.

**Recomendación:** Crear wrapper HTTP con timeout 10-30s, retry con backoff para operaciones idempotentes y no reintentar cobros sin idempotency key.

**Esfuerzo estimado:** MEDIO

### H-008 | MEDIO | Conexión | Variables de entorno no tienen contrato ejecutable

**Conexión afectada:** C-006 Configuración Supabase/Vercel/IA/email/pagos

**Evidencia:** `src/supabaseClient.js:3`, `src/supabaseClient.js:4`, `src/supabaseClient.js:6`, `README.md:82`, `README.md:87`, `README.md:96`, `docs/deployment.md:21`, `docs/mercadopago-setup.md:17`

**Síntoma:** Las variables están documentadas, pero no hay `.env.example` ni validación centralizada del frontend antes de `createClient`.

**Impacto:** Ambientes incompletos fallan en runtime con errores ambiguos o clientes Supabase mal inicializados.

**Recomendación:** Agregar `.env.example` sin valores reales y un módulo `config/env` que valide requeridas al iniciar.

**Esfuerzo estimado:** BAJO

### Eje 5 — UX/UI

### H-009 | ALTO | UX | Modales sin semántica accesible ni foco controlado

**Pantalla / componente afectado:** `Modal` genérico de edición/acciones

**Evidencia:** `src/ProductivityPlus.jsx:1379`, `src/ProductivityPlus.jsx:1399`

**Descripción:** El modal no declara `role="dialog"`, `aria-modal`, título asociado, trampa de foco ni cierre por Escape; el botón `×` tampoco tiene `aria-label`.

**Criterio violado:** WCAG 2.1 AA, navegación por teclado y semántica de diálogos.

**Recomendación:** Implementar componente modal accesible con foco inicial, retorno de foco, Escape, `aria-labelledby` y botón cerrar etiquetado.

**Esfuerzo estimado:** MEDIO

### H-010 | MEDIO | UX | Indicador de foco eliminado sin reemplazo consistente

**Pantalla / componente afectado:** Formularios y filtros principales

**Evidencia:** `src/ProductivityPlus.jsx:1543`, `src/ProductivityPlus.jsx:2244`, `src/ProductivityPlus.jsx:3727`, `src/ProductivityPlus.jsx:4421`, `src/ProductivityPlus.jsx:5851`

**Descripción:** Muchos controles usan `outline: none`; solo se observan casos puntuales con `tabIndex`/`aria-label`, no una estrategia global de foco visible.

**Criterio violado:** WCAG 2.4.7 — Focus Visible.

**Recomendación:** Definir estilos `:focus-visible` globales y eliminar `outline: none` salvo que haya reemplazo visible equivalente.

**Esfuerzo estimado:** BAJO

## Notas para el orquestador
Auditoría estática y defensiva; no ejecuté llamadas a Mercado Pago, Resend, Supabase ni proveedores IA. No volqué `.env.local`; aparece ignorado por Git junto con `dist/` y `node_modules/`. Algunos comandos combinados fueron bloqueados por la política local, pero se repitieron como lecturas simples cuando era necesario.