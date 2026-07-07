# Plan SEO — Planificador A (Claude)

Modelo: claude-opus-4-8 (1M) — el mejor de la línea CLAUDE, corrida completa.

## Resumen ejecutivo

Productivity-Plus es un SaaS de gestión de proyectos con IA (Kanban/Scrum, Gantt, OKRs,
sprints, reportes ejecutivos y chat con IA sobre los datos del equipo), en español, precios
en COP, para líderes de equipo en Colombia. Dominio: `productivityplus.softatumedida.com`.

**Diagnóstico:** el sitio hoy es SEO-invisible. Es una SPA 100 % renderizada en cliente cuyo
único "landing" es una animación de 4.2 s que lleva al login (`src/screens/IntroScreen.jsx`).
El HTML servido es un cascarón vacío (`dist/index.html`): `lang="en"`, título genérico, sin
description, sin Open Graph, sin canonical, sin datos estructurados. `public/` solo tiene
`favicon.svg`: no hay robots.txt, sitemap.xml ni llms.txt. Resultado: Google no tiene nada
que rankear y los motores de IA no tienen nada que citar.

**Las 3 apuestas de mayor impacto:**
1. **Construir una superficie pública rastreable** (landing + precios + FAQ + blog) servida
   como HTML estático/prerenderizado en el dominio de marca, separada del app-gate. Sin esto,
   el resto del SEO rinde poco. Es el lever maestro.
2. **Convertir esa superficie en contenido citable por IA (GEO):** answer-first, schema
   (SoftwareApplication, Organization, FAQPage, Article), E-E-A-T visible, y permitir bots de
   IA. Aquí está la ventaja temprana en español-Colombia.
3. **Arreglar el cascarón ya (quick wins técnicos):** idioma es-CO, title/description reales,
   OG/Twitter, canonical, robots.txt, sitemap.xml, JSON-LD (con hash en CSP) y llms.txt.

## Roadmap priorizado

| Prioridad | Impacto | Esfuerzo | Eje | Acción | Dónde |
|---|---|---|---|---|---|
| P0 | alto | bajo | 1 | `lang="es-CO"` + title y meta description reales | `index.html` |
| P0 | alto | bajo | 3 | Open Graph + Twitter Card + `theme-color` + canonical | `index.html` |
| P0 | medio | bajo | 1 | `robots.txt` (permite bots IA, apunta sitemap) | `public/robots.txt` |
| P0 | medio | bajo | 1 | `sitemap.xml` con las URLs públicas | `public/sitemap.xml` |
| P0 | alto | bajo | 3/4 | JSON-LD Organization + SoftwareApplication + hash en CSP | `index.html` + `vercel.json` |
| P0 | medio | bajo | 4 | `llms.txt` en la raíz | `public/llms.txt` |
| P0 | medio | bajo | 3 | `og-image` social (1200x630) | `public/og-image.png` |
| P1 | alto | alto | 1/2 | Landing público prerenderizado (home + precios + FAQ) | nuevo, ver Eje 1 |
| P1 | alto | medio | 4 | FAQ con FAQPage schema, answer-first | landing |
| P1 | medio | medio | 8 | Alta en Search Console + Bing + GA4 con consentimiento | infra |
| P1 | alto | alto | 2/6 | Blog con clusters (Scrum, OKRs, reportes) en es-CO | nuevo |
| P2 | alto | alto | 5 | Directorios (Capterra, G2, Product Hunt LatAm) + entidad | off-page |
| P2 | medio | alto | 2 | Páginas comparativa "vs Trello/Jira/Monday" | blog |
| P2 | medio | medio | 5 | Wikidata + consistencia de entidad Soft a Tu Medida | off-page |

## Detalle por eje

### 1. Fundamentos técnicos
**Estado:** CSR puro; cascarón vacío; `lang="en"`; sin robots/sitemap. HTTPS y HSTS OK
(`vercel.json:26`). CSP `script-src 'self'` bloquea JS inline (afecta JSON-LD).
**Recomendaciones:**
- **P1 lever maestro — superficie rastreable.** El app es CSR y no se puede indexar. Crear
  HTML público prerenderizado para las rutas de marketing. Camino coherente con Vite+Vercel:
  (a) prerender con `vite-plugin-ssg`/`vite-plugin-prerender` de rutas estáticas (`/`,
  `/precios`, `/funciones`, `/blog/*`), o (b) sitio de marketing estático dedicado bajo el
  mismo dominio, con el app moviéndose a `/app`. Recomiendo (a) por mantener un solo dominio y
  reusar componentes. Por qué: sin HTML con texto en el servidor, ni Google ni los LLMs
  pueden leer la propuesta de valor. Es la señal que lo mueve todo.
- **P0 idioma:** `<html lang="es-CO">`. Hoy dice `en`; contradice el producto y confunde a
  Google sobre el mercado objetivo.
- **P0 robots.txt + sitemap.xml:** hoy no existen. Sin sitemap, el descubrimiento depende de
  enlaces; con las rutas públicas nuevas, hay que declararlas.
- **P1 Core Web Vitals:** el bundle es grande (monolito `ProductivityPlus.jsx`, ~73 KB fuente;
  advertencia de bundle en README). Para las rutas públicas, mantener el JS mínimo (el landing
  prerenderizado no debe cargar todo el app). INP es señal primaria en 2026 y las SPAs pesadas
  la reprueban. Medir con PageSpeed/CrUX una vez haya páginas públicas.
- **P0 canonical:** fijar `productivityplus.softatumedida.com` como canónico y evitar que
  `w-planner.vercel.app` (fallback en `api/mp-subscribe.js:31`) indexe contenido duplicado
  (noindex o redirect 301 del dominio vercel.app al de marca).

### 2. Arquitectura de información y contenido
**Estado:** no hay arquitectura de contenido; una sola vista tras login.
**Recomendaciones:**
- **P1 estructura de URLs semántica:** `/` (home), `/funciones/[kanban|scrum|okrs|gantt|
  reportes-ia|chat-ia]`, `/precios`, `/blog/[slug]`, `/vs/[competidor]`.
- **P1 topical authority por clusters.** Pilar "gestión de proyectos con IA" + clusters:
  Scrum/ágil, OKRs, reportes de sprint, productividad de equipos. Cada cluster con página
  pilar + artículos de apoyo enlazados. Es la forma moderna de ganar autoridad temática.
- **P2 intención por etapa:** informacional (blog "qué es un sprint", "cómo escribir OKRs"),
  comparativo (`/vs/trello`, `/vs/jira`, `/vs/monday`), transaccional (`/precios`, home).
- **Guía editorial (transversal, VITAL):** todo texto en **español de Colombia real**, con
  experiencia propia (ejemplos de equipos, cifras del producto), ritmo variado, answer-first,
  concreto. Evitar "tells" de IA: nada de guion largo como paréntesis, ni muletillas ("es
  importante destacar", "en el mundo actual"), ni cierres genéricos. Un humano edita cada
  borrador antes de publicar.

### 3. On-page + datos estructurados
**Estado:** metadata mínima; sin schema; sin OG.
**Recomendaciones:**
- **P0 title + description:** title tipo "Productivity-Plus | Gestión de proyectos con IA para
  equipos" y description con propuesta de valor + keyword + CTA. Únicos por página cuando haya
  rutas.
- **P0 Open Graph + Twitter Card + og-image:** mejora CTR al compartir (WhatsApp, LinkedIn) y
  da señales. Crear `og-image.png` 1200x630 con la marca.
- **P0 JSON-LD:** `Organization` (Soft a Tu Medida como publisher, logo, sameAs redes) +
  `SoftwareApplication` (nombre, categoría "ProjectManagementSoftware", offers en COP, rating
  si hay reseñas) + `WebSite`. Ojo CSP: `script-src 'self'` bloquea inline; añadir el
  `sha256-...` del bloque a `vercel.json`, o servir el JSON-LD desde el HTML prerenderizado con
  su hash. Habilita rich results y ayuda a los LLMs a entender la entidad.
- **P1 encabezados:** un `<h1>` claro por página; jerarquía h2/h3. Hoy no hay H1 real (todo es
  divs animados).
- **P1 imágenes/alt:** cuando haya capturas del producto en el landing, `alt` descriptivo.

### 4. GEO/AEO — motores de respuesta de IA ⭐
**Estado:** invisible para IA (CSR + sin contenido + sin schema + sin llms.txt).
**Recomendaciones:**
- **P1 contenido citable:** cada página pública y artículo abre con respuesta directa de 2-3
  líneas a la pregunta que resuelve (answer-first). Definiciones claras, cifras verificables,
  formato escaneable (listas, tablas). Los LLMs extraen y citan mejor lo bien estructurado.
- **P0 permitir bots de IA en robots.txt:** GPTBot, Google-Extended, PerplexityBot, ClaudeBot,
  CCBot, Bytespider (opcional). Permitir = posibilidad de ser citado. Para un SaaS que busca
  visibilidad, se permiten (nada sensible es público).
- **P0 llms.txt:** en la raíz, resumiendo qué es Productivity-Plus, funciones, precios y
  enlaces a las páginas clave en Markdown. Barato y encaja con SaaS; no sobrevenderlo.
- **P1 E-E-A-T:** página "Nosotros/Soft a Tu Medida" con autoría y credenciales, política
  editorial, fechas de actualización en el blog. Señal tanto para Google como para qué fuentes
  citan los LLMs.
- **P1 schema como entidad:** `FAQPage` en la FAQ, `Article`/`BlogPosting` con `author` y
  `datePublished`/`dateModified` en el blog. Consistencia de entidad (mismo nombre y
  descripción en todo lado).
- **P2 presencia donde leen los LLMs:** reseñas en directorios (Capterra/G2), respuestas útiles
  en comunidades (Reddit r/projectmanagement en español, foros PM LatAm), mención en el sitio
  paraguas softatumedida.com. Wikipedia/Wikidata de la empresa si hay notabilidad.

### 5. Autoridad y off-page
**Estado:** dominio nuevo, sin backlinks conocidos ni perfil de entidad.
**Recomendaciones:**
- **P2 directorios de software:** Capterra, GetApp, G2, SoftwareAdvice, AlternativeTo, Product
  Hunt (lanzamiento). Dan backlink, señal de entidad y presencia donde los LLMs leen reseñas.
- **P2 contenido linkeable:** una herramienta o dato propio (p. ej. "calculadora de aporte del
  equipo", que el producto ya tiene, expuesta como mini-herramienta pública) atrae enlaces
  naturales.
- **P2 entidad Soft a Tu Medida:** perfil consistente (sitio + LinkedIn + directorios),
  Wikidata si aplica, enlaces desde el Hub `panel.softatumedida.com` y el sitio matriz.
- **P2 PR digital local:** medios de tecnología/emprendimiento de Colombia; guest posts de
  valor sobre gestión ágil.

### 6. Keywords y demanda
**Estado:** sin investigación; producto no aparece por ninguna keyword.
**Recomendaciones:**
- **P1 keywords primarias (es-CO):** "software de gestión de proyectos", "herramienta de
  gestión de proyectos con IA", "tablero Scrum/Kanban en español", "software para equipos de
  trabajo", "reportes de sprint automáticos", "OKRs software".
- **P1 long-tail y conversacional (clave GEO):** "cómo hacer seguimiento a un sprint", "qué es
  un reporte de retrospectiva", "cómo medir el aporte de cada persona del equipo", "mejor
  alternativa a Trello en español".
- **P2 comparativas de alta intención:** "vs Trello", "vs Jira", "vs Monday", "vs Asana" y
  "alternativa a [x] en español/para Colombia". Demanda existente con intención cercana a compra.
- **Localización, no traducción:** términos y ejemplos del mercado colombiano; evitar español
  neutro de IA.

### 7. Local e i18n
**Parcial.** No hay componente local físico (sin dirección/tienda) → `LocalBusiness`/GBP **N/A**
por ahora. Sí conviene **geo-targeting a Colombia**: precios COP visibles, señales de país,
posible `hreflang` a futuro si se expande a otros países LatAm (México, etc.). Recomendación
P2: mantener es-CO como base y, si se internacionaliza, estructura por subcarpeta `/mx`, `/es`
con hreflang correcto. No inflar esto hoy.

### 8. Medición y gobernanza
**Estado:** sin GA4, sin GSC, sin Bing detectables.
**Recomendaciones:**
- **P1 Google Search Console + Bing Webmaster:** imprescindibles; enviar sitemap, monitorear
  cobertura, impresiones y posición. Verificación por DNS del dominio.
- **P1 GA4 (o analítica con consentimiento):** dado el mercado y la CSP estricta, elegir una
  analítica que respete la CSP `connect-src` (hay que ampliarla al dominio del analytics) y el
  consentimiento. Alternativa liviana: Plausible/Umami self-host.
- **P1 KPIs:** impresiones y posición media (visibilidad), CTR, tráfico orgánico, conversiones
  a registro, y **citas/menciones en AI Overviews y chatbots** (monitoreo manual + herramientas
  emergentes).
- **P2 gobernanza:** dueño del SEO, revisión mensual técnica y trimestral estratégica, y un
  checklist de despliegue para no romper sitemap/metadata/canonical en cada release.

## Quick wins técnicos (aplicables ya, seguros y reversibles)
1. `index.html`: `lang="es-CO"`, title y meta description reales, OG/Twitter, `theme-color`,
   canonical, apple-touch-icon.
2. `public/robots.txt`: permite bots (incluidos los de IA), apunta al sitemap.
3. `public/sitemap.xml`: URL(es) pública(s) actuales.
4. `public/llms.txt`: resumen del producto para agentes de IA.
5. JSON-LD Organization + SoftwareApplication en `index.html` con `sha256` añadido a la CSP de
   `vercel.json` (para no romper la política de scripts).
6. `public/og-image.png` (placeholder de marca si no hay diseño final).

## Métricas / KPIs y cadencia
- **KPIs:** cobertura indexada, impresiones/posición (GSC), CTR, tráfico orgánico, registros
  orgánicos, citas en IA. **Cadencia:** técnica mensual, estratégica trimestral.
