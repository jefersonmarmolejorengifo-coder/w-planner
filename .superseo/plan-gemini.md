# Plan SEO — Planificador C (Gemini)
Modelo utilizado: Gemini 3.1 Pro (High)

## Resumen ejecutivo
El estado SEO actual de Productivity-Plus es crítico: al ser una Single Page Application (SPA) 100% Client-Side Rendering (CSR) alojada tras un gate de autenticación (la única ruta pública real lleva a un login), ni Google ni los motores de búsqueda por IA pueden rastrear o entender su propuesta de valor. La prioridad absoluta es crear una superficie pública (landing page) rastreable. Las tres apuestas de mayor impacto son: 1) separar la landing pública de la app interactiva renderizando HTML estático, 2) habilitar el rastreo técnico básico e implementar `llms.txt` para ganar visibilidad B2A (Business-to-Agent) en IA, y 3) solventar quick wins on-page (`lang`, meta etiquetas).

## Roadmap priorizado

| Prioridad | Impacto | Esfuerzo | Eje | Acción concreta | Dónde |
| :--- | :--- | :--- | :--- | :--- | :--- |
| P0 | Alto | Bajo | 1 | Ajustar idioma base, meta tags fundacionales y `<title>`. | `index.html` |
| P0 | Alto | Bajo | 1 | Crear `robots.txt` permitiendo rastreo de bots tradicionales y de IA. | `public/robots.txt` |
| P0 | Medio | Bajo | 4 | Crear `llms.txt` con el elevator pitch y planes para crawlers de IA. | `public/llms.txt` |
| P1 | Alto | Medio | 2 | Prerenderizar landing page o aislar el frontend público del gate de auth. | Arquitectura (Vite/SSG) |
| P1 | Alto | Medio | 3 | Insertar metadata Open Graph y schema JSON-LD, gestionando el hash de la CSP. | `index.html` / Nueva landing |
| P1 | Alto | Medio | 6 | Alinear el "copy" principal a las necesidades de PMs y líderes en Colombia. | Nueva landing page |
| P2 | Alto | Alto | 2 | Crear un cluster de contenido editorial (ej. guías de Scrum con IA). | Directorio de contenidos (/blog) |
| P2 | Medio | Bajo | 8 | Alta y configuración en Google Search Console. | GSC y DNS |

## Detalle por eje

### Eje 1 — Fundamentos técnicos
- **Estado actual:** SPA pura con Vite. `index.html` tiene `<html lang="en">`, título genérico y carece de meta description, canonical o iconos completos. No existen los archivos `robots.txt` ni `sitemap.xml`.
- **Recomendaciones:**
  - **Arreglo base (P0):** Cambiar el atributo a `lang="es-CO"`. Esto es fundamental para búsquedas locales e intenciones en español.
  - **Indexabilidad (P0):** Añadir `public/robots.txt` para guiar a los bots y `public/sitemap.xml` para listar la URL canónica (aunque por ahora solo sea la portada).

### Eje 2 — Arquitectura de información y contenido
- **Estado actual:** El usuario ve un `IntroScreen` de 4 segundos que redirige a `AuthScreen`. La lógica de negocio está oculta; no hay arquitectura de URLs informacionales.
- **Recomendaciones:**
  - **Superficie pública (P1):** La app en React (protegida por autenticación) debe vivir idealmente bajo rutas protegidas, mientras que la portada y las futuras páginas de servicios o precios deben renderizarse como HTML pre-generado. Evaluar prerendering para al menos el `index.html` que ve el rastreador, incluyendo descripción, planes y features.

### Eje 3 — On-page + datos estructurados
- **Estado actual:** Nulo. Solo existe el cascarón HTML. `vercel.json` tiene una CSP muy estricta (`script-src 'self'`).
- **Recomendaciones:**
  - **Metadata (P1):** Incorporar etiquetas Open Graph y Twitter Cards. La presentación social atrae tráfico directo.
  - **Datos Estructurados (P1):** Implementar schema de `SoftwareApplication` y `Organization`. Dado el bloqueo por la CSP en `vercel.json` a `unsafe-inline`, los scripts JSON-LD requerirán la adición de su hash sha256 específico en las directivas de Vercel o su carga vía un archivo externo.

### Eje 4 — GEO / AEO (motores de respuesta de IA)
- **Estado actual:** Sin superficie accesible para ChatGPT, Perplexity o Gemini, el producto es invisible.
- **Recomendaciones:**
  - **Archivo llms.txt (P0):** Subir a `public/llms.txt` un resumen en Markdown sobre qué es Productivity-Plus, quiénes son los usuarios objetivo y el precio de los planes en COP.
  - **Apertura de bots de IA (P0):** Incluir explícitamente en el `robots.txt` reglas de `Allow` para `GPTBot`, `PerplexityBot`, `ClaudeBot` y `Google-Extended`. Queremos que la IA extraiga la información.

### Eje 5 — Autoridad y off-page
- **Estado actual:** Se apoya en el subdominio `productivityplus.softatumedida.com`.
- **Recomendaciones:**
  - **Consolidar la marca (P2):** La autoridad de P+ se beneficiará de cualquier backlink o citación editorial ganada. En GEO, la mención consistente del producto asociado a Soft a Tu Medida en redes de profesionales sumará entidad.

### Eje 6 — Keywords y demanda
- **Estado actual:** `<title>Productivity-Plus</title>` desaprovecha la intención de búsqueda.
- **Recomendaciones:**
  - **Title SEO (P0):** Cambiar a "Productivity-Plus | Gestión y Planeación de Proyectos con IA".
  - **Guía Editorial (VITAL):** Para toda futura landing page o blog, el texto debe enfocarse en resolver problemas reales de un PM. Hay que aportar datos concretos, usar el idioma del mercado local (Colombia) y variar la estructura de párrafos. **Está terminantemente prohibido utilizar el guion largo (em-dash) como paréntesis** y se deben evitar cierres o muletillas robóticas (ej. "es importante destacar").

### Eje 7 — Local e i18n
- **Estado actual:** Producto regional en español para Colombia.
- **Recomendaciones:**
  - **N/A:** Al ser un SaaS puramente digital B2B y ofrecerse (por ahora) únicamente en español para su mercado principal (pagos en COP), no se requiere una arquitectura local física (LocalBusiness) ni etiquetas `hreflang` para versiones internacionales.

### Eje 8 — Medición y gobernanza
- **Estado actual:** Sin telemetría pública ni configuración en GSC.
- **Recomendaciones:**
  - **Gobernanza (P2):** Activar Google Search Console validado por dominio (DNS) para revisar si los bots están topándose con el gate de login, medir la velocidad LCP y el INP real de campo mediante CrUX.

## Quick wins técnicos
*(Implementables de inmediato y sin riesgos de regresión)*
1. Actualizar `index.html`: Cambiar `lang="en"` por `lang="es-CO"`.
2. Actualizar `index.html`: Reemplazar el `<title>` por `Productivity-Plus | Gestión y Planeación de Proyectos con IA`.
3. Actualizar `index.html`: Agregar `<meta name="description" content="Productivity-Plus (P+) es un SaaS de Soft a Tu Medida para la gestión estratégica de proyectos con Kanban, métricas y reportes generados con IA.">`.
4. Crear `public/robots.txt` autorizando el rastreo total (User-agent: * / Allow: /).
5. Crear `public/llms.txt` con la información del modelo SaaS y los planes Pro/Pro Team.

## Métricas/KPIs sugeridos y cadencia de revisión
- **Indexación efectiva:** Lograr que Google asimile correctamente la nueva URL pública (cuando exista).
- **Core Web Vitals:** Monitoreo estricto del umbral INP (< 200 ms) en GSC, crítico al ser una SPA pesada en React.
- **Tracción AEO:** Chequeo manual o vía herramientas de las menciones ("Productivity-Plus Soft a tu medida") en chatbots y AI Overviews para búsquedas transaccionales en Colombia.
- **Cadencia:** Revisión técnica a nivel de performance de frontend mensual; auditoría de indexación/contenido cada trimestre.
