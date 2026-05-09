# Productivity-Plus

Aplicación React/Vite para planeación de trabajo por proyectos: tablero Kanban, Gantt, métricas, dependencias, OKRs, sprints, presencia en tiempo real, exportación CSV y reportes ejecutivos con IA.

## Stack

- React 19 + Vite
- Supabase Auth, Postgres y Realtime
- Vercel Serverless/Edge Functions
- Anthropic Messages API vía `fetch`
- Resend para correos

## Desarrollo

```bash
npm install
npm run dev
npm run lint
npm run build
```

En Windows PowerShell, si `npm` queda bloqueado por Execution Policy, usa `npm.cmd`.

## Variables De Entorno

Cliente:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Servidor/Vercel:

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

`SUPABASE_SERVICE_ROLE_KEY` se usa solo en funciones server-side como el cron. No debe exponerse al cliente.

## Base De Datos

Aplica las migraciones en orden desde `migrations/000_initial_schema.sql` hasta la última. La migración `006_security_hardening.sql` agrega aislamiento por proyecto, RLS, helpers seguros para invitaciones y reserva atómica de IDs. La migración `007_lock_down_rpc_grants.sql` cierra permisos públicos/anónimos sobre los RPC.

Flujos protegidos:

- Los datos de tareas, participantes, indicadores, OKRs, sprints, configuración de correo y realtime se aíslan por `project_id`.
- El join por código usa el RPC `join_project_by_invite_code`.
- La reserva de ID usa el RPC `claim_task_id`.
- Reportes e invitaciones requieren sesión Supabase y permisos de dueño del proyecto.

## Reportes

Los reportes se generan en `/api/generate-report`, se envían en `/api/send-report` y el cron corre en `/api/cron`. Para ejecución automática en Vercel, `CRON_SECRET` debe coincidir con el Bearer token configurado para el cron.
