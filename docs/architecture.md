# Arquitectura Del Proyecto

## Vision General

Productivity-Plus es una aplicacion web de productividad y seguimiento ejecutivo. La arquitectura esta separada en cuatro capas principales:

- Cliente React/Vite para experiencia de usuario y estado de UI.
- Supabase para autenticacion, base de datos, RLS y realtime.
- Vercel Functions para operaciones sensibles que requieren secretos o integraciones externas.
- Servicios externos para IA y correo.

El principio central de seguridad y arquitectura es que los datos del negocio se aislan por `project_id`. El frontend puede operar con la anon key de Supabase, pero la autorizacion final se impone en Postgres mediante RLS y en las APIs mediante validacion de owner/member.

## Diagrama De Contexto

```text
                    +-----------------------+
                    |  Usuario autenticado  |
                    +-----------+-----------+
                                |
                                v
                    +-----------------------+
                    | React SPA en Vercel   |
                    | src/ProductivityPlus  |
                    +-----------+-----------+
                                |
              +-----------------+------------------+
              |                                    |
              v                                    v
 +---------------------------+        +---------------------------+
 | Supabase Auth/Postgres/RT |        | Vercel Functions          |
 | - Sesiones JWT            |        | - /api/invite             |
 | - RLS por project_id      |        | - /api/generate-report    |
 | - Realtime por proyecto   |        | - /api/send-report        |
 | - RPCs controlados        |        | - /api/cron               |
 +-------------+-------------+        +-------------+-------------+
               |                                    |
               v                                    v
 +---------------------------+        +---------------------------+
 | Postgres                  |        | Integraciones externas    |
 | tasks, projects, okrs...  |        | Anthropic, Resend         |
 +---------------------------+        +---------------------------+
```

## Componentes Principales

### Frontend

Ubicacion principal: `src/ProductivityPlus.jsx`.

Responsabilidades:

- Login, registro y seleccion de proyecto.
- Carga inicial de datos del proyecto.
- CRUD de tareas, participantes, indicadores, tipos, OKRs y sprints.
- Suscripciones realtime por proyecto.
- Presencia de usuarios por proyecto.
- Configuracion de correo y reportes.
- Exportacion CSV.

El frontend es actualmente un monolito funcional. Esto reduce complejidad de empaquetado, pero aumenta el costo de mantenimiento. La deuda tecnica recomendada es separar gradualmente por dominios:

- `features/tasks`
- `features/projects`
- `features/reports`
- `features/okrs`
- `features/sprints`
- `features/realtime`
- `shared/ui`
- `shared/supabase`

### Supabase

Responsabilidades:

- Autenticacion y sesiones.
- Persistencia en Postgres.
- RLS multi-tenant.
- Realtime sobre tablas filtradas por `project_id`.
- RPCs para operaciones especiales.

Tablas principales:

- `projects`
- `project_members`
- `tasks`
- `participants`
- `indicators`
- `task_types`
- `app_config`
- `email_config`
- `okrs`
- `key_results`
- `sprints`
- `task_history`
- `notifications`
- `project_templates`

### Vercel Functions

Ubicacion: `api/`.

Responsabilidades:

- Encapsular secretos.
- Validar sesiones Supabase desde bearer tokens.
- Confirmar owner/member de proyecto.
- Conectar con Anthropic y Resend.
- Ejecutar reportes programados mediante cron.

Helpers compartidos:

- `api/_auth.js`: CORS, Supabase clients, auth y autorizacion por proyecto.
- `api/_email.js`: validacion de correos, configuracion Resend y sanitizacion defensiva de HTML.

### Servicios Externos

Anthropic:

- Usado en `/api/generate-report`.
- Recibe un prompt armado server-side con datos del proyecto.
- Devuelve stream de HTML para el reporte ejecutivo.

Resend:

- Usado en `/api/invite`, `/api/send-report` y `/api/cron`.
- Envia invitaciones y reportes.

Vercel Cron:

- Ejecuta `/api/cron` cada hora.
- El endpoint decide si debe enviar segun frecuencia, dia y hora configurados en `email_config`.

## Flujos De Ejecucion

### 1. Login Y Carga De Proyecto

```text
Usuario -> Supabase Auth -> JWT
Frontend -> projects/project_members -> RLS filtra proyectos disponibles
Frontend -> tasks/participants/indicators/... -> RLS filtra por project_id
```

El proyecto activo se guarda en `localStorage` como conveniencia. No debe considerarse fuente de autorizacion. La autorizacion real depende de RLS y de las APIs server-side.

### 2. CRUD De Tareas

```text
Frontend -> Supabase table tasks
Postgres RLS -> is_project_member(project_id)
Realtime -> canal productivity-plus-realtime-{projectId}
```

Los miembros autenticados pueden operar tareas del proyecto. Para escenarios corporativos se recomienda evolucionar a RBAC granular.

### 3. Invitaciones

```text
Owner -> /api/invite
API -> valida JWT
API -> valida owner del proyecto
API -> genera URL con invite_code
API -> Resend
Invitado -> ?join=CODE
Frontend -> RPC join_project_by_invite_code
Postgres -> inserta project_members/participants
```

### 4. Reporte Manual

```text
Owner -> /api/generate-report
API -> valida JWT y owner
API -> lee tasks/participants/indicators por project_id
API -> Anthropic stream HTML
Owner -> /api/send-report
API -> valida owner, correos y HTML
API -> Resend
```

### 5. Reporte Programado

```text
Vercel Cron -> /api/cron con Bearer CRON_SECRET
API -> valida CRON_SECRET
API -> Supabase service role
API -> lee email_config por proyecto
API -> llama /api/generate-report con X-Cron-Secret
API -> sanitiza HTML y envia via Resend
API -> actualiza last_sent
```

## Decisiones Arquitectonicas

### SPA En Vite

La aplicacion es altamente interactiva y esta centrada en un tablero operativo. Vite permite un build simple y rapido.

### Supabase Como Backend Principal

Supabase cubre Auth, Postgres, RLS y Realtime con bajo overhead operacional. La seguridad no depende del cliente, sino de politicas de base de datos.

### Vercel Functions Para Operaciones Sensibles

Las operaciones que requieren secretos o integraciones externas no deben ejecutarse en navegador. Por eso se encapsulan en `api/`.

### RLS Como Frontera De Seguridad

La anon key puede estar en el cliente, pero no debe otorgar acceso a datos por si misma. RLS impone el aislamiento por proyecto.

## Deuda Tecnica Conocida

- `src/ProductivityPlus.jsx` concentra demasiada logica.
- Falta suite de pruebas automatizadas.
- Falta RBAC granular por rol.
- El historial de cambios registra `changed_by` desde cliente; debe evolucionar a `auth.uid()` server-side.
- El bundle supera 500 kB minificado.
- La sanitizacion HTML es defensiva, pero no reemplaza una libreria HTML sanitizer robusta con allowlist formal.

## Criterios De Calidad Arquitectonica

Una nueva funcionalidad debe cumplir:

- No exponer secretos al cliente.
- Usar `project_id` en toda entidad de negocio.
- Respetar RLS o pasar por API server-side.
- Validar permisos en servidor para acciones sensibles.
- Mantener APIs idempotentes o con errores claros.
- Agregar migracion SQL para cambios de esquema.
- Documentar variables de entorno nuevas.
