# Base De Datos Y RLS

La base de datos corre en Supabase Postgres. El modelo es multi-proyecto y usa `project_id` como frontera principal de aislamiento.

## Orden De Migraciones

Aplica las migraciones en este orden:

| Orden | Archivo | Proposito |
| --- | --- | --- |
| 000 | `000_initial_schema.sql` | Crea tablas base de tareas, participantes, indicadores, configuracion y correo. |
| 001 | `001_w_planner_improvements.sql` | Agrega tipos de tarea, configuracion base y RPC inicial `claim_task_id`. |
| 002 | `002_multiproject.sql` | Crea proyectos, miembros y agrega `project_id` a tablas existentes. |
| 003 | `003_features.sql` | Agrega OKRs, key results, sprints, historial, notificaciones y plantillas. |
| 004 | `004_auth.sql` | Agrega columnas de autenticacion: `owner_id`, `user_id`, `auth_user_id`, `email`. |
| 005 | `005_guide_board.sql` | Crea un proyecto demo con datos de ejemplo. |
| 006 | `006_security_hardening.sql` | Activa RLS, funciones seguras, indices y politicas por proyecto. |
| 007 | `007_lock_down_rpc_grants.sql` | Revoca permisos publicos/anonimos de RPCs y deja solo `authenticated`. |

## Entidades Principales

### `projects`

Representa un espacio de trabajo/proyecto.

Campos importantes:

- `id`
- `name`
- `description`
- `invite_code`
- `config`
- `owner_id`

`owner_id` debe coincidir con `auth.uid()` para permitir acciones administrativas.

### `project_members`

Relaciona usuarios con proyectos.

Campos importantes:

- `project_id`
- `email`
- `name`
- `user_id`

La pertenencia puede resolverse por `user_id` o por `email`.

### `tasks`

Tabla principal de trabajo.

Campos importantes:

- `id`
- `project_id`
- `title`
- `status`
- `responsible`
- `indicators`
- `progress_percent`
- `subtasks`
- `kr_id`
- `sprint_id`

### `participants`

Perfiles visibles dentro de un proyecto. No son identidad fuerte por si solos.

Campos importantes:

- `project_id`
- `name`
- `is_super_user`
- `auth_user_id`
- `email`

### `email_config`

Configuracion de reportes por proyecto.

Campos importantes:

- `project_id`
- `emails`
- `frequency`
- `send_day`
- `send_hour`
- `days_back`
- `days_forward`
- `last_sent`

Debe existir como maximo una fila por proyecto.

### OKRs Y Sprints

Tablas:

- `okrs`
- `key_results`
- `sprints`

Se vinculan a `project_id` para aislamiento multi-tenant.

## Modelo De RLS

La migracion `006_security_hardening.sql` activa RLS en:

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

## Funciones De Autorizacion

### `is_project_owner(pid BIGINT)`

Devuelve `true` si:

```sql
projects.id = pid
projects.owner_id = auth.uid()
```

### `is_project_member(pid BIGINT)`

Devuelve `true` si el usuario:

- Es owner del proyecto.
- Tiene fila en `project_members` con `user_id = auth.uid()`.
- Tiene fila en `project_members` con `email = auth.email()`.

## RPCs

### `claim_task_id()`

Reserva IDs de tareas de forma atomica usando `app_config.nextId`.

Seguridad:

- `SECURITY DEFINER`.
- `search_path = public`.
- Despues de la migracion 007 solo `authenticated` puede ejecutarla.

### `join_project_by_invite_code(invite_code_input TEXT)`

Permite unirse a un proyecto con codigo de invitacion.

Efectos:

- Busca el proyecto por `invite_code`.
- Inserta/actualiza `project_members`.
- Inserta `participants` si no existe participante asociado al usuario.
- Devuelve el proyecto.

Seguridad:

- Requiere `auth.uid()`.
- Despues de la migracion 007 solo `authenticated` puede ejecutarla.

## Politicas Relevantes

Resumen de intencion:

- `projects`: miembros pueden leer, owner puede crear/actualizar/eliminar.
- `project_members`: miembros pueden leer, owner administra, usuario puede eliminarse a si mismo.
- `tasks`: miembros pueden operar tareas del proyecto.
- `participants`, `indicators`, `task_types`, `email_config`: escritura restringida al owner.
- `okrs`, `key_results`, `sprints`, `task_history`, `notifications`: miembros pueden operar dentro del proyecto.
- `project_templates`: autenticados pueden leer.

## Verificaciones Post-Migracion

Ejecutar en SQL editor de Supabase:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'projects',
    'project_members',
    'tasks',
    'participants',
    'indicators',
    'email_config',
    'okrs',
    'key_results',
    'sprints'
  )
order by tablename;
```

Resultado esperado: `rowsecurity = true` para todas.

Verificar permisos de RPC:

```sql
select
  n.nspname as schema,
  p.proname as function,
  p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'claim_task_id',
    'is_project_owner',
    'is_project_member',
    'join_project_by_invite_code'
  )
order by p.proname;
```

Resultado esperado: sin permisos anonimos sobre esos RPCs.

## Consideraciones De Datos

- No guardar secretos en tablas visibles al cliente.
- No asumir que `localStorage` autoriza acceso.
- No usar `participants.is_super_user` como control fuerte de seguridad.
- No insertar filas sin `project_id` salvo plantillas o configuracion global intencional.
- No modificar RLS sin una prueba manual de acceso cruzado entre usuarios/proyectos.

## Problemas Comunes

### Error `cannot change return type of existing function`

Postgres no permite cambiar el tipo de retorno con `CREATE OR REPLACE FUNCTION`. La migracion 006 ya incluye:

```sql
DROP FUNCTION IF EXISTS public.claim_task_id();
```

antes de recrear `claim_task_id()`.

### Upsert En `email_config`

El frontend usa `onConflict: 'project_id'`. Por eso debe existir:

```sql
unique(project_id)
```

La migracion 006 agrega esa restriccion.
