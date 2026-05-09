# Despliegue

Este proyecto esta preparado para desplegarse en Vercel con Supabase como backend gestionado.

## Ambientes Recomendados

| Ambiente | Uso | Dominio sugerido |
| --- | --- | --- |
| Local | Desarrollo | `http://localhost:5173` |
| Preview | Pull requests / pruebas | Dominio preview de Vercel |
| Production | Usuarios finales | Dominio oficial |

## Requisitos

- Node.js compatible con Vite 8.
- Cuenta Supabase con proyecto creado.
- Proyecto Vercel conectado al repositorio.
- API key de Anthropic.
- Cuenta Resend con dominio verificado.

## Variables En Vercel

Configurar en Project Settings -> Environment Variables.

Cliente:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Servidor:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
RESEND_API_KEY=
REPORT_FROM_EMAIL=
CRON_SECRET=
APP_BASE_URL=
ALLOWED_ORIGINS=
```

Notas:

- `SUPABASE_URL` y `VITE_SUPABASE_URL` normalmente tienen el mismo valor.
- `SUPABASE_ANON_KEY` y `VITE_SUPABASE_ANON_KEY` normalmente tienen el mismo valor.
- `SUPABASE_SERVICE_ROLE_KEY` solo debe existir server-side.
- `REPORT_FROM_EMAIL` debe pertenecer a un dominio verificado en Resend.
- `CRON_SECRET` debe ser largo, aleatorio y unico por ambiente.

## Configuracion De Supabase

1. Crear proyecto en Supabase.
2. Ejecutar migraciones SQL en orden.
3. Confirmar RLS activo.
4. Configurar Auth URLs:

```text
Site URL: APP_BASE_URL
Redirect URLs:
- APP_BASE_URL
- APP_BASE_URL/*
- http://localhost:5173
- http://localhost:5173/*
```

5. Guardar `anon key` y `service role key` en Vercel.

## Configuracion De Vercel

Archivo principal: `vercel.json`.

Incluye:

- Duracion maxima para APIs de reporte y cron.
- Cron cada hora para `/api/cron`.
- Headers de seguridad.

Comando de build:

```bash
npm run build
```

Directorio de salida:

```text
dist
```

## Cron

Vercel ejecuta:

```text
0 * * * * -> /api/cron
```

El endpoint no envia siempre. Primero verifica:

- Que `CRON_SECRET` sea correcto.
- Que exista `email_config` por proyecto.
- Que la hora actual en Colombia coincida con `send_hour`.
- Que la frecuencia y `last_sent` permitan envio.

## Checklist De Despliegue

Antes de publicar:

```bash
npm install
npm run lint
npm run build
npm audit --audit-level=low
```

Verificar:

- Migraciones `000` a `007` aplicadas.
- Variables de Vercel completas.
- Dominio incluido en `APP_BASE_URL`.
- `ALLOWED_ORIGINS` contiene dominios adicionales si aplica.
- Resend tiene dominio verificado.
- Reporte manual funciona.
- Invitacion por correo funciona.
- Cron responde `401` sin token.
- Cron responde distinto de `401` con token correcto.

## Rollback

### Rollback De Aplicacion

En Vercel:

1. Ir a Deployments.
2. Seleccionar deployment anterior estable.
3. Promote to Production.

### Rollback De Base De Datos

No hay down migrations formales. Para cambios de base:

- Hacer backup antes de migraciones.
- Preferir cambios aditivos.
- Evitar `DROP TABLE` o `DROP COLUMN` en produccion sin plan de reversa.
- Si falla una migracion dentro de `BEGIN/COMMIT`, Postgres revierte la transaccion.

## Pruebas Post-Deploy

1. Abrir la app en produccion.
2. Iniciar sesion.
3. Crear o abrir proyecto.
4. Crear tarea.
5. Confirmar realtime en otra ventana.
6. Enviar invitacion.
7. Generar reporte manual.
8. Enviar reporte.
9. Revisar headers de seguridad en respuesta HTTP.

## Problemas Frecuentes

### `Supabase environment variables are missing`

Falta `SUPABASE_URL`, `SUPABASE_ANON_KEY` o `SUPABASE_SERVICE_ROLE_KEY` segun el endpoint.

### `Cron is not configured`

Falta `CRON_SECRET`.

### Error enviando correo

Verificar:

- `RESEND_API_KEY`.
- `REPORT_FROM_EMAIL`.
- Dominio verificado en Resend.
- Destinatarios validos.

### Reporte no genera

Verificar:

- `ANTHROPIC_API_KEY`.
- Permisos owner del proyecto.
- Datos del proyecto.
- Logs de Vercel para `/api/generate-report`.

### CORS

Verificar que el origen este en:

- `APP_BASE_URL`
- `ALLOWED_ORIGINS`
- `VERCEL_URL`
