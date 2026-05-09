# Productivity-Plus

Productivity-Plus es una aplicacion web para planeacion, seguimiento y reporte ejecutivo de trabajo por proyectos. El sistema combina tablero Kanban, Gantt, metricas, dependencias, OKRs, sprints, presencia en tiempo real, exportacion CSV y reportes ejecutivos generados con IA.

El proyecto esta construido como una SPA React/Vite con Supabase como plataforma de datos/autenticacion/realtime y funciones serverless en Vercel para integraciones sensibles como IA, correo y cron.

## Capacidades Principales

- Gestion multi-proyecto con aislamiento por `project_id`.
- Autenticacion con Supabase Auth.
- Tablero de tareas con estados, responsables, indicadores, subtareas, dependencias y avance.
- Vistas de Gantt, metricas, OKRs, sprints, red de tareas y "Mi Dia".
- Presencia en tiempo real por proyecto.
- Invitaciones por correo con codigo de proyecto.
- Reportes ejecutivos HTML generados con Anthropic y enviados por Resend.
- Cron programado en Vercel para reportes recurrentes.
- Exportacion CSV sin dependencias vulnerables de hojas de calculo.
- RLS en Supabase para separar datos por proyecto.

## Arquitectura Resumida

```text
Usuario navegador
  |
  | React 19 + Vite
  v
Frontend SPA
  |                         \
  | Supabase anon key        \ HTTPS /api/*
  v                           v
Supabase Auth/Postgres/RT    Vercel Serverless/Edge Functions
  |                           |-- Anthropic Messages API
  |                           |-- Resend Email API
  |                           |-- Supabase service role para cron
  v
Postgres + RLS por proyecto
```

La arquitectura completa esta documentada en [docs/architecture.md](docs/architecture.md).

## Stack Tecnico

- React 19
- Vite 8
- Supabase Auth, Postgres y Realtime
- Vercel Functions y Vercel Cron
- Anthropic Messages API via `fetch`
- Resend Email API via `fetch`
- ESLint 9

## Estructura Del Repositorio

```text
api/                 Funciones serverless y helpers de backend
migrations/          Migraciones SQL de Supabase/Postgres
src/                 Aplicacion React
scripts/             Utilidades de mantenimiento
public/              Activos publicos
docs/                Documentacion tecnica profesional
vercel.json          Configuracion principal de Vercel
vercel.deploy.json   Configuracion alternativa de despliegue
```

## Desarrollo Local

```bash
npm install
npm run dev
npm run lint
npm run build
```

En Windows PowerShell, si `npm` queda bloqueado por Execution Policy, usa `npm.cmd`.

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run lint
npm.cmd run build
```

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

`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY` y `CRON_SECRET` son secretos server-side. No deben exponerse al cliente ni guardarse en archivos versionados.

## Base De Datos

Aplica las migraciones en orden:

```text
000_initial_schema.sql
001_w_planner_improvements.sql
002_multiproject.sql
003_features.sql
004_auth.sql
005_guide_board.sql
006_security_hardening.sql
007_lock_down_rpc_grants.sql
```

La migracion `006_security_hardening.sql` activa RLS y agrega helpers seguros para multi-tenant. La migracion `007_lock_down_rpc_grants.sql` cierra permisos publicos/anonimos sobre RPCs sensibles.

Mas detalle en [docs/database.md](docs/database.md).

## Seguridad

El proyecto usa defensa por capas:

- Supabase Auth para identidad.
- RLS por `project_id`.
- Validacion de owner/member en funciones serverless.
- CORS restringido.
- Headers de seguridad en Vercel.
- Sanitizacion defensiva de HTML de reportes.
- Secretos server-side obligatorios.
- Auditoria de dependencias con `npm audit`.

La postura de seguridad, riesgos residuales y checklist de produccion estan en [docs/security.md](docs/security.md).

## Documentacion Tecnica

- [Arquitectura](docs/architecture.md)
- [Referencia de APIs](docs/api-reference.md)
- [Base de datos y RLS](docs/database.md)
- [Seguridad](docs/security.md)
- [Despliegue](docs/deployment.md)
- [Operacion y mantenimiento](docs/operations.md)

## Calidad

Comandos base:

```bash
npm run lint
npm run build
npm audit --audit-level=low
```

Estado conocido:

- `npm audit` sin vulnerabilidades conocidas.
- `npm run lint` pasa.
- `npm run build` pasa.
- Existe advertencia de bundle grande por el monolito `src/ProductivityPlus.jsx`; no bloquea build, pero es deuda tecnica.

## Estado Del Proyecto

El proyecto ya cuenta con hardening importante de APIs, base de datos y despliegue. Para elevarlo a un estandar corporativo mas fuerte, las siguientes mejoras recomendadas son RBAC granular, auditoria server-side con `auth.uid()`, pruebas automatizadas y division progresiva del monolito frontend.
