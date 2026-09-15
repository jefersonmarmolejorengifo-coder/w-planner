```markdown
# Auditoría Codex — 761daf9..f81fac9

## Metadatos
- Auditor: Codex (OpenAI)
- Fecha: 2026-09-14T21:02:14-05:00
- Modelo: GPT-5 Codex
- Proyecto: F:/proyectos/w-planner

## Resumen
El rango auditado introduce el cambio de magic link a OTP por correo, plantillas de Supabase Auth y un script para publicarlas por Management API. La intención está bien acotada, pero la configuración de Auth queda dividida entre código, script remoto y `supabase/config.toml`, con valores incompatibles. No encontré secretos reales versionados ni exposición directa de los tokens OTP en las plantillas de código. El mayor riesgo operativo es aplicar configuración al proyecto Supabase equivocado o tener entornos donde el login local/staging no coincide con la UI.

## Hallazgos

### Eje 1 — Arquitectura

### H-001 | [MEDIO] | Arquitectura | Flujo OTP sin pruebas de componente

**Evidencia:** `src/screens/AuthScreen.jsx:55`, `src/screens/AuthScreen.jsx:92`, `src/screens/AuthScreen.jsx:129`, `src/lib/otp.test.js:143`

**Descripción:** El commit agrega lógica asíncrona de UI para enviar código, verificarlo, reenviarlo, bloquear dobles envíos y cambiar de paso, pero las pruebas nuevas cubren helpers puros y una guarda textual sobre `verifyOtp`. No hay prueba de componente que valide estados reales de `AuthScreen`.

**Impacto:** Regresiones en el flujo principal de login pueden pasar aunque los tests sigan verdes: doble submit, cooldown, foco tras error, autoverificación al pegar y mensajes por fase.

**Recomendación:** Agregar tests de componente con Supabase mockeado para: envío feliz, error de envío, código incompleto, verificación feliz, verificación fallida, doble clic/doble Enter y reenviar con cooldown.

**Esfuerzo estimado:** MEDIO

### Eje 2 — Seguridad

Sin hallazgos relevantes en esta ronda.

### Eje 3 — Pentesting interno

### H-002 | [MEDIO] | Seguridad/Pentesting | Límite de intentos OTP no queda verificable para producción

**Tipo de vulnerabilidad:** Brute force de OTP / rate limiting de autenticación

**Superficie:** Flujo público de login por código en Supabase Auth, invocado desde `AuthScreen`

**Evidencia:** `src/screens/AuthScreen.jsx:96`, `src/screens/AuthScreen.jsx:101`, `src/lib/otp.js:77`, `scripts/auth-email/templates.js:399`

**Vector intentado (resumido):** El cliente permite intentar verificaciones de códigos de 8 dígitos y, tras error, limpia el campo y permite otro intento. El repo versiona longitud y expiración del OTP, pero no deja una garantía equivalente de límite de intentos de verificación en la configuración que se publica a Supabase.

**Resultado:** REQUIERE INVESTIGACIÓN MANUAL

**Fix recomendado:** Declarar y verificar explícitamente los límites de Supabase Auth para verificación OTP en el runbook/script de despliegue, y considerar CAPTCHA o endurecimiento adicional si el endpoint público recibe abuso.

**Esfuerzo estimado:** BAJO

### Eje 4 — Conexiones

### H-003 | [ALTO] | Conexión | Configuración local de Supabase Auth contradice el OTP de la app

**Conexión afectada:** C-001 Supabase Auth

**Evidencia:** `src/lib/otp.js:15`, `src/lib/otp.js:18`, `scripts/auth-email/templates.js:399`, `scripts/auth-email/templates.js:400`, `supabase/config.toml:232`, `supabase/config.toml:234`

**Síntoma:** La app exige OTP de 8 dígitos y las plantillas publican expiración de 15 minutos, pero `supabase/config.toml` conserva `otp_length = 6` y `otp_expiry = 3600`.

**Impacto:** En Supabase local o cualquier entorno derivado de `config.toml`, el usuario recibe un código/configuración que no coincide con la pantalla de login; el login puede quedar bloqueado o validar con tiempos distintos a los que informa la UI.

**Recomendación:** Sincronizar `supabase/config.toml` con `OTP_LENGTH` y `OTP_TTL_MINUTES`, o documentar que el flujo OTP solo es válido contra la config publicada por Management API y agregar una verificación pre-release que compare ambos.

**Esfuerzo estimado:** BAJO

### H-004 | [MEDIO] | Conexión | Script de publicación apunta a producción por defecto

**Conexión afectada:** C-002 Supabase Management API

**Evidencia:** `scripts/apply-auth-email-templates.mjs:15`, `scripts/apply-auth-email-templates.mjs:24`, `scripts/apply-auth-email-templates.mjs:180`, `scripts/apply-auth-email-templates.mjs:193`, `docs/operations.md:273`

**Síntoma:** `SUPABASE_PROJECT_REF` es opcional y, si falta, el script usa un project ref hardcodeado. El mismo script ejecuta `PATCH /config/auth` cuando se invoca con `--apply`.

**Impacto:** Un operador con token válido puede modificar la configuración Auth de producción por accidente al omitir una variable. En sentido inverso, un entorno staging puede terminar usando plantillas/URLs productivas.

**Recomendación:** Exigir `SUPABASE_PROJECT_REF` siempre para `--apply`, eliminar el default productivo o requerir confirmación explícita del nombre/ref antes del PATCH.

**Esfuerzo estimado:** BAJO

### Eje 5 — UX/UI

### H-005 | [MEDIO] | UX | Pantalla OTP puede recortarse en móviles bajos

**Pantalla / componente afectado:** Login por código, `AuthScreen`

**Evidencia:** `src/screens/AuthScreen.jsx:143`, `src/screens/AuthScreen.jsx:151`, `src/screens/AuthScreen.jsx:153`, `src/screens/AuthScreen.jsx:189`

**Descripción:** El contenedor es `position: fixed` con centrado vertical y no declara `overflowY: auto`. El paso de código agrega más contenido que el flujo anterior: logo, tarjeta, texto, input, error/notice, submit y dos acciones secundarias.

**Criterio violado:** Responsividad / tarea principal accesible en móvil pequeño.

**Recomendación:** Permitir scroll vertical en el overlay (`overflowY: auto`), alinear arriba en pantallas bajas o reducir espaciados con media query por altura.

**Esfuerzo estimado:** BAJO

### H-006 | [MEDIO] | UX | El input elimina el indicador visible de foco

**Pantalla / componente afectado:** Login por correo y código, `AuthScreen`

**Evidencia:** `src/screens/AuthScreen.jsx:41`, `src/screens/AuthScreen.jsx:166`, `src/screens/AuthScreen.jsx:210`

**Descripción:** El estilo compartido de inputs define `outline: "none"` y los inputs nuevos lo heredan sin un reemplazo `:focus`/`boxShadow` accesible.

**Criterio violado:** WCAG 2.4.7 — foco visible.

**Recomendación:** Reemplazar `outline: none` por un foco visible consistente, por ejemplo borde/acento y halo con suficiente contraste.

**Esfuerzo estimado:** BAJO

## Notas para el orquestador
- Leí las guías solicitadas en `C:/Users/jefer/.claude/skills/superauditor/references/*`.
- El worktree cambió durante la auditoría; las líneas del reporte están ancladas al árbol de `f81fac9`, no a cambios no commiteados posteriores.
- `git diff --check 761daf9..f81fac9` terminó sin errores.
- Intenté correr Vitest: `npm` fue bloqueado por ExecutionPolicy; con `npm.cmd` Vitest falló por sandbox de solo lectura al crear temporales. No hubo ejecución verde de tests.
- No llamé a Supabase ni a APIs externas; el eje de pentesting se mantuvo estático/defensivo sobre el código del proyecto.
```