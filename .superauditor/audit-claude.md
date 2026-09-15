# Auditoría Claude — 761daf9..f81fac9

## Metadatos
- Auditor: Claude (Anthropic) — Auditor A, orquestador
- Fecha: 2026-09-14
- Modelo: claude-opus-5 (superior a la primera opción de `models.conf`)
- Proyecto: F:/proyectos/w-planner
- Alcance: commit f81fac9 (login por código OTP + plantillas de Supabase Auth). Evidencia adicional: logs de Auth/gateway de producción, dry-run real de la config y prueba de punta a punta en producción.

## Resumen
El cambio ataca la causa raíz correcta, demostrada con logs: Microsoft 365 Safe Links abre el enlace del correo ~20 s después de que llega y gasta el token de un solo uso. El flujo de código (`signInWithOtp` → `verifyOtp({ type: 'email' })`) funciona en producción (probado: código equivocado 403, correcto da sesión, reutilizado 403). El riesgo principal ya no está en el código sino en la operación: la configuración de Auth (plantillas y vigencia) se publica con un paso manual separado del deploy, y hoy está desincronizada de la app desplegada.

## Hallazgos

### Eje 1 — Arquitectura
**[ALTO] Config de Supabase Auth desincronizada de la app desplegada, sin detector de deriva**
- Evidencia: `scripts/apply-auth-email-templates.mjs:133-148` (el dry-run siempre termina con código 0 aunque haya diferencias); dry-run del 2026-09-14 tras el deploy de f81fac9: 13 claves en "CAMBIA".
- Descripción: la pantalla nueva (pide un código) está viva, pero las plantillas publicadas siguen siendo las de fábrica con enlace. La publicación depende de que alguien corra `--apply` después del deploy y nada avisa si no ocurre.
- Impacto: el arreglo no surte efecto hasta publicar; mientras tanto la UI pide un código que el correo no trae y los usuarios corporativos siguen bloqueados.
- Recomendación: publicar ya; añadir `--check` (sale ≠0 si hay deriva) y correrlo en CI o en el cron diario; documentar el orden deploy → apply.
- Esfuerzo: BAJO.

**[MEDIO] Sin pruebas de comportamiento de AuthScreen**
- Evidencia: `src/lib/otp.test.js` (helpers + guarda estática del texto fuente); `package.json` sin jsdom ni testing-library.
- Descripción: autoenvío, candados contra doble envío, enfriamiento y foco tras error se verificaron por lectura y capturas, no con pruebas.
- Recomendación: vitest + jsdom + @testing-library/react para el flujo de 2 pasos.
- Esfuerzo: MEDIO.

**[BAJO] URLs de la app fijas en las plantillas**
- Evidencia: `scripts/auth-email/templates.js:58-59`.
- Descripción: decisión deliberada (no depender de `{{ .SiteURL }}`, que llegó a ser localhost), pero impide publicar las plantillas en un proyecto de staging apuntando a otro dominio.
- Recomendación: override opcional por variable de entorno con el valor actual como predeterminado.
- Esfuerzo: BAJO.

### Eje 2 — Seguridad
**[MEDIO] Sin CAPTCHA en el envío de códigos con alta abierta y presupuesto global de correos**
- Evidencia: `src/screens/AuthScreen.jsx:64-66` (`shouldCreateUser: true`); config de Auth: `security_captcha_enabled=false`, `rate_limit_email_sent=30` por hora a nivel de proyecto.
- Descripción: cualquiera puede pedir códigos para direcciones inventadas, crear cuentas basura y agotar el presupuesto de 30 correos/hora, bloqueando el login de TODOS durante esa hora. Preexistente con el link mágico, pero ahora el código es la única puerta.
- Recomendación: Turnstile/hCaptcha en Supabase Auth + `captchaToken` en `signInWithOtp`; subir `rate_limit_email_sent` según el plan de Resend.
- Esfuerzo: MEDIO.

**[OK] Fuerza bruta, filtraciones e inyección**
- 10⁸ combinaciones, vigencia 15 min, `/verify` limitado a 30 peticiones cada 5 min POR IP (documentación oficial de rate limits) → ~9×10⁻⁷ de acierto por IP y por código.
- Ninguna plantilla de código lleva enlace con token (guarda `findTokenLinks` que distingue contra la plantilla real que falló); `{{ .Email }}` lo escapa `html/template`; la UI nunca muestra el mensaje crudo de auth-js; el script no imprime el token; el código no va en el preheader.

### Eje 3 — Pentesting interno
**[OK] Verificación probada en producción**
- Código generado con la llave de servicio (sin enviar correo) y verificado con el mismo `verifyOtp({ type: 'email' })` de la app: equivocado → 403 `otp_expired`; correcto → sesión; reutilizado → 403. Sesión de prueba cerrada con `scope: 'local'`.
- Sin open redirect: se eliminó `emailRedirectTo`; Supabase usa el Site URL de la lista permitida.

### Eje 4 — Conexiones
**[MEDIO] El login depende de un presupuesto de correo global y el mensaje de error lo oculta**
- Evidencia: config `rate_limit_email_sent=30`; `src/lib/otp.js` (`authErrorMessage`, caso `over_email_send_rate_limit`).
- Descripción: Supabase devuelve el mismo `over_email_send_rate_limit` por la espera de 60 s por usuario y por el tope global; la UI dice "espera un minuto", engañoso si el tope global se agotó. Con crecimiento (más de 30 accesos en una hora pico) el login falla para los siguientes.
- Recomendación: subir el tope acorde al plan de Resend, monitorear los 429 en los logs de Auth y matizar el mensaje.
- Esfuerzo: BAJO.

### Eje 5 — UX/UI
**[BAJO] Outlook de escritorio muestra el correo a todo el ancho**
- Evidencia: `scripts/auth-email/templates.js:282` (`layout`); `html/template` de Go borra los comentarios condicionales MSO.
- Recomendación: aceptar la limitación o validar una alternativa sin comentarios en un Outlook real.
- Esfuerzo: BAJO.

**[BAJO] Correos propios de la app con la identidad anterior**
- Evidencia: `api/invite.js:49-86`, `api/open-retro.js` (`buildEmailHtml`).
- Descripción: invitaciones y retros llegan con otro look el mismo día que los correos de acceso nuevos.
- Recomendación: layout compartido (en curso en el siguiente commit).
- Esfuerzo: BAJO.

**[BAJO] Un enlace viejo que ya no sirve vuelve al login sin explicación**
- Evidencia: `src/ProductivityPlus.jsx:501-512` (`init` no mira el `#error_code` que deja Supabase en la URL).
- Descripción: quien abra un correo antiguo con enlace verá la pantalla de acceso sin saber por qué.
- Recomendación: si la URL trae `error_code=otp_expired`, mostrar "Ese enlace ya no sirve: ahora entras con un código".
- Esfuerzo: BAJO.

## Notas para el orquestador
Validado además por tres revisores especializados antes del merge (seguridad: aprobado con condiciones, resueltas; testing: apto con 3 sabotajes que fallaron donde debían; UI/UX: ajustes de contraste AA aplicados).
