# Operacion Y Mantenimiento

Este documento sirve como guia de soporte para operar Productivity-Plus en local, preview y produccion.

## Comandos Frecuentes

Instalacion:

```bash
npm install
```

Desarrollo:

```bash
npm run dev
```

Validacion:

```bash
npm run lint
npm run build
npm audit --audit-level=low
```

Preview local de build:

```bash
npm run preview
```

Windows PowerShell:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd audit --audit-level=low
```

## Revision De Salud

Checklist rapido:

- App responde en navegador.
- Login funciona.
- Proyecto carga sin errores.
- Tareas se crean y actualizan.
- Realtime funciona entre dos ventanas.
- Invitaciones se envian.
- Reportes manuales se generan.
- `npm audit` sigue sin vulnerabilidades.
- Logs de Vercel no muestran errores recurrentes.

## Monitoreo Manual

### Vercel

Revisar:

- Build logs.
- Function logs.
- Cron invocations.
- Errores 4xx/5xx.
- Duracion de `/api/generate-report` y `/api/cron`.

### Supabase

Revisar:

- Auth logs.
- Database logs.
- Realtime status.
- Uso de conexiones.
- Politicas RLS.

### Resend

Revisar:

- Email delivery.
- Bounces.
- Domain status.
- API errors.

### Anthropic

Revisar:

- Errores de API.
- Rate limits.
- Costos.
- Latencia.

## Operacion De Reportes

### Reporte Manual

Flujo esperado:

1. Owner abre configuracion.
2. Configura destinatarios.
3. Genera reporte.
4. Envia reporte.
5. `email_config.last_sent` se actualiza.

Si falla:

- Verificar que el usuario sea owner.
- Verificar `ANTHROPIC_API_KEY`.
- Verificar `RESEND_API_KEY`.
- Verificar `REPORT_FROM_EMAIL`.
- Revisar logs de `/api/generate-report` y `/api/send-report`.

### Reporte Automatico

El cron corre cada hora, pero solo envia si `shouldSendToday()` retorna true.

Campos que controlan el envio:

- `frequency`
- `send_day`
- `send_hour`
- `days_back`
- `days_forward`
- `last_sent`

Si no envia:

- Confirmar `CRON_SECRET`.
- Confirmar que Vercel Cron este activo.
- Confirmar hora Colombia vs `send_hour`.
- Confirmar `last_sent`.
- Confirmar que `email_config.emails` no este vacio.

## Mantenimiento De Dependencias

Revisar periodicamente:

```bash
npm outdated --depth=0
npm audit --audit-level=low
```

Actualizar con cuidado:

```bash
npm update
npm run lint
npm run build
npm audit --audit-level=low
```

Para major versions, crear rama separada y probar manualmente.

## Mantenimiento De Base De Datos

Antes de una migracion:

- Leer el SQL completo.
- Confirmar que esta en orden.
- Hacer backup si el cambio no es puramente aditivo.
- Probar en preview/staging cuando exista.

Despues de una migracion:

- Confirmar que no hubo error.
- Verificar RLS.
- Probar login y carga de proyecto.
- Probar creacion/actualizacion de tareas.

## Solucion De Problemas

### La app no carga proyectos

Posibles causas:

- Sesion expirada.
- RLS no aplicado correctamente.
- Usuario no tiene fila en `project_members`.
- `localStorage` apunta a un proyecto no accesible.

Acciones:

- Cerrar sesion e iniciar de nuevo.
- Revisar `project_members`.
- Confirmar `owner_id` en `projects`.
- Revisar logs del navegador.

### No se puede unir por codigo

Posibles causas:

- Codigo incorrecto.
- RPC `join_project_by_invite_code` sin permisos.
- Usuario no autenticado.

Acciones:

- Confirmar `invite_code` en `projects`.
- Confirmar migracion `007`.
- Revisar errores de Supabase.

### Error en `claim_task_id`

Posibles causas:

- Migracion 006 no aplicada.
- Permisos RPC incorrectos.
- `app_config.nextId` tiene valor no numerico.

Acciones:

```sql
select * from app_config where key = 'nextId';
```

Confirmar que `value` sea numerico.

### Error de CORS

Posibles causas:

- Dominio no incluido en `APP_BASE_URL` o `ALLOWED_ORIGINS`.
- Preview URL de Vercel no esperada.

Acciones:

- Agregar dominio a `ALLOWED_ORIGINS`.
- Redesplegar.

### Error de correo

Posibles causas:

- `RESEND_API_KEY` faltante o invalida.
- `REPORT_FROM_EMAIL` no verificado.
- Destinatario invalido.
- HTML bloqueado por sanitizacion.

Acciones:

- Revisar logs de Vercel.
- Revisar dashboard de Resend.
- Confirmar que el reporte inicia con `<!DOCTYPE html>`.

## Plantillas De Correo De Supabase Auth

Supabase Auth envia 6 tipos de correo (magic_link, confirmation, recovery,
invite, reauthentication, email_change). Por defecto son las de fabrica, en
ingles y sin diseno. Productivity-Plus publica las propias desde
`scripts/auth-email/templates.js` (fuente unica: HTML + asunto por clave)
usando `scripts/apply-auth-email-templates.mjs` contra la Management API de
Supabase (`GET`/`PATCH /v1/projects/{ref}/config/auth`).

Por que codigo y no enlace:

Los filtros de correo corporativos (Microsoft 365 Safe Links y similares)
abren cualquier enlace del correo ANTES que la persona destinataria, y con
eso gastan el token de un solo uso: la persona hace clic despues y ve
"el enlace ya no es valido". Por eso 5 de las 6 plantillas (todas menos
`email_change`) llevan un codigo de 8 digitos (`{{ .Token }}`, ver
`src/lib/otp.js`) que la persona escribe a mano en la app, y ningun enlace
con token. `email_change` es la unica excepcion porque Supabase no emite un
codigo de verificacion para ese flujo.

Comandos:

```bash
# Vista previa en HTML de las 6 plantillas (sin red, no requiere token)
node scripts/apply-auth-email-templates.mjs --preview=./tmp-preview

# Dry-run: compara lo publicado contra lo nuevo, no cambia nada (requiere
# SUPABASE_ACCESS_TOKEN; SUPABASE_PROJECT_REF es opcional aqui, cae al
# proyecto de Productivity-Plus por defecto)
node scripts/apply-auth-email-templates.mjs

# --check: solo lectura, compara las 14 claves contra lo publicado y sale
# con codigo 1 si algo difiere (imprime cuales). Util para un cron de
# guardia o para confirmar antes de tocar nada.
node scripts/apply-auth-email-templates.mjs --check

# Publica y verifica clave por clave (usar solo en el momento del deploy).
# SUPABASE_PROJECT_REF es OBLIGATORIO y explicito aqui — sin valor por
# defecto — para no publicar por accidente en el proyecto equivocado.
SUPABASE_PROJECT_REF=pkccbrzsvcipkmnllxhz node scripts/apply-auth-email-templates.mjs --apply
```

### Orden obligatorio en cada deploy que toque estas plantillas

El 2026-09-14 la app se desplego con la pantalla de codigo nueva pero las
plantillas de correo quedaron sin publicar un rato, y nada lo avisaba
(H-056). Por eso el orden es fijo:

1. Desplegar el codigo de la app (Vercel).
2. Publicar las plantillas: `SUPABASE_PROJECT_REF=pkccbrzsvcipkmnllxhz node scripts/apply-auth-email-templates.mjs --apply`.
   Si el PATCH se verifica clave por clave, el script escribe
   `scripts/auth-email/published.json` (huella sha256 + ref + fecha) —
   **commitear ese archivo** en el mismo cambio.
3. Confirmar con `node scripts/apply-auth-email-templates.mjs --check`
   (exit 0 = las 14 claves coinciden).

Antes de publicar: correr `npx vitest run scripts/auth-email` (guardas de
regresion: ninguna plantilla de codigo lleva un enlace con token, ninguna
menciona proveedores externos, ninguna deja comentarios HTML muertos —
Supabase procesa las plantillas con `html/template` de Go y los borra al
enviarlas).

### Si falla el test de huella (`published.test.js`)

Ese test compara `patchFingerprint()` (huella del codigo actual de
`templates.js`) contra `scripts/auth-email/published.json` (lo ultimo que
`--apply` publico de verdad). Si falla en CI significa que alguien edito una
plantilla y no volvio a publicar:

1. Correr `SUPABASE_PROJECT_REF=pkccbrzsvcipkmnllxhz node scripts/apply-auth-email-templates.mjs --apply`.
2. Commitear el `published.json` actualizado junto con el cambio de plantilla.
3. Confirmar con `--check` (exit 0) y con `npx vitest run scripts/auth-email`.

Nunca "arreglar" el test editando `published.json` a mano con una huella que
no viene de un `--apply` real verificado: eso deja el repo diciendo que algo
esta publicado cuando no lo esta.

### Como revertir

Si una plantilla publicada resulta problematica (ej. un correo mal
renderizado en produccion):

1. Revertir el commit que cambio `scripts/auth-email/templates.js` (o editar
   el contenido de vuelta al estado anterior).
2. Publicar la version revertida con `--apply` (mismo comando de arriba);
   esto sobrescribe `published.json` con la huella de la version revertida.
3. Confirmar con `--check` que la version en produccion volvio a coincidir.

No existe una operacion de "deshacer" en la Management API: revertir siempre
es publicar de nuevo el contenido anterior con `--apply`.

## Backups Y Recuperacion

Recomendaciones:

- Activar backups automaticos en Supabase.
- Antes de cambios grandes, crear snapshot.
- Exportar datos criticos antes de migraciones no reversibles.
- Documentar cada cambio de esquema.

## Criterios Para Release

Un release debe cumplir:

- `npm run lint` pasa.
- `npm run build` pasa.
- `npm audit --audit-level=low` sin vulnerabilidades.
- Migraciones aplicadas en ambiente correspondiente.
- Variables de entorno completas.
- Prueba manual de login, proyecto, tarea y reporte.
- No hay secretos en Git.

## Deuda Operativa

- Agregar tests automatizados.
- Agregar monitoreo formal de errores.
- Agregar alertas de cron fallido.
- Agregar smoke tests post-deploy.
- Separar frontend por modulos para reducir riesgo de cambio.
