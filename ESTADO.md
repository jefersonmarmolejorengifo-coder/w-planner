# ESTADO — Productivity-Plus (w-planner)

> Resumen corto del último bloque de trabajo y de lo que falta. Lo mantiene el líder de sesión al cerrar.

**Última actualización:** 2026-09-14

## Qué se hizo (2026-09-14)

- **Login por código en vez de link mágico** (commit `f81fac9`, desplegado). Causa raíz demostrada con logs: Microsoft 365 Safe Links abría el enlace ~20 s después de que llegaba el correo y gastaba el token de un solo uso, así que los usuarios con correo corporativo nunca podían entrar. Ahora el correo trae un código de 8 dígitos que se escribe en la app.
- **Plantillas de correo de Supabase Auth con la marca** (6: acceso, bienvenida, recuperación, invitación, reautenticación, cambio de correo) en `scripts/auth-email/templates.js`, con un script para publicarlas (`scripts/apply-auth-email-templates.mjs`). Procedimiento en `docs/operations.md`.
- Revisiones antes del merge: seguridad (aprobado con condiciones, resueltas), testing (apto), UI/UX (contraste AA aplicado). Superauditor triple sobre el commit.
- Verificación en producción: código equivocado se rechaza, el correcto da sesión, reutilizarlo se rechaza.
- **Correos propios de la app con la misma identidad** (invitación a proyecto y apertura de retro) sobre una capa compartida `api/_email-brand.js`; el patch de Supabase quedó idéntico byte a byte.
- Cierre de 5 hallazgos de la auditoría triple: cuenta regresiva robusta a pestaña en segundo plano, scroll del login en pantallas bajas, anillo de foco en los botones principales, `supabase/config.toml` alineado (8 dígitos / 15 min) y correos de la app.
- **Plantillas publicadas en Supabase** con autorización de Jefer (14/14 claves verificadas) y correo real con código enviado a la cuenta corporativa: en los logs no hubo ningún acceso del escáner de Microsoft.
- **Plan Pro Team sin cobro** para `jdmarmolejo@ingeniopichichi.com` (cuenta de Jefer) con la función oficial `admin_set_user_plan`: activo, sin suscripción de Mercado Pago ni vencimiento. Verificado como lo ve la app (`user_ia_capacity`: Pro Team, 5 proyectos IA / 9 en total).

## Qué falta

| Pendiente | Depende de | Prioridad |
|---|---|---|
| Entrar con el código que llegó a jdmarmolejo@ingeniopichichi.com y confirmar el plan Pro Team en la app | Jefer | Alta |
| Exigir `SUPABASE_PROJECT_REF` explícito en `--apply` y un modo `--check` que falle si hay deriva (H-056, H-058) | — | Media |
| Aviso cuando alguien abre un enlace viejo que ya no sirve (H-065) | — | Baja |
| CAPTCHA en el envío de códigos + subir `rate_limit_email_sent` (hoy 30/h para todo el proyecto) | Decisión de Jefer (Turnstile o hCaptcha) | Media |
| Pruebas de UI con jsdom + testing-library para el login | — | Media |
| Revisar el mismo bug de enlaces en Academia, TuAgendaApp y Triada (solo enlace) y cuadre, hirly, panel, VoxLab (mixtos) | Decisión de Jefer | Alta para quien tenga usuarios corporativos |

Detalle de hallazgos y prioridades: `AUDIT_PLAN.md` (ronda 2026-09-14).
