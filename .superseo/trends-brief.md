# Brief de tendencias SEO/GEO vigentes — julio 2026

> Punto de partida obligatorio para los tres planificadores. Investigado con búsqueda
> web fresca el 2026-07-06. Fuentes al pie. Objetivo: que el plan suene a 2026, no a 2022.

## 1. Google clásico + IA se fusionaron

- **AI Overviews** aparecen en ~25.8 % de las búsquedas en EE. UU. (ene-2026); en consultas
  **informacionales** suben a 39.4 %, y a 65.9 % en consultas largas (7+ palabras). El
  mercado hispano va detrás pero en la misma dirección.
- El pipeline **RAG de Google cita fuentes de posiciones 4-20**, no solo del #1: la
  selección premia **calidad del pasaje + señales de confianza**. No hay que ser #1 para
  ser citado; hay que tener el pasaje más claro y confiable.
- **Core Update dic-2025:** E-E-A-T dejó de ser exclusivo de YMYL; ahora aplica a **todo**
  el contenido. Update mar-2026: reforzó el peso de **schema Article, FAQ y Organization**.
- **Entidades > keywords exactas.** Google prioriza entender "qué/quién es esto" por
  consistencia de entidad, no por repetir la keyword.

## 2. Core Web Vitals 2026 (umbrales endurecidos)

- **LCP:** el umbral "bueno" bajó de 2.5 s a **2.0 s** (2.0-2.5 s ahora es "a mejorar").
- **INP** (reemplazó a FID): **< 200 ms**, y pasó a ser **señal de ranking primaria**.
  Es la métrica que más sitios reprueban (43 % falla el umbral de 200 ms en 2026).
- **CLS:** < 0.1. Todo se mide con **datos de campo (CrUX)** al percentil 75.
- Causas típicas de INP alto: JS pesado en el hilo principal, hidratación costosa,
  handlers bloqueantes. Relevante para SPAs React grandes.

## 3. GEO / AEO — motores de respuesta de IA (la ventaja nueva)

- La búsqueda por IA (ChatGPT Search, Gemini, Perplexity, Copilot) maneja ya **12-18 %**
  de las consultas informacionales en inglés (Q1-2026), desde <2 % un año atrás. Curva
  igual de empinada en español.
- **Cómo cita cada motor (patrón 2026):**
  - **ChatGPT** (~70 % del uso de IA-search): mezcla web en vivo + entrenamiento; premia
    contenido completo, bien citado y con señales de experiencia. **Wikipedia = 47.9 %** de
    sus fuentes citadas en preguntas factuales → la autoridad de entidad importa.
  - **Perplexity:** citación en tiempo real; sesgo fuerte a **Reddit (46.7 %)** y a
    contenido **fresco (<90 días)**. Publicar y actualizar seguido ayuda.
  - **Gemini:** el de más rápido crecimiento; reparte entre **blogs especializados (39 %),
    noticias (26 %) y opinión profesional (35 %)**.
- **GEO no reemplaza al SEO: convergen.** Los modelos usan búsqueda web en vivo, así que el
  SEO técnico clásico (rastreable, indexable, rápido, con schema) **alimenta** la visibilidad
  en IA. Un sitio que Google no puede indexar tampoco lo citan los LLMs.
- **Contenido citable:** respuesta directa en las primeras 2-3 líneas de cada página/sección
  (answer-first), definiciones claras, cifras y afirmaciones verificables, formato escaneable
  (listas, tablas, encabezados), fechas de actualización visibles.
- **Acceso de bots de IA:** decisión consciente en `robots.txt` sobre GPTBot, Google-Extended,
  PerplexityBot, ClaudeBot, CCBot, etc. Permitir = posibilidad de ser citado; bloquear =
  invisibilidad en esos motores. Para un SaaS que quiere visibilidad, se permiten.

## 4. llms.txt — realista, no bombo

- Adopción ~10 % (mayoría SaaS y dev-tools). **Ningún** proveedor grande (OpenAI, Google,
  Anthropic) confirma leerlo en producción todavía (Q1-2026).
- Beneficio real: es infraestructura **B2A (business-to-agent)** barata (~medio día) — la
  primera superficie legible por máquina que un agente puede consumir limpio. Adoptantes
  reportan mayor "recall" de marca en respuestas de IA (correlación, no causa probada).
- **Veredicto:** para un SaaS encaja y cuesta poco; incluirlo sin sobrevenderlo. No sustituye
  contenido ni sitemap.

## 5. Contenido útil y humano (Helpful Content sigue mandando)

- Google **no** penaliza "contenido con IA"; penaliza **contenido poco útil, genérico y de
  relleno**. El texto que "suena a IA" cae solo en esa trampa.
- Gana el texto con **experiencia propia** (dato, caso, cifra, opinión), **ritmo variado**,
  concreto, en la **voz real del mercado** (español de Colombia, no neutro de IA).
- "Tells" de IA a evitar: guion largo (em-dash) como paréntesis, muletillas ("es importante
  destacar", "en el mundo actual"), listas infladas, simetría perfecta, cierres genéricos.

## Fuentes (2026)
- Search Engine Land — Guía de optimización para AI Overviews (2026).
- Google Search Central — AI features optimization guide (developers.google.com).
- llmrefs.com, frase.io, mersel.ai — Guías GEO 2026 (patrones de citación por motor).
- web.dev / corewebvitals.io / digitalapplied.com — Umbrales CWV 2026 (LCP 2.0 s, INP primario).
- limy.ai, linkbuildinghq.com, bluehost.com — Estado real de llms.txt 2026 (adopción/beneficio).
- Datos de citación: Wikipedia 47.9 % (ChatGPT), Reddit 46.7 % (Perplexity), reparto Gemini.
