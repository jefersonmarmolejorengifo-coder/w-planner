# Contexto del proyecto — Productivity-Plus (w-planner)

> Extraído del repo por el orquestador (Claude) el 2026-07-06. Base para los 3 planificadores.
> Verificá vos mismo leyendo los archivos citados.

## Qué es el producto

**Productivity-Plus** (marca visible "P+"), SaaS B2B de **gestión y planeación estratégica de
proyectos con IA**. No es un to-do simple: combina tablero **Kanban y Scrum**, **Gantt**,
**métricas**, **dependencias**, **OKRs**, **sprints**, **red de tareas**, vista **"Mi Día"**,
**presencia en tiempo real**, **exportación CSV**, **retros anónimas** y, su diferenciador
fuerte, **reportes ejecutivos generados con IA**: reporte Scrum (caza tareas atascadas y
riesgos), reporte semanal (prioriza backlog y mide aporte por persona), análisis mensual,
reporte evolutivo (crecimiento + sentimiento del equipo) y **chat de IA en vivo sobre los
datos del equipo**. Evidencia: `README.md:1-18`, `src/plans.js:31-108`, `src/features/`
(carpetas `board, sprints, okrs, metrics, deps, evolution, chat, focus, presentation`).

## A quién le sirve (audiencia / mercado / idioma)

- **Líderes de equipo y PMs** que coordinan uno o varios equipos de trabajo por proyectos.
  Los planes están redactados hacia ese perfil: "Para liderar tu primer equipo", "Para
  coordinar varios equipos", "Para escalar con inteligencia" (`src/plans.js:35-93`).
- **Mercado: Colombia.** Precios en **COP** (`PLAN_CURRENCY = "COP"`, `src/plans.js:20`),
  soporte comercial `ventas@softatumedida.com`. Idioma del producto: **español** (toda la UI
  y copy en español; ver `AuthScreen.jsx`, `IntroScreen.jsx`).
- **Modelo de afiliados de Soft a Tu Medida:** el cobro se procesa vía el Hub
  (`panel.softatumedida.com`); w-planner es una app satélite. No afecta el SEO directamente,
  pero sí el posicionamiento de marca (paraguas "Soft a Tu Medida").

## Precios (planes)

Free (0 COP, 1 tablero) · **Pro** 80.000 COP/mes (4 tableros, 2 con IA) · **Pro Team**
110.000 COP/mes ("Más popular", 9 tableros, 5 con IA) · **Pro Power** 210.000 COP/mes (14
tableros, chat IA 100 msg/mes, reporte evolutivo). Todos mensuales, self-serve vía checkout
del Hub. Fuente: `src/plans.js:31-108`.

## Stack y qué es técnicamente posible

- **SPA React 19 + Vite 8**, 100 % **renderizado en cliente (CSR)**. Entrada `src/main.jsx`
  monta `<App>` (`ProductivityPlus.jsx`) en `#root`; no hay SSR/SSG. `package.json`,
  `vite.config.js`.
- **Supabase** (Auth por link mágico / OTP passwordless, Postgres con RLS, Realtime) +
  **Vercel Functions** para IA (Anthropic), correo (Resend) y cron. `README.md:20-48`,
  `api/`.
- **Hosting: Vercel**, proyecto `w-planner` (`.vercel/project.json`).
- **Dominio de producción: `https://productivityplus.softatumedida.com`**
  (`APP_BASE_URL` en `.env.local`). Fallback histórico `w-planner.vercel.app`
  (`api/mp-subscribe.js:31`). El canónico debe ser el subdominio de marca.
- **CSP estricta** en `vercel.json:22`: `script-src 'self'` (sin `unsafe-inline`). Implicación
  SEO: un `<script type="application/ld+json">` inline puede requerir **hash sha256 en la CSP**
  o servirse desde un HTML aparte; hay que tenerlo en cuenta al añadir datos estructurados.
  Los `<meta>` (description, OG, canonical) NO son scripts y no los afecta la CSP.

## Estado SEO actual (diagnóstico con evidencia) — CRÍTICO

- **Sin superficie pública indexable.** El "landing" real es `src/screens/IntroScreen.jsx`:
  una **animación de 4.2 s** que se auto-descarta y lleva al **login** (`AuthScreen.jsx`).
  No hay página de marketing con texto, propuesta de valor, precios ni FAQ que Google pueda
  rastrear. **Todo el producto vive tras autenticación.** Este es el problema #1: hoy no hay
  prácticamente nada que indexar ni que un LLM pueda citar.
- **CSR puro:** el HTML servido (`dist/index.html`) es un cascarón: `<div id="root">` vacío +
  bundles JS. El contenido llega solo tras ejecutar React. Malo para indexación y peor para
  GEO (muchos crawlers de IA no ejecutan JS).
- **`index.html` casi vacío para SEO** (`index.html:1-13`):
  - `<html lang="en">` — **idioma equivocado**; el producto es español-Colombia (debe ser
    `es` o `es-CO`).
  - `<title>Productivity-Plus</title>` — genérico, sin keyword ni propuesta de valor.
  - **Faltan:** `<meta name="description">`, Open Graph, Twitter Card, `<link rel="canonical">`,
    `theme-color`, `apple-touch-icon`, datos estructurados (JSON-LD).
- **`public/` solo tiene `favicon.svg`.** **No hay** `robots.txt`, `sitemap.xml`, `llms.txt`,
  imagen `og-image`, ni `site.webmanifest`.
- **Sin analítica ni Search Console detectables** en el repo (no hay GA4/GSC/Bing tags).
- **Positivo:** HTTPS forzado (HSTS en `vercel.json:26`), headers de seguridad completos,
  dominio de marca propio, favicon SVG existente. La base técnica de seguridad está sólida;
  falta toda la capa de descubribilidad.

## Implicación estratégica para el plan

El mayor lever NO es afinar meta tags de una SPA que nadie puede rastrear, sino **crear una
superficie pública rastreable** (landing + contenido) servida como HTML estático/prerenderizado
en el dominio de marca, separada del app gate. Sin eso, el resto del SEO on-page rinde poco.
Los planificadores deben priorizar esa decisión de arquitectura y proponer el camino más
coherente con el stack (Vercel + Vite): página(s) estática(s) prerenderizada(s) o sitio de
marketing dedicado, más los quick wins técnicos (idioma, robots, sitemap, metadata, OG,
schema con hash CSP, llms.txt) que sí se pueden aplicar ya sobre el cascarón actual.
