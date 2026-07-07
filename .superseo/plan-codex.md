# Plan SEO — Planificador B (Codex)

Modelo usado: GPT-5 Codex.

## Resumen ejecutivo

Productivity-Plus tiene producto y diferenciador fuertes, pero casi no tiene superficie pública indexable: la home es una SPA React/Vite que muestra intro/login y deja el valor real detrás de autenticación. El mayor impacto no está en retocar una meta description, sino en publicar HTML rastreable con propuesta de valor, precios, funcionalidades, FAQ y contenido citable. Las 3 apuestas: mover el marketing público a SSG/HTML estático en el dominio canónico, crear un cluster de contenido para gestión de proyectos con IA en Colombia, y preparar la marca para GEO/AEO con schema, llms.txt, respuestas directas y autoridad verificable. Nota de alcance: la lectura local quedó bloqueada por sandbox, así que uso la evidencia del contexto del orquestador más la URL pública y fuentes oficiales actuales de Google.

## Roadmap priorizado

| Prioridad | Impacto | Esfuerzo | Eje | Acción concreta | Dónde |
|---|---:|---:|---|---|---|
| P0 | Alto | Bajo | Técnico | Corregir metadata base: `lang="es-CO"`, title descriptivo, description, canonical, OG, Twitter, theme color | `index.html` |
| P0 | Alto | Bajo | Técnico/GEO | Crear `robots.txt` con sitemap, permitir bots de búsqueda e IA, bloquear `/app` y `/api` si se publican | `public/robots.txt` |
| P0 | Alto | Bajo | Técnico | Crear sitemap inicial solo con URLs reales y canónicas | `public/sitemap.xml` |
| P0 | Medio | Bajo | GEO | Crear `llms.txt` sobrio con resumen, páginas clave, precios y límites de IA | `public/llms.txt` |
| P0 | Medio | Bajo | On-page | Añadir `SoftwareApplication`, `Organization` y `Offer` JSON-LD, resolviendo CSP con hash sha256 | `index.html`, `vercel.json` |
| P1 | Muy alto | Medio | Técnico/Contenido | Separar marketing público del app gate: landing SSG/HTML en `/`, app en `/app` | `index.html`, Vite/Vercel routing |
| P1 | Alto | Medio | Contenido | Publicar páginas rastreables: `/precios`, `/funciones/reportes-ia`, `/funciones/kanban-scrum-gantt`, `/funciones/okrs-metricas` | Nueva superficie pública |
| P1 | Alto | Medio | GEO/AEO | Estructurar cada página con respuesta directa, FAQ real, fecha de actualización y autor/revisor | Páginas públicas |
| P1 | Medio | Medio | Medición | Configurar GSC, Bing Webmaster, GA4 o Vercel Analytics, eventos orgánicos y Web Vitals RUM | Dominio, app, Vercel |
| P2 | Alto | Alto | Autoridad | Conseguir menciones y enlaces con casos, benchmarks anónimos y alianzas PM/tech Colombia | Off-page |
| P2 | Alto | Alto | Keywords | Construir cluster editorial BOFU/MOFU/TOFU sobre gestión de proyectos con IA | `/blog`, `/recursos`, `/comparativas` |
| P2 | Medio | Medio | Local/i18n | Consolidar enfoque Colombia con `es-CO`, COP, ejemplos locales y sin páginas locales falsas | Sitio público |

## Detalle por eje

### 1. Fundamentos técnicos

Estado actual: CSR puro con React 19 + Vite 8, `index.html` casi vacío, `html lang="en"`, sin `robots.txt`, `sitemap.xml`, `llms.txt` ni metadata completa. La home real deriva a login, por lo que Google y crawlers de IA tienen poco que citar. Google confirma que sus funciones generativas dependen de contenido rastreable e indexable desde Search: https://developers.google.com/search/docs/fundamentals/ai-optimization-guide.

Recomendación: convertir `/` en una landing pública HTML/SSG y mover el producto autenticado a `/app`. En Vite puede hacerse con entradas HTML separadas o con un mini sitio estático generado antes del build. Mantener dominio canónico `https://productivityplus.softatumedida.com`.

Rendimiento: presupuesto interno LCP móvil menor a 2.0 s por el brief 2026, INP menor a 200 ms y CLS menor a 0.1. La documentación pública de Google aún referencia LCP 2.5 s, INP 200 ms y CLS 0.1, así que 2.0 s debe tratarse como objetivo conservador: https://developers.google.com/search/docs/appearance/core-web-vitals.

### 2. Arquitectura de información y contenido

Estado actual: no hay arquitectura pública. El repo muestra funcionalidades fuertes en `src/features/`, pero no existen URLs semánticas para ellas.

Estructura propuesta: `/` para propuesta de valor, `/precios`, `/funciones/reportes-ia`, `/funciones/chat-ia`, `/funciones/kanban-scrum-gantt`, `/funciones/okrs-metricas`, `/funciones/dependencias`, `/casos-de-uso/lideres-de-equipo`, `/casos-de-uso/equipos-scrum`, `/comparativas` y `/recursos`.

Cluster inicial: “gestión de proyectos con IA para equipos en Colombia”. Artículos: cómo hacer un reporte semanal ejecutivo, cómo detectar tareas atascadas en Scrum, cómo priorizar backlog con IA, Kanban vs Scrum vs Gantt, cómo medir aporte por persona sin volverlo vigilancia.

Guía editorial: escribir en español colombiano profesional, con ejemplos reales, cifras propias cuando existan y postura clara. Evitar relleno, listas obvias, claims inflados, keyword stuffing y guion largo como paréntesis. Cada texto debe pasar por edición humana para sumar experiencia, cortar frases genéricas y verificar afirmaciones.

### 3. On-page + datos estructurados

Estado actual: title genérico, sin description, sin OG/Twitter, sin canonical y sin schema. `src/plans.js` ya contiene precios en COP que deben exponerse públicamente.

Acciones: title sugerido para home: “Productivity-Plus | Gestión de proyectos con IA para equipos en Colombia”. Description: “Planifica proyectos, sprints, OKRs y reportes ejecutivos con IA en un solo SaaS para líderes de equipo y PMs en Colombia.”

Schema: usar `Organization` para Soft a Tu Medida, `SoftwareApplication` para Productivity-Plus, `Offer` por plan, `FAQPage` en home/precios, `BreadcrumbList` en internas y `Article`/`BlogPosting` en blog. No usar `SearchAction` hasta tener búsqueda real. Validar con Rich Results Test y resolver CSP de `vercel.json` con hash para cada JSON-LD inline. Guía oficial: https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data.

### 4. GEO/AEO

Estado actual: el sitio no ofrece pasajes autocontenidos. Para ChatGPT Search, Perplexity, Gemini y AI Overviews, esto es el mismo problema que para Google clásico, pero más severo.

Acciones: cada página debe empezar con una respuesta directa de 2 a 3 líneas. Ejemplo de enfoque: “Productivity-Plus es un SaaS colombiano para planear proyectos, sprints, OKRs y reportes ejecutivos con IA. Está pensado para líderes de equipo que necesitan ver bloqueos, prioridades y avance sin armar informes manuales.”

Crear `llms.txt` con marca, descripción, audiencia, precios, URLs clave, contacto comercial y aclaración de que los datos privados del producto no son públicos. Permitir GPTBot, PerplexityBot, ClaudeBot, CCBot y Google-Extended si la estrategia es visibilidad. Añadir página `/sobre-productivity-plus` con empresa, responsables, contacto, política editorial y fecha de revisión.

### 5. Autoridad y off-page

Estado actual: no se reportan señales externas ni menciones detectables. La autoridad debe construirse desde el paraguas Soft a Tu Medida y desde casos de uso reales.

Acciones: publicar 2 casos de cliente o demos anónimas, crear un benchmark propio trimestral con datos agregados no sensibles, conseguir menciones en comunidades PM/tech de Colombia, directorios SaaS, LinkedIn de fundadores y partners. Evitar listicles autopromocionales sin sustancia, porque dañan confianza en IA-search.

### 6. Keywords y demanda

Prioridades BOFU: “software de gestión de proyectos Colombia”, “herramienta de gestión de proyectos con IA”, “software scrum y kanban”, “software OKR para equipos”, “reportes ejecutivos de proyectos con IA”, “alternativa a Trello en Colombia”.

Prioridades MOFU/TOFU: “cómo hacer reporte semanal de proyectos”, “cómo priorizar backlog”, “cómo detectar tareas bloqueadas”, “Kanban vs Scrum vs Gantt”, “cómo medir avance de un equipo”. Confirmar volumen con Keyword Planner, GSC y una suite como Semrush/Ahrefs antes de escalar calendario.

### 7. Local e i18n

Aplica parcialmente. No es SEO local de tienda física, pero sí localización de mercado. Usar `es-CO`, precios COP, ejemplos colombianos, medios de pago y soporte comercial local. No crear páginas por ciudad salvo que Soft a Tu Medida tenga presencia, NAP verificable y oferta real por ubicación.

`hreflang` no es necesario mientras solo exista una versión en español Colombia. Si luego se expande a LATAM, crear estructura por país o idioma antes de duplicar contenido.

### 8. Medición y gobernanza

Configurar Google Search Console, Bing Webmaster, GA4 o Vercel Analytics, Vercel Speed Insights y medición RUM de LCP/INP/CLS. Eventos mínimos: visita orgánica, clic a login, checkout start, signup, upgrade y plan comprado.

Gobernanza: dueño SEO, checklist predeploy, validación mensual de sitemap/robots/schema, revisión de contenido cada 90 días en páginas clave y monitoreo mensual de 25 prompts en ChatGPT Search, Perplexity, Gemini y Google AI Overviews.

## Quick wins técnicos

- Cambiar `lang="en"` a `lang="es-CO"` en `index.html`.
- Añadir title, description, canonical, OG y Twitter Card.
- Crear `public/robots.txt`, `public/sitemap.xml` y `public/llms.txt`.
- Añadir `og-image` 1200x630 con captura real o mock fiel del producto.
- Añadir schema inicial `Organization` + `SoftwareApplication` + `Offer`.
- Marcar login/app como `noindex` cuando exista ruta pública separada.
- Enviar dominio canónico a Search Console y Bing Webmaster.

## Métricas/KPIs y cadencia

KPIs técnicos: páginas indexadas, errores de cobertura, sitemap leído, LCP P75 móvil, INP P75, CLS P75, peso JS inicial y estado de rich results.

KPIs SEO: impresiones no marca, CTR, posición media por cluster, URLs en top 20, tráfico orgánico, leads orgánicos, checkout starts orgánicos y conversión a plan pago.

KPIs GEO/AEO: menciones de marca en respuestas IA, citas con enlace, sentimiento de marca, prompts donde aparece Productivity-Plus, tráfico referido desde motores de IA y queries conversacionales que disparan visibilidad.

Cadencia: revisión técnica semanal durante el primer mes, revisión SEO mensual, actualización trimestral del cluster editorial y auditoría semestral de arquitectura, competencia y autoridad.