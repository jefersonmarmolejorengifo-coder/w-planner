# Seguridad

Este documento describe la postura de seguridad actual, controles implementados, riesgos residuales y checklist de produccion.

## Resumen Ejecutivo

Productivity-Plus usa una arquitectura de defensa por capas:

- Identidad con Supabase Auth.
- Aislamiento multi-tenant con RLS por `project_id`.
- Validacion de owner/member en APIs server-side.
- CORS restringido.
- Headers de seguridad en Vercel.
- Secretos server-side obligatorios.
- Sanitizacion defensiva de HTML generado por IA.
- Auditoria de dependencias con `npm audit`.

Con las migraciones `006` y `007` aplicadas, el proyecto tiene una base solida. Los riesgos principales restantes son RBAC granular, auditoria server-side y pruebas automatizadas de seguridad.

## Fronteras De Confianza

| Capa | Nivel de confianza | Comentario |
| --- | --- | --- |
| Navegador | No confiable | Puede manipular localStorage, payloads y estado cliente. |
| Supabase anon key | Publica | Debe depender de RLS, no de secreto. |
| Vercel Functions | Confiable si variables estan protegidas | Maneja secretos y valida permisos. |
| Supabase service role | Alta sensibilidad | Solo backend/cron. Nunca cliente. |
| Anthropic/Resend | Externo | Enviar solo datos necesarios y validar respuestas. |

## Controles Implementados

### Autenticacion

- El cliente usa Supabase Auth.
- APIs sensibles leen `Authorization: Bearer <access_token>`.
- `getAuthenticatedUser()` valida el token contra Supabase.

### Autorizacion

- `assertProjectAccess()` valida owner/member desde servidor.
- Acciones de reporte, correo e invitacion requieren owner.
- RLS valida acceso por `project_id`.

### Multi-Tenant

- Las tablas de negocio usan `project_id`.
- Realtime se suscribe con filtro por proyecto.
- Reportes leen datos server-side por `project_id`.
- El cron procesa `email_config` por proyecto.

### CORS

Los origenes se limitan a:

- `APP_BASE_URL`
- `ALLOWED_ORIGINS`
- `VERCEL_URL`
- origen default de produccion
- localhost de desarrollo

### Headers De Seguridad

Configurados en `vercel.json` y `vercel.deploy.json`:

- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Frame-Options`

### Secretos

Variables server-side requeridas:

- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `REPORT_FROM_EMAIL`
- `CRON_SECRET`

El backend falla de forma cerrada si faltan secretos criticos.

### Reportes HTML

`api/_email.js` valida HTML generado antes de enviarlo por correo:

- Tamano maximo 300 KB.
- Debe iniciar con `<!doctype html`.
- Bloquea tags peligrosos.
- Bloquea event handlers inline.
- Bloquea URLs `javascript:`, `data:` y `vbscript:`.
- Bloquea `url(...)` en CSS.

Esta es una defensa razonable, pero no reemplaza una sanitizacion HTML robusta basada en allowlist formal.

## Riesgos Residuales

### RBAC Granular

Estado actual:

- Owner administra configuracion, invitaciones y reportes.
- Miembros pueden operar tareas, OKRs, sprints, historial y notificaciones.

Riesgo:

- No existen roles diferenciados como viewer/editor/admin.

Recomendacion:

- Agregar columnas `role` en `project_members`.
- Implementar funciones `can_read_project`, `can_write_tasks`, `can_admin_project`.
- Ajustar RLS por accion.

### Auditoria Server-Side

Estado actual:

- `task_history.changed_by` se escribe desde el cliente usando nombre del participante.

Riesgo:

- El cliente puede manipular identidad visible.

Recomendacion:

- Guardar `changed_by_user_id = auth.uid()`.
- Agregar triggers o RPCs server-side para historial.

### Prompt Injection En Reportes

Estado actual:

- Comentarios y entregables de tareas se envian al modelo.

Riesgo:

- Un usuario podria insertar texto que intente manipular el reporte.

Recomendacion:

- Agregar delimitadores explicitos de datos no confiables en el prompt.
- Sanitizar salida con libreria especializada.
- Considerar renderizar plantilla propia y usar IA solo para narrativa.

### Bundle Monolitico

Estado actual:

- `src/ProductivityPlus.jsx` concentra gran parte del sistema.

Riesgo:

- Cambios futuros tienen mayor probabilidad de regresion.

Recomendacion:

- Separar por features y agregar pruebas.

## Checklist De Produccion

Antes de desplegar:

- Aplicar migraciones `000` a `007`.
- Confirmar RLS activo en tablas de negocio.
- Confirmar RPCs sin permisos anonimos.
- Configurar `SUPABASE_SERVICE_ROLE_KEY`.
- Configurar `CRON_SECRET` fuerte y aleatorio.
- Configurar `ANTHROPIC_API_KEY`.
- Configurar `RESEND_API_KEY`.
- Configurar `REPORT_FROM_EMAIL` con dominio verificado.
- Configurar `APP_BASE_URL` con el dominio real.
- Configurar `ALLOWED_ORIGINS` si hay mas de un dominio.
- Ejecutar `npm run lint`.
- Ejecutar `npm run build`.
- Ejecutar `npm audit --audit-level=low`.
- Probar login, creacion de proyecto, invitacion, reporte manual y cron.

## Rotacion De Secretos

Cuando rotar:

- Sospecha de exposicion.
- Cambio de proveedor.
- Salida de personal con acceso.
- Antes de pasar a produccion formal.

Pasos:

1. Crear nuevo secreto en proveedor.
2. Actualizar variable en Vercel.
3. Redesplegar.
4. Validar flujo afectado.
5. Revocar secreto anterior.
6. Registrar fecha y motivo.

## Respuesta A Incidentes

Si se sospecha acceso indebido:

1. Revocar `SUPABASE_SERVICE_ROLE_KEY`.
2. Rotar `CRON_SECRET`.
3. Revisar logs de Vercel.
4. Revisar logs de Supabase Auth.
5. Desactivar usuarios comprometidos.
6. Validar politicas RLS.
7. Exportar evidencia antes de modificar datos.

## Comandos De Auditoria

```bash
npm run lint
npm run build
npm audit --audit-level=low
```

Busqueda local de secretos:

```bash
rg -n --hidden -i "(api[_-]?key|secret|service[_-]?role|password|token|bearer|private[_-]?key)" -g "!node_modules" -g "!dist" -g "!package-lock.json"
```

## Reglas Para Nuevos Cambios

- Nunca exponer service role key al frontend.
- Toda tabla de negocio debe tener `project_id`.
- Toda API sensible debe validar auth y permisos.
- Toda migracion de seguridad debe ser idempotente cuando sea posible.
- Toda integracion externa debe validar errores y no exponer detalles sensibles.
- Toda salida HTML generada por IA debe tratarse como no confiable.
