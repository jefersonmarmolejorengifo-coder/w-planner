# ESTADO — Productivity-Plus (w-planner)

> Resumen corto del último bloque de trabajo y de lo que falta. Lo mantiene el líder de sesión al cerrar.

**Última actualización:** 2026-09-15

## Qué se hizo (2026-09-14/15)

- **Login por código en vez de link mágico** (`f81fac9`). Causa raíz demostrada con logs: Microsoft 365 Safe Links abría el enlace ~20 s después de llegar el correo y gastaba el token de un solo uso; los usuarios con correo corporativo nunca podían entrar.
- **Plantillas de correo de Supabase Auth con la marca** (6) en `scripts/auth-email/templates.js`, publicadas con `scripts/apply-auth-email-templates.mjs` (14/14 claves verificadas) y probadas con un correo real a la cuenta corporativa: ningún acceso del escáner.
- **Correos propios de la app** (invitación, retro) con la misma identidad sobre `api/_email-brand.js` (`4b7a18f`).
- **Plan Pro Team sin cobro** para `jdmarmolejo@ingeniopichichi.com` (cuenta de Jefer) con `admin_set_user_plan`: activo, sin suscripción ni vencimiento; verificado como lo ve la app.
- **Detector de deriva de plantillas** (H-056, H-058): `--check` sale 1 si producción difiere, `--apply` exige `SUPABASE_PROJECT_REF` explícito, y `scripts/auth-email/published.json` + test de huella en el CI.
- **Aviso de enlace viejo** (H-065) y mensaje honesto cuando se agota el tope de correos (H-062).
- **CAPTCHA (Cloudflare Turnstile) integrado en la pantalla de acceso, inactivo hasta tener clave** (H-054). Si Turnstile no carga, la persona ve qué pasa, puede reintentar y, al segundo fallo, tiene el contacto info@softatumedida.com. CSP ampliada solo a `challenges.cloudflare.com`. Activación de servidor lista en `scripts/enable-auth-captcha.mjs` (con reversión `--disable`). Revisado por seguridad: aprobado; su condición (salida clara ante fallos) está cumplida.
- **Pruebas de componente del login** (jsdom + Testing Library, H-053), incluidas las rutas de CAPTCHA y de fallo, con sabotajes que fallan donde deben.
- **Revisión del mismo bug en otros proyectos** (solo lectura, logs de 24 h sin tráfico de acceso en ninguno): Cuadre y VoxLab expuestos (canjean el `token_hash` en el GET), TuAgendaApp (enlace puro), Triada (sin acceso por API); el Hub manda código + enlace de respaldo (el enlace anula el código); hirly ya usa código; Academia aún no está en producción.

## Qué falta

| Pendiente | Depende de | Prioridad |
|---|---|---|
| Crear el widget de Turnstile "Productivity-Plus login" (hostnames `productivityplus.softatumedida.com` y `w-planner.vercel.app`, modo Managed) y guardar `VITE_TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` en `.env.local` | Jefer (el token de Cloudflare disponible es solo de DNS; Academia usa un widget por dominio) | Alta |
| Con las claves: variable en Vercel + redeploy + comprobar el widget en producción + `enable-auth-captcha --enable` (CAPTCHA on + tope 30→100/h) y vigilar `captcha_failed` 48 h | Lo anterior | Alta |
| Prueba final: entrar con jdmarmolejo@ingeniopichichi.com (código + CAPTCHA + plan Pro Team) | Lo anterior | Alta |
| Arreglar el bug de enlaces: Cuadre y VoxLab → TuAgendaApp → Hub (quitar el enlace de respaldo) → hirly (`email_change`) → Triada | Decisión de Jefer (repos aparte; el Hub cruza la frontera de afiliados) | Alta en los que tengan usuarios corporativos |
| Reautorizar el conector de Gmail en claude.ai | Jefer | Baja |
| Outlook de escritorio muestra los correos a todo el ancho (Supabase borra los comentarios MSO) | — | Baja, aceptado |

Detalle de hallazgos y prioridades: `AUDIT_PLAN.md` (ronda 2026-09-14).
