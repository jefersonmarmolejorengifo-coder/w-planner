# Referencia De APIs

Las APIs viven en `api/` y se despliegan como funciones de Vercel. Todas las APIs de negocio usan JSON, salvo `/api/generate-report`, que devuelve un stream HTML.

## Helpers Compartidos

### `api/_auth.js`

Responsabilidades:

- Construir clientes Supabase con anon key o service role.
- Leer bearer token.
- Validar sesion con Supabase Auth.
- Validar acceso a proyecto.
- Aplicar CORS restringido.
- Normalizar respuestas de error.

Funciones relevantes:

- `createSupabase(token, { admin })`
- `getAuthenticatedUser(token)`
- `assertProjectAccess(supabase, user, projectId, { ownerOnly })`
- `corsHeaders(origin)`
- `applyCors(req, res)`
- `handleApiError(err, res)`

### `api/_email.js`

Responsabilidades:

- Validar destinatarios.
- Exigir `RESEND_API_KEY` y `REPORT_FROM_EMAIL`.
- Sanitizar defensivamente HTML de reportes.

Funciones relevantes:

- `getResendConfig()`
- `normalizeRecipients(emails)`
- `sanitizeReportHtml(html)`

## Endpoints

## `POST /api/invite`

Envia una invitacion por correo para un proyecto.

Autorizacion:

- Requiere `Authorization: Bearer <supabase_access_token>`.
- Requiere que el usuario autenticado sea owner del proyecto.

Body:

```json
{
  "email": "persona@empresa.com",
  "projectId": 123
}
```

Respuesta exitosa:

```json
{
  "ok": true
}
```

Errores comunes:

- `400`: correo invalido.
- `401`: token ausente o expirado.
- `403`: usuario no es owner del proyecto.
- `500`: error de configuracion o envio.

Dependencias:

- Supabase Auth.
- Tabla `projects`.
- Resend.

## `POST /api/generate-report`

Genera un reporte ejecutivo semanal como HTML compatible con correo.

Autorizacion:

- Flujo manual: requiere `Authorization: Bearer <supabase_access_token>` y owner del proyecto.
- Flujo interno cron: requiere `X-Cron-Secret` igual a `CRON_SECRET`.

Body:

```json
{
  "projectId": 123,
  "weekStart": "2026-05-01",
  "weekEnd": "2026-05-08"
}
```

Respuesta exitosa:

- `Content-Type: text/html; charset=utf-8`
- Stream de HTML generado por Anthropic.

Validaciones:

- `projectId` debe ser entero positivo.
- `weekStart` y `weekEnd` deben tener formato `YYYY-MM-DD`.
- `weekStart` no puede ser posterior a `weekEnd`.

Dependencias:

- Supabase.
- Anthropic Messages API.
- `ANTHROPIC_API_KEY`.

Notas de seguridad:

- El cliente no envia tareas al endpoint.
- El endpoint lee datos server-side por `project_id`.
- El modelo recibe comentarios y entregables del proyecto; esos campos deben considerarse entrada no confiable.

## `POST /api/send-report`

Envia por correo un reporte HTML ya generado.

Autorizacion:

- Requiere `Authorization: Bearer <supabase_access_token>`.
- Requiere owner del proyecto.

Body:

```json
{
  "projectId": 123,
  "emails": ["directivo@empresa.com"],
  "html": "<!DOCTYPE html>...",
  "weekStart": "2026-05-01",
  "weekEnd": "2026-05-08"
}
```

Validaciones:

- Maximo 10 destinatarios.
- Cada destinatario debe tener formato de correo.
- HTML maximo: 300 KB.
- HTML debe iniciar con `<!doctype html`.
- Se bloquean tags/atributos peligrosos como `script`, `iframe`, eventos inline y URLs peligrosas.

Respuesta exitosa:

```json
{
  "ok": true
}
```

Dependencias:

- Supabase Auth.
- Resend.
- `RESEND_API_KEY`.
- `REPORT_FROM_EMAIL`.

## `POST /api/cron`

Ejecuta envio automatico de reportes por proyecto.

Autorizacion:

- Requiere `Authorization: Bearer <CRON_SECRET>`.
- Si `CRON_SECRET` no esta configurado, el endpoint responde `503`.

Body:

- No requiere body.

Flujo:

1. Valida `CRON_SECRET`.
2. Crea cliente Supabase admin con `SUPABASE_SERVICE_ROLE_KEY`.
3. Lee filas de `email_config` con `project_id`.
4. Determina si corresponde envio segun frecuencia, dia y hora.
5. Genera reporte con `/api/generate-report` usando `X-Cron-Secret`.
6. Sanitiza HTML y envia con Resend.
7. Actualiza `last_sent`.

Respuesta ejemplo:

```json
{
  "ok": true,
  "results": [
    {
      "project_id": 123,
      "ok": true,
      "sent_to": 2,
      "range": "2026-05-01 -> 2026-05-08"
    }
  ]
}
```

Dependencias:

- `CRON_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY`.
- `RESEND_API_KEY`.
- `REPORT_FROM_EMAIL`.
- `/api/generate-report`.

## CORS

Los endpoints permiten:

- `POST`
- `OPTIONS`
- Headers `Content-Type`, `Authorization`, `X-Cron-Secret`

Origenes permitidos:

- `APP_BASE_URL`
- `ALLOWED_ORIGINS`
- `VERCEL_URL`
- `https://productivity-plus.vercel.app`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

## Contrato De Errores

Formato general:

```json
{
  "error": "Mensaje legible"
}
```

No se deben exponer secretos, tokens ni stack traces al cliente.
