# Auditoría Gemini — 87cb0d0..HEAD

## Metadatos
- Auditor: Gemini (Google)
- Fecha: 2026-06-27T01:25:47-05:00
- Modelo: Gemini 3.1 Pro (High)
- Proyecto: F:/proyectos/w-planner

## Resumen
El proyecto presenta una base de código funcional utilizando Vite + React en el frontend y funciones serverless de Vercel en el backend. En general, hay una sólida implementación defensiva en cuanto a timeouts (Outbox pattern, fetch timeouts controlados) y validaciones de entrada, pero existen áreas de mejora arquitectónica por la excesiva centralización de responsabilidades en `_auth.js` y componentes UI masivos. A nivel de seguridad y accesibilidad, existen oportunidades para prevenir manipulaciones de URIs y hacer la interfaz compatible con lectores de pantalla.

## Hallazgos

### Eje 1 — Arquitectura

### H-001 | [ALTO] | Arquitectura | Archivo `_auth.js` como cajón de sastre monolítico

**Evidencia:** `api/_auth.js:1-361`

**Descripción:** El archivo `api/_auth.js` contiene no sólo la lógica de autenticación (JWT verify), sino también configuración CORS, clientes de base de datos Supabase, asserts de reglas de negocio, checks de billing (Premium y cuotas IA), validación de parámetros y wrappers de `fetch`. Esto viola el principio de responsabilidad única (SRP).

**Impacto:** Disminuye la mantenibilidad. Cualquier cambio en las utilidades de negocio o de base de datos requiere modificar el archivo principal de autenticación, incrementando el riesgo de introducir bugs de seguridad accidentalmente y generando dependencias cruzadas en todas las funciones serverless.

**Recomendación:** Refactorizar extrayendo las funciones a submódulos dedicados como `lib/db.js`, `lib/billing.js`, `lib/cors.js` y `lib/validation.js`.

**Esfuerzo estimado:** MEDIO

### H-002 | [MEDIO] | Arquitectura | UI monolítica con alta carga de lógica

**Evidencia:** `src/ProductivityPlus.jsx:112-2447`

**Descripción:** Aunque se ha implementado lazy loading y code-splitting para varios paneles, el archivo principal `src/ProductivityPlus.jsx` aún contiene la definición de grandes pantallas (como `AuthScreen`, `UserSelectScreen`, `IntroScreen` y `ProjectLandingScreen`) dentro del mismo archivo.

**Impacto:** Dificulta el onboarding de nuevos desarrolladores, propicia cuellos de botella al hacer merge y disminuye la legibilidad del árbol de componentes en el punto de entrada principal.

**Recomendación:** Extraer `AuthScreen`, `UserSelectScreen`, e `IntroScreen` a sus propios archivos dentro de una carpeta `src/features/auth/` o `src/screens/`.

**Esfuerzo estimado:** BAJO


### Eje 2 — Seguridad

### H-003 | [MEDIO] | Seguridad | Exceso en la permisividad de tamaño de inputs en chat

**Evidencia:** `api/chat-stream.js:122`

**Descripción:** El mensaje del usuario en el endpoint del chat es validado usando `requireString` con un límite máximo constante de `MAX_USER_MESSAGE_CHARS` (8000 caracteres), que es considerablemente alto para mensajes individuales, aunque mitigue DoS directos.

**Impacto:** Un usuario puede inyectar grandes cantidades de texto que aumentan excesivamente el tamaño del prompt, impactando de forma perjudicial en la cuota de tokens y aumentando costos no previstos si la tasa de mensajes por minuto no se bloquea lo suficientemente rápido.

**Recomendación:** Reducir el límite de `MAX_USER_MESSAGE_CHARS` a un valor más lógico para inputs de chat estándar (ej. 1000 - 2000 caracteres) a menos que se requiera adjuntar documentos extensos.

**Esfuerzo estimado:** BAJO


### Eje 3 — Pentesting interno

### H-004 | [MEDIO] | Seguridad/Pentesting | Riesgo de Path Traversal / SSRF manipulado por webhook

**Tipo de vulnerabilidad:** SSRF mitigado / Path Traversal en URL interna
**Superficie:** `api/mp-webhook.js`
**Evidencia:** `api/mp-webhook.js:125` y `api/mp-webhook.js:52`
**Vector intentado (resumido):** El parámetro `data.id` extraído del body/query se concatena directamente a la URL de Mercado Pago en `fetchPreapproval` (`https://api.mercadopago.com/preapproval/${id}`). Un atacante (aunque el request requiere firma HMAC) podría intentar inyectar saltos de directorio como `../v1/payments/xyz` si el secreto HMAC fuera comprometido o en entornos donde no hay secreto.
**Resultado:** REQUIERE INVESTIGACIÓN MANUAL
**Fix recomendado:** Validar y sanear estrictamente que `dataId` sea sólo un número entero positivo o cadena alfanumérica sin barras o caracteres de escape de URL, antes de pasarlo al método fetch.
**Esfuerzo estimado:** BAJO


### Eje 4 — Conexiones

### H-005 | [BAJO] | Conexiones | Ausencia de reintentos automatizados en Supabase

**Conexión afectada:** C-001 Supabase Postgres
**Evidencia:** `api/_auth.js:160-174`
**Síntoma:** El cliente de base de datos se crea con un timeout explícito de 10s (lo cual es muy bueno), pero no se implementa una lógica de `retry` con backoff exponencial.
**Impacto:** Fallos temporales en la resolución DNS del API de Supabase o latencia puntual causarán que la petición serverless lance un HTTP 500 de inmediato, perdiendo llamadas críticas como confirmaciones y validaciones.
**Recomendación:** Envolver las consultas principales de BD, o configurar la política de fetch en `global: { fetch }` para que incorpore al menos 1 o 2 reintentos si el fallo es de red (ej: timeout o error 5xx).
**Esfuerzo estimado:** MEDIO


### Eje 5 — UX/UI

### H-006 | [ALTO] | UX | Modales de reportes bloqueantes y no accesibles por teclado

**Pantalla / componente afectado:** `BoardSummaryPill` (Modal de visualización de reporte)
**Evidencia:** `src/ProductivityPlus.jsx:665-677`
**Descripción:** El componente modal que se abre para previsualizar reportes de IA (`openReport`) se renderiza como una capa superpuesta con `position: fixed` pero no gestiona el foco del teclado, no atrapa la navegación por tabulador dentro del modal ni usa la semántica `<dialog>` o `role="dialog"`.
**Criterio violado:** WCAG 2.1 - 2.1.1 Keyboard (Operable por teclado) y Modal Dialog Pattern.
**Recomendación:** Refactorizar el renderizado a la etiqueta HTML nativa `<dialog>` o implementar enfoque (`focus trap`) de forma explícita al abrir el visor de reporte.
**Esfuerzo estimado:** BAJO

### H-007 | [ALTO] | UX | Formularios sin vinculación semántica (accesibilidad)

**Pantalla / componente afectado:** `AuthScreen`
**Evidencia:** `src/ProductivityPlus.jsx:171-172`
**Descripción:** Los inputs (como el campo de correo electrónico) utilizan una etiqueta visual (`<label>`) pero no implementan el atributo `htmlFor` ni definen un `id` en el campo, rompiendo la vinculación semántica requerida por tecnologías de asistencia.
**Criterio violado:** WCAG 1.3.1 (Info and Relationships) y 3.3.2 (Labels or Instructions).
**Recomendación:** Asignar un identificador único al input `id="email-input"` y ligar la etiqueta como `<label htmlFor="email-input">Correo electrónico</label>`.
**Esfuerzo estimado:** BAJO

## Notas para el orquestador
La revisión se hizo bajo la condición de que el secreto `MP_WEBHOOK_SECRET` sea guardado de forma robusta; el hallazgo SSRF requiere que el atacante firme la petición para escalar. Las APIs son serverless y aprovechan bien las utilidades de streaming y resiliencia para el Outbox pattern, sin problemas críticos de exposición directa detectados.
