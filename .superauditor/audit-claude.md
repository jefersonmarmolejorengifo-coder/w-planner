# Auditoría Claude (Auditor A) — auditoría completa del repositorio

## Metadatos
- Auditor: Claude (Anthropic) — orquestador
- Fecha: 2026-06-19
- Modelo: claude-opus-4-8 (mejor de la línea CLAUDE ✔)
- Proyecto: c:\Users\jefer\proyectos\w-planner
- Rango: estado actual de HEAD=1a90dc1 (96 commits)

## Resumen
SPA Vite + React 19 (monolito `ProductivityPlus.jsx` de ~8.9k líneas) con backend de funciones Vercel y Postgres/Supabase. La postura de seguridad base es **notablemente buena**: JWT verificado criptográficamente contra JWKS (issuer/audience/clockTolerance), RLS habilitado en todas las tablas con datos de usuario, CSP/HSTS/anti-clickjacking bien configurados, gating de IA por suscripción, y sin secretos en el repo. Los puntos débiles principales son: el webhook de Mercado Pago no valida firma, no hay timeouts en las llamadas a APIs externas, no hay rate limiting en endpoints que gastan dinero (email/LLM), no hay tests, y el frontend es un monolito difícil de mantener.

## Hallazgos

### Eje 1 — Arquitectura

#### A-ARCH-1 | ALTO | Arquitectura | Frontend monolítico de ~8.900 líneas en un solo archivo
**Evidencia:** `src/ProductivityPlus.jsx` (8914 líneas; el resto del frontend suma <1.300).
**Descripción:** Toda la UI, lógica de negocio, estado y llamadas a datos viven en un único componente raíz. Múltiples sub-componentes (tabs, modales, chat, iframe de evolutivo) están definidos en el mismo archivo.
**Impacto:** Onboarding lento, alto riesgo de regresión al editar, imposible hacer code-splitting por pantalla (todo entra al bundle inicial), revisión de PRs costosa, merge conflicts frecuentes.
**Recomendación:** Extraer por dominio a `src/components/`, `src/tabs/`, `src/hooks/` y `src/lib/`. Empezar por las piezas ya delimitadas con comentarios `─── X ───` (ChatEnterpriseTab, vista Evolutivo, Presentación). Mover acceso a datos a hooks reutilizables.
**Esfuerzo estimado:** ÉPICO

#### A-ARCH-2 | ALTO | Arquitectura | Ausencia total de pruebas automatizadas
**Evidencia:** No existe ningún archivo `*.test.*`, `*.spec.*`, `__tests__/` ni `tests/` en el repo; `package.json` no define script `test`.
**Descripción:** Un proyecto con lógica financiera (suscripciones MP), cálculo de aporte por snapshot, scheduling de reportes y gating por rol/tier no tiene una sola prueba.
**Impacto:** Cada cambio en `cron.js` (scheduling con ventanas de 4h/5d/25d), en el mapeo de estados de MP o en la calculadora de aporte se valida solo en producción. Alto riesgo de regresión silenciosa.
**Recomendación:** Añadir Vitest. Priorizar pruebas unitarias puras de bajo costo y alto valor: `shouldSendNow`/`computeRange` (cron), `mapStatus`/`parseExternalReference` (mp-webhook), y la lógica de cálculo de aporte. Luego tests de las RPC SQL críticas.
**Esfuerzo estimado:** ALTO

#### A-ARCH-3 | BAJO | Arquitectura | Validación de entorno perezosa (no falla rápido al arranque)
**Evidencia:** `api/_auth.js:93-102` (`createSupabase` lanza solo al primer uso); cada endpoint revisa `process.env.*` ad-hoc.
**Descripción:** Las variables de entorno se validan en el momento de uso, no al desplegar. Un deploy sin `ANTHROPIC_API_KEY`/`MP_ACCESS_TOKEN`/`CRON_SECRET` parece sano hasta que un usuario dispara el flujo.
**Impacto:** Fallos diferidos difíciles de diagnosticar; degradación silenciosa (ej. `assertProjectCanUseIa` deja pasar si la RPC no existe — ver A-SEC-3).
**Recomendación:** Un módulo `env.js` que valide el set requerido y exponga getters tipados; opcional smoke-check en CI/deploy.
**Esfuerzo estimado:** BAJO

### Eje 2 — Seguridad

#### A-SEC-1 | ALTO | Seguridad | Webhook de Mercado Pago sin validación de firma
**Tipo:** Falta de verificación de origen (OWASP A08 / webhook spoofing)
**Evidencia:** `api/mp-webhook.js:50-75` — el handler procesa `type`/`data.id` desde body o query sin verificar la cabecera `x-signature`/`x-request-id` que MP envía para validar autenticidad.
**Descripción:** Cualquiera puede hacer POST a `/api/mp-webhook` con un `data.id` arbitrario. El re-fetch a la API de MP (`fetchPreapproval`/`fetchPayment`) mitiga la forja de *datos* (no se puede inventar un pago "authorized"), pero no la invocación: un tercero puede forzar reprocesamiento de preapprovals ajenos (cambiar `status`/`tier` de otro `user_id` a partir de un id conocido) y abusar de la cuota de la API de MP.
**Resultado:** VULNERABLE (impacto acotado por el re-fetch, pero la firma es obligatoria según la guía de MP).
**Fix recomendado:** Validar `x-signature` con HMAC-SHA256 usando el secret del webhook de MP (`MP_WEBHOOK_SECRET`), comparando `ts` + `data.id` antes de procesar. Rechazar con 401 si no valida.
**Esfuerzo estimado:** MEDIO

#### A-SEC-2 | MEDIO | Seguridad | Sin rate limiting en endpoints que generan costo
**Evidencia:** `api/invite.js` (envía email real vía Resend), `api/generate-report.js`, `api/generate-monthly-report.js`, `api/generate-scrum-report.js`, `api/chat-stream.js` (gastan tokens de Anthropic). Ningún throttle (`grep ratelimit` → 0 resultados).
**Descripción:** Un owner autenticado puede invocar `invite` o los endpoints de IA en bucle. Hay gating por tier y una cuota mensual de chat (`project_chat_quota_remaining`), pero no hay límite de frecuencia por minuto.
**Impacto:** DoS económico (factura de LLM/Resend), posible uso de `invite` para enviar correos a terceros (spam) con plantilla de marca.
**Recomendación:** Rate limit por usuario/IP (ej. Upstash Ratelimit o tabla con ventana deslizante) en `invite` y endpoints IA; cap diario por proyecto además del mensual.
**Esfuerzo estimado:** MEDIO

#### A-SEC-3 | BAJO | Seguridad | `assertProjectCanUseIa` falla abierto si la RPC no existe
**Evidencia:** `api/_auth.js:212-230` — ante error `42883` (función inexistente) hace `return` y deja pasar la llamada IA.
**Descripción:** Tolerancia pensada para entornos sin la migración 016, pero "fail-open" en un control de pago: si la RPC se renombra/borra, todos los proyectos obtienen IA gratis.
**Impacto:** Bypass del gating de monetización ante un error de despliegue.
**Recomendación:** En producción, fail-closed (bloquear) y loguear; mantener el fail-open solo si una env `ALLOW_IA_WITHOUT_RPC=true` está activa para dev.
**Esfuerzo estimado:** BAJO

#### Verificaciones OK (sin hallazgo)
- **Secretos:** ninguno versionado; `.gitignore` cubre `.env`/`.env.*`/`.vercel` (`.gitignore:15-31`).
- **Autenticación:** JWT verificado con `jwtVerify` + JWKS remoto, issuer/audience/clockTolerance (`api/_auth.js:107-145`). Robusto, no depende de `auth.sessions`.
- **RLS:** habilitado en todas las tablas con datos de usuario (migración 006 + 012-024). Políticas owner/member coherentes.
- **Headers:** CSP estricta, HSTS preload, `X-Frame-Options: DENY`, `nosniff`, Permissions-Policy (`vercel.json`).
- **CORS:** allowlist explícita, no `*` (`api/_auth.js:37-70`).

### Eje 3 — Pentesting interno (defensivo)

#### A-PEN-1 | MEDIO | Pentesting | Endpoint de webhook invocable sin autenticación (ver A-SEC-1)
**Tipo:** Broken authentication en webhook / IDOR de estado de suscripción
**Superficie:** `POST /api/mp-webhook`
**Evidencia:** `api/mp-webhook.js:101,130` (upsert a `users_premium` con `user_id` derivado de un `data.id` no autenticado).
**Vector (conceptual):** invocar el webhook con identificadores de preapproval/pago ajenos para forzar reprocesamiento de estado sobre cuentas que no son del atacante; no permite auto-upgrade fraudulento (el estado proviene del re-fetch a MP) pero sí manipulación/abuso.
**Resultado:** VULNERABLE (acotado). **Fix:** firma HMAC (A-SEC-1) + idempotencia por `payment_id`/`preapproval_id`.
**Esfuerzo estimado:** MEDIO

#### Superficies revisadas sin hallazgo explotable
- **SQLi:** todo el acceso usa el query builder de supabase-js (parametrizado). Sin concatenación de SQL en JS. Las funciones SQL usan `SECURITY DEFINER` con `SET search_path = public` (mitiga hijacking de search_path).
- **IDOR en recursos de proyecto:** `assertProjectAccess` (`_auth.js:147-201`) + RLS doble capa. `projectId` se castea y valida (`Number.isInteger`).
- **Prompt injection (LLM):** mitigado con delimitadores `<datos_del_proyecto>`/`<contexto>` e instrucciones explícitas de no obedecer texto interno (`generate-report.js:82-84`, `chat-stream.js:48,52`). Defensa razonable.
- **XSS:** el SPA no usa `dangerouslySetInnerHTML`; el único `srcDoc` (`ProductivityPlus.jsx:6968-6973`) corre en `<iframe sandbox="allow-same-origin">` **sin** `allow-scripts`, por lo que el HTML generado por IA no ejecuta JS. Ver A-CONN-3 (nota menor).
- **alg:none / JWT débil:** `jose.jwtVerify` con JWKS rechaza `alg:none`. OK.

### Eje 4 — Conexiones

#### A-CONN-1 | ALTO | Conexión | Llamadas a APIs externas sin timeout
**Conexión afectada:** Mercado Pago, Resend, Anthropic, llamadas internas cron→generate.
**Evidencia:** `api/mp-webhook.js:15-27`, `api/mp-subscribe.js:85`, `api/invite.js:84`, `api/chat-stream.js:208`, `api/cron.js:140,336`, `api/generate-*.js` — todos los `fetch(...)` sin `AbortSignal.timeout`.
**Síntoma:** Si un proveedor responde lento, el `fetch` queda colgado hasta el `maxDuration` de la función (30-60s), agotando el tiempo de ejecución y, en el cron, retrasando el resto del lote.
**Impacto:** Funciones que se cuelgan, costo de cómputo, reportes del cron que no se envían si un proveedor se degrada.
**Recomendación:** Envolver cada `fetch` externo con `AbortSignal.timeout(10000–15000)` y manejar el `AbortError` con un error claro / reintento donde aplique.
**Esfuerzo estimado:** BAJO

#### A-CONN-2 | MEDIO | Conexión | Webhook de MP sin idempotencia explícita
**Conexión afectada:** Mercado Pago (entrante).
**Evidencia:** `api/mp-webhook.js:101,130` — `upsert(onConflict: "user_id")` sin registrar el `event_id`/`payment_id` ya procesado.
**Síntoma:** MP reintenta webhooks; un mismo evento se reprocesa. El upsert por `user_id` lo hace mayormente idempotente para estado, pero un reintento desordenado (payment viejo después de preapproval nuevo) puede pisar `status` con un valor stale.
**Impacto:** Estado de suscripción potencialmente inconsistente bajo reintentos/desorden.
**Recomendación:** Tabla `mp_webhook_events(event_id PK, processed_at)`; ignorar duplicados y aplicar solo si el evento es más reciente que el último aplicado.
**Esfuerzo estimado:** MEDIO

#### A-CONN-3 | BAJO | Conexión | Cliente admin de Supabase instanciado por request
**Evidencia:** `api/mp-webhook.js:65`, `api/mp-subscribe.js:104`, `api/chat-stream.js:177-179`, `api/save-evolution.js`.
**Síntoma:** Se crea un `createClient` con service_role en cada invocación en lugar de reutilizar uno a nivel de módulo.
**Impacto:** Menor (overhead); en runtime edge/serverless el reuso entre invocaciones es limitado de todos modos. Deuda menor.
**Recomendación:** Factorizar un `getAdminClient()` memoizado a nivel de módulo en `_auth.js`.
**Esfuerzo estimado:** BAJO

#### Inventario de conexiones (OK)
| ID | Tipo | Proveedor | Ubicación | Env var | Estado |
|---|---|---|---|---|---|
| C-001 | BD/Auth | Supabase | `_auth.js`, `supabaseClient.js` | SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY | OK |
| C-002 | Pago | Mercado Pago | `mp-subscribe.js`, `mp-webhook.js` | MP_ACCESS_TOKEN | sin firma/idempotencia (A-SEC-1, A-CONN-2) |
| C-003 | Email | Resend | `_email.js`, `invite.js`, `cron.js` | RESEND_API_KEY | OK (sin timeout/rate limit) |
| C-004 | LLM | Anthropic | `chat-stream.js`, `generate-*.js` | ANTHROPIC_API_KEY | OK (sin timeout) |
| C-005 | Cron | Vercel Cron | `vercel.json`, `cron.js` | CRON_SECRET | OK (Bearer protegido) |

### Eje 5 — UX/UI

#### A-UX-1 | BAJO | UX | HTML de IA renderizado sin sanitización previa (contenido aislado)
**Pantalla:** Vista "Evolutivo profesional".
**Evidencia:** `ProductivityPlus.jsx:6968-6973` (`srcDoc={html}` con HTML proveniente de `user_evolutions.html`, generado por el LLM y guardado en `save-evolution.js` sin `sanitize-html`).
**Descripción:** El iframe usa `sandbox="allow-same-origin"` sin `allow-scripts`, por lo que el riesgo de ejecución de JS es nulo en la práctica. Aun así, el HTML de IA se persiste sin sanitizar (a diferencia de los reportes por email, que sí pasan por `sanitizeReportHtml`).
**Criterio violado:** Defensa en profundidad / consistencia de sanitización.
**Recomendación:** Aplicar `sanitize-html` también antes de persistir el evolutivo, por coherencia con el pipeline de email.
**Esfuerzo estimado:** BAJO

> **Nota de alcance del Eje 5:** la evaluación UX completa (jerarquía, accesibilidad WCAG, estados de carga/vacío/error, responsividad) requiere ejecutar la app y está limitada por el monolito de 8.9k líneas. Esta ronda solo cubre lo verificable estáticamente sobre seguridad de render. Recomendado profundizar en una ronda con la app corriendo.

## Notas para el orquestador
- Auditor C (Gemini) no concluyó: el CLI devolvió `IneligibleTierError` (la cuenta individual ya no es elegible; Google migró a la suite Antigravity). Modo degradado para C.
- Auditor A corrió en `claude-opus-4-8` (óptimo).
- No se ejecutó código destructivo ni se enviaron emails/pagos reales. Solo lectura estática.
