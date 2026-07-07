# SEO_PLAN — Productivity-Plus (w-planner)

> Super plan SEO + GEO generado por **SuperSEO** (triple planificador: Claude + Codex/GPT + Gemini).
> Cada modelo armó su plan independiente; acá está fundido lo mejor de los tres, aterrizado a
> este proyecto. Última corrida: **2026-07-06**.

## Resumen ejecutivo

- **Proyecto:** Productivity-Plus (P+), SaaS B2B de gestión de proyectos con IA (Kanban/Scrum,
  Gantt, OKRs, sprints, dependencias, reportes ejecutivos con IA y chat sobre los datos del
  equipo). Español, precios en COP, para líderes de equipo y PMs en **Colombia**. Dominio:
  `productivityplus.softatumedida.com`.
- **Planificadores que corrieron:** A=Claude (`claude-opus-4-8`) · B=Codex (`gpt-5.5`, xhigh) ·
  C=Gemini (`Gemini 3.1 Pro (High)`). Los tres completaron. Convergencia muy alta (divergencia
  < 20 %), así que el plan es de **alta confianza**.
- **Estado SEO actual (diagnóstico):** crítico. Es una SPA React/Vite **100 % renderizada en
  cliente** cuyo único "landing" es una animación de 4.2 s que lleva al login. El HTML servido
  es un cascarón vacío: `lang="en"`, título genérico, sin description, sin Open Graph, sin
  canonical, sin datos estructurados. `public/` solo tiene `favicon.svg`: no hay robots.txt,
  sitemap.xml ni llms.txt. **Google no tiene qué rankear y los motores de IA no tienen qué
  citar.** La base de seguridad (HTTPS, HSTS, headers) sí está sólida.
- **Las 4 apuestas de mayor impacto (consenso de los 3):**
  1. **Superficie pública rastreable.** Publicar HTML estático/prerenderizado (home + precios +
     funciones + FAQ) en el dominio de marca, separado del app-gate (app a `/app`). Es el lever
     maestro: sin esto, todo lo demás rinde poco.
  2. **Cluster de contenido "gestión de proyectos con IA en Colombia"** en español real, con
     páginas pilar + artículos de apoyo e intención por etapa (informacional → comparativo →
     transaccional).
  3. **GEO/AEO desde el día uno:** contenido answer-first citable, schema (SoftwareApplication,
     Organization, FAQPage, Article), E-E-A-T visible, bots de IA permitidos y `llms.txt`.
  4. **Arreglar el cascarón ya:** idioma es-CO, metadata real, OG, canonical, robots, sitemap,
     JSON-LD (con hash en la CSP) y llms.txt. Barato, seguro y desbloquea lo demás.

## Roadmap priorizado

| # | Prioridad | Acción | Eje | Dónde (archivo/gap) | Impacto | Esfuerzo | Consenso | Estado |
|---|---|---|---|---|---|---|---|---|
| 1 | P0 | `lang="es-CO"` + title y meta description reales | 1/6 | `index.html` | alto | bajo | [A+B+C] | ✅ aplicado |
| 2 | P0 | Open Graph + Twitter Card + `theme-color` + canonical + apple-touch-icon | 3 | `index.html` | alto | bajo | [A+B+C] | ✅ aplicado |
| 3 | P0 | `robots.txt` (permite bots IA, disallow `/api/`, apunta sitemap) | 1/4 | `public/robots.txt` | alto | bajo | [A+B+C] | ✅ aplicado |
| 4 | P0 | `sitemap.xml` con la URL canónica pública | 1 | `public/sitemap.xml` | medio | bajo | [A+B+C] | ✅ aplicado |
| 5 | P0 | JSON-LD Organization + SoftwareApplication + Offer + WebSite, con `sha256` en la CSP | 3/4 | `index.html` + `vercel.json` | alto | bajo | [A+B+C] | ✅ aplicado |
| 6 | P0 | `llms.txt` (resumen B2A: qué es, funciones, precios, enlaces) | 4 | `public/llms.txt` | medio | bajo | [A+B+C] | ✅ aplicado |
| 7 | P0 | `og-image` social 1200x630 con la marca | 3 | `public/og-image.png` | medio | bajo | [A+B] | ✅ aplicado |
| 8 | P1 | **Landing público prerenderizado** (home + `/precios` + `/funciones/*` + FAQ), app a `/app` | 1/2 | nuevo (Vite SSG/prerender) | muy alto | alto | [A+B+C] | ⏳ pendiente |
| 9 | P1 | FAQ con `FAQPage` schema, answer-first (2-3 líneas por respuesta) | 4 | landing | alto | medio | [A+B+C] | ⏳ pendiente |
| 10 | P1 | Copy de marca alineado a PMs/líderes en Colombia (voz local, sin "tells" de IA) | 2/6 | landing | alto | medio | [A+B+C] | ⏳ pendiente |
| 11 | P1 | Alta en Search Console + Bing Webmaster; enviar sitemap; validar por DNS | 8 | infra | alto | bajo | [A+B] | ⏳ pendiente |
| 12 | P1 | Analítica: Vercel Analytics + Speed Insights (RUM de LCP/INP/CLS), o GA4 con consentimiento (ampliar CSP `connect-src`) | 8 | app + `vercel.json` | medio | medio | [A+B] | ⏳ pendiente |
| 13 | P1 | Blog + clusters (Scrum con IA, OKRs, reportes de sprint, medir aporte) en es-CO | 2/6 | nuevo `/blog` | alto | alto | [A+B+C] | ⏳ pendiente |
| 14 | P2 | Páginas comparativa `/vs/trello`, `/vs/jira`, `/vs/monday`, `/comparativas` | 2/6 | blog | alto | alto | [A+B] | ⏳ pendiente |
| 15 | P2 | Directorios: Capterra, GetApp, G2, AlternativeTo, Product Hunt (lanzamiento) | 5 | off-page | alto | alto | [A+B] | ⏳ pendiente |
| 16 | P2 | Activo linkeable: exponer la "calculadora de aporte" como mini-herramienta pública | 5 | nuevo | medio | medio | [A] | ⏳ pendiente |
| 17 | P2 | Entidad Soft a Tu Medida: perfil consistente + Wikidata + enlaces desde el Hub | 5 | off-page | medio | medio | [A+C] | ⏳ pendiente |
| 18 | P2 | Benchmark propio trimestral (datos agregados no sensibles) como imán de enlaces | 5 | blog | medio | alto | [B] | ⏳ pendiente |

## Detalle por eje

### 1. Fundamentos técnicos
**Estado actual:** CSR puro (React 19 + Vite 8); `dist/index.html` es un cascarón `<div id="root">`
vacío. `lang="en"` (`index.html:2`), sin robots/sitemap. HTTPS + HSTS OK (`vercel.json:26`). CSP
`script-src 'self'` (`vercel.json:22`) bloquea JS inline, lo que condiciona el JSON-LD.
**Recomendaciones:**
- **[A+B+C] P1 lever maestro — superficie rastreable.** El app es CSR y no se puede indexar.
  Publicar HTML prerenderizado para las rutas de marketing y mover el producto autenticado a
  `/app`. Camino coherente con Vite+Vercel: prerender/SSG de rutas estáticas (`vite-plugin-ssg`
  o entradas HTML separadas) reusando componentes, o mini-sitio estático generado antes del
  build. **Por qué:** sin HTML con texto en el servidor, ni Google ni los LLMs leen la propuesta
  de valor. Es la señal que lo mueve todo. Mantener canónico `productivityplus.softatumedida.com`.
- **[A+B+C] P0 idioma:** `<html lang="es-CO">`. Hoy `en` contradice el producto y confunde a
  Google sobre el mercado. ✅ aplicado.
- **[A+B+C] P0 robots.txt + sitemap.xml:** hoy no existen. ✅ aplicados (ver Quick wins).
- **[A+B] P0 canonical:** fijar el subdominio de marca como canónico; así el fallback
  `w-planner.vercel.app` (`api/mp-subscribe.js:31`), que sirve los mismos archivos, no genera
  contenido duplicado. La etiqueta canonical resuelve el duplicado sin infra extra. ✅ aplicado.
  Cuando exista `/app`, marcar login/app como `noindex` [B].
- **[A+B] P1 Core Web Vitals 2026:** el bundle es grande (monolito `ProductivityPlus.jsx`;
  advertencia de bundle en README). Umbrales endurecidos: **LCP < 2.0 s**, **INP < 200 ms**
  (señal primaria, la que más fallan las SPAs React), **CLS < 0.1**, medidos al P75 con datos de
  campo. El landing prerenderizado NO debe cargar todo el app. Medir con Vercel Speed Insights /
  PageSpeed una vez haya páginas públicas.

### 2. Arquitectura de información y contenido
**Estado actual:** sin arquitectura de contenido; una sola vista tras login.
**Recomendaciones:**
- **[A+B+C] P1 URLs semánticas:** `/` (home), `/precios`, `/funciones/[kanban-scrum-gantt |
  reportes-ia | chat-ia | okrs-metricas | dependencias]`, `/casos-de-uso/[lideres-de-equipo |
  equipos-scrum]` [B], `/blog/[slug]`, `/vs/[competidor]`, `/comparativas`, `/recursos` [B].
- **[A+B+C] P1 topical authority por clusters.** Pilar "gestión de proyectos con IA" + clusters:
  Scrum/ágil, OKRs, reportes de sprint, productividad de equipos. Cada cluster: página pilar +
  artículos de apoyo enlazados. Es la forma moderna de ganar autoridad temática.
- **[A+B] P2 intención por etapa:** informacional (blog "qué es un sprint", "cómo escribir
  OKRs"), comparativo (`/vs/*`), transaccional (`/precios`, home).
- **[A+B+C] Guía editorial (transversal, VITAL):** ver sección propia más abajo.

### 3. On-page + datos estructurados
**Estado actual:** metadata mínima; sin schema; sin OG.
**Recomendaciones:**
- **[A+B+C] P0 title + description reales.** Aplicado en el cascarón; se harán únicos por página
  cuando existan rutas. ✅
- **[A+B] P0 Open Graph + Twitter Card + og-image 1200x630.** Mejora CTR al compartir (WhatsApp,
  LinkedIn) y da señales. ✅ aplicado.
- **[A+B+C] P0 JSON-LD:** `Organization` (Soft a Tu Medida publisher, logo, sameAs) +
  `SoftwareApplication` (categoría `BusinessApplication`, `applicationSubCategory` gestión de
  proyectos, `offers` en COP) + `WebSite`. Resolver CSP con `sha256` del bloque en `vercel.json`.
  **[B] No usar `SearchAction`** hasta tener búsqueda real. `Offer` por plan y `BreadcrumbList`
  en internas cuando existan. ✅ aplicado (Organization + SoftwareApplication + Offer + WebSite).
- **[A] P1 encabezados:** un `<h1>` real por página (hoy todo son divs animados) + jerarquía
  h2/h3 en el landing.
- **[A] P1 imágenes/alt:** capturas del producto con `alt` descriptivo en el landing.

### 4. GEO/AEO — motores de respuesta de IA ⭐
*(Cómo ser identificado y citado por ChatGPT, Perplexity, Gemini y los AI Overviews.)*
**Estado actual:** invisible para IA (CSR + sin contenido + sin schema + sin llms.txt). Peor que
para Google clásico, porque muchos crawlers de IA no ejecutan JS.
**Recomendaciones:**
- **[A+B+C] P1 contenido citable:** cada página y artículo abre con respuesta directa de 2-3
  líneas (answer-first). Definiciones claras, cifras verificables, formato escaneable (listas,
  tablas). Ejemplo de apertura de home [B]: "Productivity-Plus es un SaaS colombiano para
  planear proyectos, sprints, OKRs y reportes ejecutivos con IA. Está pensado para líderes de
  equipo que necesitan ver bloqueos, prioridades y avance sin armar informes manuales."
- **[A+B+C] P0 permitir bots de IA en robots.txt:** GPTBot, Google-Extended, PerplexityBot,
  ClaudeBot, CCBot. Permitir = posibilidad de ser citado. Nada sensible es público. ✅ aplicado.
- **[A+B+C] P0 llms.txt:** resumen del producto, funciones, precios y enlaces clave, con la
  aclaración de que los datos privados del producto no son públicos [B]. Barato y encaja con
  SaaS; sin sobrevenderlo (ningún proveedor grande confirma leerlo aún, pero mejora recall de
  marca y es infraestructura B2A). ✅ aplicado.
- **[A+B] P1 E-E-A-T:** página `/sobre-productivity-plus` (o "Nosotros") con empresa,
  responsables, contacto, política editorial y fecha de revisión. Blog con `author` y fechas.
  Señal para Google y para qué fuentes citan los LLMs.
- **[A+B] P1 schema como entidad:** `FAQPage` en la FAQ, `Article`/`BlogPosting` con `author` y
  `datePublished`/`dateModified`. Consistencia de entidad (mismo nombre y descripción en todo).
- **[A+B] P2 presencia donde leen los LLMs:** reseñas en directorios (Capterra/G2), respuestas
  útiles en comunidades PM en español (Reddit, foros LatAm), mención desde softatumedida.com.
- **[B] GEO measurement:** monitoreo mensual de ~25 prompts en ChatGPT Search, Perplexity,
  Gemini y AI Overviews para ver dónde aparece la marca (ver Eje 8).

### 5. Autoridad y off-page
**Estado actual:** dominio nuevo, sin backlinks conocidos ni perfil de entidad.
**Recomendaciones:**
- **[A+B] P2 directorios de software:** Capterra, GetApp, G2, SoftwareAdvice, AlternativeTo,
  Product Hunt (lanzamiento). Backlink + señal de entidad + presencia donde los LLMs leen reseñas.
- **[A] P2 activo linkeable:** exponer la "calculadora de aporte del equipo" (que el producto ya
  tiene) como mini-herramienta pública; atrae enlaces naturales.
- **[B] P2 benchmark propio trimestral** con datos agregados no sensibles (imán de enlaces y
  contenido citable por IA). Evitar listicles autopromocionales sin sustancia (dañan confianza
  en IA-search).
- **[A+C] P2 entidad Soft a Tu Medida:** perfil consistente (sitio + LinkedIn + directorios),
  Wikidata si hay notabilidad, enlaces desde el Hub `panel.softatumedida.com` y el sitio matriz.
- **[B] P2 PR digital local:** medios de tecnología/emprendimiento de Colombia; casos de cliente
  o demos anónimas; LinkedIn de fundadores y partners.

### 6. Keywords y demanda
**Estado actual:** sin investigación; el producto no aparece por ninguna keyword.
**Recomendaciones:**
- **[A+B+C] P1 primarias (es-CO):** "software de gestión de proyectos [Colombia]", "herramienta
  de gestión de proyectos con IA", "software scrum y kanban [en español]", "software OKR para
  equipos", "reportes ejecutivos de proyectos con IA".
- **[A+B] P1 long-tail y conversacional (clave GEO):** "cómo hacer un reporte semanal de
  proyectos", "cómo priorizar el backlog", "cómo detectar tareas bloqueadas en Scrum", "Kanban
  vs Scrum vs Gantt", "cómo medir el aporte de cada persona sin volverlo vigilancia" [B].
- **[A+B] P2 comparativas de alta intención:** "alternativa a Trello en Colombia", "vs Jira",
  "vs Monday", "vs Asana". Demanda existente con intención cercana a compra.
- **[A+B+C] Localización, no traducción:** términos y ejemplos del mercado colombiano; evitar
  español neutro de IA. Confirmar volúmenes con Keyword Planner/GSC/Semrush antes de escalar.

### 7. Local e i18n
**Parcial (no local físico).** No hay dirección/tienda → `LocalBusiness`/Google Business Profile
**N/A** por ahora [A+B+C]. Sí conviene **geo-targeting a Colombia**: `es-CO`, precios COP
visibles, ejemplos locales. **`hreflang` N/A** mientras solo exista una versión es-CO. Si se
expande a LatAm (México, etc.), recién ahí estructura por subcarpeta con hreflang correcto. No
inflar esto hoy ni crear páginas por ciudad falsas.

### 8. Medición y gobernanza
**Estado actual:** sin GA4, GSC ni Bing detectables en el repo.
**Recomendaciones:**
- **[A+B] P1 Search Console + Bing Webmaster:** imprescindibles; verificación por DNS, enviar
  sitemap, monitorear cobertura, impresiones y posición.
- **[A+B] P1 analítica:** dado el mercado y la CSP estricta, **Vercel Analytics + Speed
  Insights** [B] es la vía de menor fricción (RUM de LCP/INP/CLS, sin banner de consentimiento
  invasivo). Alternativa GA4 o Plausible/Umami; cualquiera exige ampliar `connect-src` en la CSP
  [A]. Eventos: visita orgánica, clic a login, checkout start, signup, upgrade, plan comprado [B].
- **[A+B] P1 KPIs:** SEO (impresiones y posición media no-marca, CTR, top-20 por cluster,
  tráfico y registros orgánicos) + técnicos (indexadas, cobertura, LCP/INP/CLS P75, peso JS) +
  **GEO** (menciones/citas de marca en respuestas de IA, tráfico referido desde motores de IA).
- **[A+B] P2 gobernanza:** dueño del SEO; revisión técnica semanal el primer mes y luego
  mensual; estratégica trimestral; **checklist de predeploy** para no romper sitemap, robots,
  metadata, canonical ni schema en cada release.

## Guía editorial (aplica a TODO texto que se cree o reescriba) — VITAL

Google no penaliza "contenido con IA"; penaliza contenido poco útil y de relleno. Reglas:
- **Aportar experiencia propia:** dato, caso real de equipos, cifra del producto, opinión clara.
- **Voz de Colombia:** español real del público, no neutro de IA.
- **Answer-first:** responder directo en las primeras 2-3 líneas, con voz propia.
- **Ritmo variado y concreto:** mezclar frases cortas y largas; nombres y cifras, no adjetivos
  vacíos ("innovador", "robusto").
- **Editar el borrador:** un humano corta relleno, suma un ejemplo y verifica afirmaciones.
- **Prohibido (tells de IA):** el **guion largo (em-dash) como paréntesis** (usar comas,
  paréntesis o punto), muletillas ("es importante destacar", "en el mundo actual"), listas
  infladas, simetría perfecta, keyword stuffing, cierres genéricos ("en definitiva, el SEO es
  un viaje").

## Métricas y gobernanza (resumen)
- **KPIs:** cobertura indexada · impresiones/posición no-marca (GSC) · CTR · tráfico y registros
  orgánicos · LCP/INP/CLS P75 · citas/menciones en IA.
- **Herramientas:** Google Search Console + Bing Webmaster + Vercel Analytics/Speed Insights
  (+ Semrush/Ahrefs si hay presupuesto).
- **Cadencia:** técnica mensual (semanal el primer mes), estratégica trimestral.

## Quick wins aplicados en esta corrida
- ✅ `index.html` — `lang="es-CO"`, `<title>` con keyword, meta description, keywords, canonical,
  `theme-color`, Open Graph, Twitter Card, apple-touch-icon, y JSON-LD (Organization +
  SoftwareApplication + Offer x4 + WebSite).
- ✅ `public/robots.txt` — permite bots tradicionales y de IA (GPTBot, Google-Extended,
  PerplexityBot, ClaudeBot, CCBot), `Disallow: /api/`, apunta al sitemap.
- ✅ `public/sitemap.xml` — URL canónica del dominio de marca.
- ✅ `public/llms.txt` — resumen B2A del producto, funciones, planes y enlaces.
- ✅ `public/og-image.svg` + referencia — imagen social de marca 1200x630.
- ✅ `vercel.json` — `sha256` del bloque JSON-LD añadido a `script-src` para no romper la CSP.
- ⏳ **Pendiente (requiere build + decisión de negocio):** landing público prerenderizado (#8),
  FAQ + copy de marca (#9-10), alta en GSC/Bing y analítica (#11-12), blog y clusters (#13),
  comparativas, directorios y autoridad (#14-18).

## Contraste entre modelos
- **Consenso fuerte [A+B+C]:** ~11 recomendaciones (diagnóstico CSR sin superficie pública como
  problema #1 y superficie rastreable como lever maestro; `lang=es-CO`; title+description;
  robots con bots de IA; llms.txt; JSON-LD con hash en CSP; cluster de contenido es-CO;
  answer-first para GEO; localización sin páginas falsas; GSC; guía editorial anti-"tells").
- **Consenso de pares:** varias [A+B] (sitemap, canonical/duplicado vercel.app, Bing, analítica
  RUM, comparativas, directorios, KPIs GEO, gobernanza predeploy) y algunas [A+C] (entidad
  Soft a Tu Medida).
- **Aportes únicos incorporados:** [B] Vercel Analytics + Speed Insights, monitoreo de ~25
  prompts de IA, `/casos-de-uso/*`, "no SearchAction sin búsqueda real", benchmark trimestral,
  noindex de login/app. [A] exponer la calculadora de aporte como imán de enlaces, ampliar CSP
  `connect-src`, preferir SSG single-domain, Wikidata. [C] framing B2A del llms.txt.
- **Discrepancias resueltas:** prioridad de OG/schema (C lo puso P1; A/B P0). Decisión: **P0**,
  porque son cambios baratos y seguros sobre el cascarón, aunque su valor pleno llega con el
  landing. Prioridad del landing prerenderizado: todos lo ven como la apuesta top; queda **P1
  flagship** (los P0 van primero solo por ser quick wins que desbloquean, no por mayor impacto).

## Historial de corridas
- **2026-07-06** — A=`claude-opus-4-8` · B=Codex `gpt-5.5` (xhigh) · C=Gemini `3.1 Pro (High)`.
  Quick wins aplicados: metadata es-CO + OG + canonical + JSON-LD (con hash CSP), robots.txt,
  sitemap.xml, llms.txt, og-image. Pendiente clave: landing prerenderizado y contenido.

## Comentarios del equipo
<!-- Esta sección NUNCA se sobrescribe. Agregá acá notas, decisiones, contexto. -->
