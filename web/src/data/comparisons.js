// Comparativas honestas contra las herramientas más buscadas. Regla: ser justos.
// Decimos con claridad para qué es mejor cada competidor y dónde encaja mejor
// Productivity-Plus. Nada de ataques ni datos inventados del competidor (se habla
// en términos cualitativos para no afirmar precios/límites que cambian).

export const comparisons = [
  {
    slug: 'trello',
    name: 'Trello',
    themGoodAt: 'tableros Kanban simples y fáciles',
    seoTitle: 'Productivity-Plus vs Trello | Alternativa en español con reportes de IA',
    seoDesc:
      'Trello es genial para tableros simples. Productivity-Plus es la alternativa cuando tu equipo ya necesita sprints, métricas y reportes automáticos con IA, en español. Comparación honesta.',
    intro:
      'Trello es excelente para lo simple: lo abres y en cinco minutos tienes tarjetas moviéndose por columnas. Productivity-Plus es la mejor alternativa cuando tu equipo creció y ya necesita sprints, métricas, OKRs y, sobre todo, reportes que se arman solos. En una frase: Trello organiza tarjetas; Productivity-Plus te dice qué está en riesgo y cómo va tu gente.',
    chooseThem: [
      'Trabajas solo o en un equipo muy pequeño y solo quieres una lista visual de tareas.',
      'Tu prioridad es la máxima simplicidad y no necesitas reportes ni métricas.',
      'Ya dependes de muchas integraciones (power-ups) que tienes montadas.',
    ],
    chooseUs: [
      'Tu equipo ya hace sprints y necesitas ver velocidad, bloqueos y avance real.',
      'Quieres que el reporte de la semana se arme solo, no armarlo tú cada viernes.',
      'Necesitas OKRs, Gantt y métricas sin apilar power-ups de pago.',
      'Prefieres una herramienta en español, con precio en pesos y plan gratis.',
    ],
    table: [
      { f: 'Reportes ejecutivos con IA', them: 'No', us: 'Sí, automáticos' },
      { f: 'Tablero Kanban', them: 'Sí (su fuerte)', us: 'Sí' },
      { f: 'Sprints / Scrum nativo', them: 'Con power-ups', us: 'Sí, nativo' },
      { f: 'Gantt y dependencias', them: 'Con power-ups', us: 'Sí, nativo' },
      { f: 'OKRs y métricas', them: 'Limitado', us: 'Sí, nativo' },
      { f: 'Retros y pulso del equipo', them: 'No', us: 'Sí' },
      { f: 'Chat de IA sobre tu equipo', them: 'No', us: 'Sí (plan Power)' },
      { f: 'Español nativo', them: 'Interfaz traducida', us: 'Sí, todo en español' },
      { f: 'Moneda', them: 'Dólares', us: 'Pesos (COP), pago internacional' },
      { f: 'Curva de aprendizaje', them: 'Muy baja', us: 'Baja' },
    ],
    faqs: [
      {
        q: '¿Es Productivity-Plus una buena alternativa a Trello?',
        a: 'Sí, sobre todo si tu equipo ya superó la lista de tareas simple y necesita sprints, métricas y reportes automáticos. Trello sigue siendo genial para tableros básicos; Productivity-Plus suma la capa de reportes con IA, OKRs y evolución del equipo, en español.',
      },
      {
        q: '¿Es difícil pasar de Trello a Productivity-Plus?',
        a: 'No. Productivity-Plus usa tableros con columnas y tarjetas igual que Trello, así que recrear tu flujo toma minutos. Empiezas con el plan gratis y armas tu primer tablero de una.',
      },
    ],
    related: ['reportes-con-ia', 'tableros-scrum-kanban'],
  },
  {
    slug: 'jira',
    name: 'Jira',
    themGoodAt: 'equipos de software grandes y muy configurables',
    seoTitle: 'Productivity-Plus vs Jira | La potencia sin la complejidad, en español',
    seoDesc:
      'Jira es potentísimo pero complejo. Productivity-Plus te da sprints, tableros y reportes con IA sin la curva de aprendizaje, en español y con precio simple. Comparación honesta.',
    intro:
      'Jira es la herramienta más potente para equipos de software grandes que necesitan configurar cada detalle del flujo. Productivity-Plus es la alternativa cuando quieres planear sprints y tableros sin esa complejidad, con reportes ejecutivos que la IA arma por ti y todo en español. Jira te da mil perillas; nosotros te damos el informe hecho.',
    chooseThem: [
      'Eres un equipo de software grande que necesita workflows configurables al detalle.',
      'Dependes de integraciones profundas con el ecosistema Atlassian (Bitbucket, Confluence).',
      'Tienes a alguien que administre y mantenga la herramienta.',
    ],
    chooseUs: [
      'Quieres la potencia de sprints y tableros, pero sin semanas de configuración.',
      'Prefieres que el reporte de sprint lo arme la IA en vez de construir dashboards.',
      'Lideras un equipo mixto (no solo devs) y quieres algo que todos entiendan.',
      'Valoras el español nativo, el precio en pesos y una curva de aprendizaje baja.',
    ],
    table: [
      { f: 'Reportes ejecutivos con IA', them: 'Manuales / por configurar', us: 'Sí, automáticos' },
      { f: 'Scrum y Kanban', them: 'Sí, muy profundo', us: 'Sí, más directo' },
      { f: 'Gantt y dependencias', them: 'Con roadmaps avanzados', us: 'Sí, nativo' },
      { f: 'OKRs y métricas', them: 'Con apps del marketplace', us: 'Sí, nativo' },
      { f: 'Retros y pulso del equipo', them: 'No nativo', us: 'Sí' },
      { f: 'Chat de IA sobre tu equipo', them: 'Emergente', us: 'Sí (plan Power)' },
      { f: 'Español nativo', them: 'Interfaz traducida', us: 'Sí, todo en español' },
      { f: 'Moneda', them: 'Dólares', us: 'Pesos (COP), pago internacional' },
      { f: 'Curva de aprendizaje', them: 'Alta', us: 'Baja' },
    ],
    faqs: [
      {
        q: '¿Productivity-Plus reemplaza a Jira?',
        a: 'Depende del equipo. Si necesitas configuración profunda para un equipo de software grande, Jira es más completo. Si quieres planear sprints, ver métricas y recibir reportes con IA sin la complejidad, y en español, Productivity-Plus lo hace más simple y rápido de adoptar.',
      },
      {
        q: '¿Por qué elegir Productivity-Plus en vez de Jira?',
        a: 'Por la relación potencia-simplicidad: obtienes sprints, tableros, OKRs y Gantt sin la curva de Jira, más reportes ejecutivos que la IA arma por ti. Y todo en español, con precio en pesos y un plan gratis para empezar.',
      },
    ],
    related: ['reportes-con-ia', 'okrs-y-metricas'],
  },
  {
    slug: 'monday',
    name: 'Monday',
    themGoodAt: 'modelar procesos de muchas áreas (un "work OS")',
    seoTitle: 'Productivity-Plus vs Monday | Enfocado en liderar equipos, en español',
    seoDesc:
      'Monday es un work OS amplio y flexible. Productivity-Plus está enfocado en liderar equipos por proyectos, con reportes de IA y evolución del equipo, en español y con precio simple.',
    intro:
      'Monday es un "sistema operativo de trabajo" muy flexible, pensado para modelar procesos de cualquier área: marketing, ventas, operaciones. Productivity-Plus está enfocado en una cosa y la hace a fondo: liderar equipos por proyectos, con reportes de IA sobre riesgos y evolución del equipo, en español y con un precio más simple. Monday es amplio; nosotros somos profundos en lo tuyo.',
    chooseThem: [
      'Necesitas gestionar procesos de varias áreas (marketing, ventas, RRHH) en una sola plataforma.',
      'Valoras la flexibilidad total para modelar cualquier flujo por encima del enfoque.',
      'El precio por asiento en dólares no es una restricción para tu presupuesto.',
    ],
    chooseUs: [
      'Tu foco es liderar proyectos y equipos, no modelar procesos de toda la empresa.',
      'Quieres reportes ejecutivos con IA enfocados en riesgos y aporte, no armar dashboards.',
      'Te importa la evolución del equipo: retros, sentimiento, reconocimiento.',
      'Prefieres precio en pesos, plan gratis y menos configuración inicial.',
    ],
    table: [
      { f: 'Reportes ejecutivos con IA', them: 'Dashboards manuales / IA emergente', us: 'Sí, enfocados en riesgos y equipo' },
      { f: 'Scrum y Kanban', them: 'Sí (flexible)', us: 'Sí, enfocado' },
      { f: 'Gantt y dependencias', them: 'Sí', us: 'Sí' },
      { f: 'OKRs y métricas', them: 'Con plantillas', us: 'Sí, nativo' },
      { f: 'Retros y pulso del equipo', them: 'No nativo', us: 'Sí' },
      { f: 'Chat de IA sobre tu equipo', them: 'Emergente', us: 'Sí (plan Power)' },
      { f: 'Español nativo', them: 'Interfaz traducida', us: 'Sí, todo en español' },
      { f: 'Moneda', them: 'Dólares por asiento', us: 'Pesos (COP), por plan' },
      { f: 'Curva de aprendizaje', them: 'Media (mucha flexibilidad = mucho setup)', us: 'Baja' },
    ],
    faqs: [
      {
        q: '¿Es Productivity-Plus una alternativa a Monday?',
        a: 'Sí, si lo que necesitas es liderar proyectos y equipos. Monday es más amplio (sirve para muchas áreas), pero eso también significa más configuración. Productivity-Plus va enfocado a la gestión de proyectos con reportes de IA y evolución del equipo, en español y con precio más simple.',
      },
      {
        q: '¿En qué se diferencia el precio?',
        a: 'Monday suele cobrar por asiento en dólares, y el costo sube con cada persona. Productivity-Plus cobra por plan en pesos colombianos (pagas con tarjeta desde cualquier país) y tiene un plan gratis para empezar.',
      },
    ],
    related: ['reportes-con-ia', 'okrs-y-metricas'],
  },
  {
    slug: 'microsoft-planner',
    name: 'Microsoft Planner',
    themGoodAt: 'equipos que ya viven en Microsoft 365 y Teams',
    seoTitle: 'Productivity-Plus vs Microsoft Planner | Alternativa con reportes de IA',
    seoDesc:
      'Microsoft Planner es cómodo si ya usas Microsoft 365. Productivity-Plus es la alternativa cuando necesitas sprints, OKRs y reportes ejecutivos con IA, sin depender del ecosistema Microsoft y en español.',
    intro:
      'Microsoft Planner es cómodo si tu empresa ya vive en Microsoft 365: tableros de tareas dentro de Teams, sin costo extra. Productivity-Plus es la alternativa cuando necesitas liderar de verdad: sprints, OKRs, métricas y reportes ejecutivos que la IA arma sobre riesgos y evolución del equipo, sin atarte al ecosistema Microsoft y todo en español. Planner ordena tareas dentro de Office; nosotros te damos la lectura del proyecto y del equipo.',
    chooseThem: [
      'Tu empresa ya usa Microsoft 365 y todo el equipo trabaja dentro de Teams y Outlook.',
      'Solo necesitas tableros de tareas simples integrados con el resto de Office.',
      'Prefieres no sumar otra herramienta porque Planner "ya viene incluido".',
    ],
    chooseUs: [
      'No quieres depender del ecosistema Microsoft: buscas una app web independiente.',
      'Necesitas reportes de IA sobre riesgos y aporte, no solo listas de tareas.',
      'Quieres sprints, OKRs, Gantt y métricas sin saltar a Microsoft Project (aparte y más caro).',
      'Te importa la evolución del equipo (retros, pulso) y el español nativo, con plan gratis.',
    ],
    table: [
      { f: 'Reportes ejecutivos con IA', them: 'Copilot general (licencia aparte)', us: 'Sí, enfocados en riesgos y equipo' },
      { f: 'Tablero Kanban', them: 'Sí (buckets)', us: 'Sí' },
      { f: 'Sprints / Scrum nativo', them: 'No', us: 'Sí, nativo' },
      { f: 'Gantt y dependencias', them: 'Solo en Project (aparte)', us: 'Sí, nativo' },
      { f: 'OKRs y métricas', them: 'Limitado', us: 'Sí, nativo' },
      { f: 'Retros y pulso del equipo', them: 'No', us: 'Sí' },
      { f: 'Chat de IA sobre tu equipo', them: 'Copilot general', us: 'Sí (plan Power)' },
      { f: 'Español nativo', them: 'Interfaz traducida', us: 'Sí, todo en español' },
      { f: 'Requiere ecosistema', them: 'Sí, Microsoft 365', us: 'No, es web independiente' },
      { f: 'Moneda', them: 'Dólares (licencia M365)', us: 'Pesos (COP), pago internacional' },
    ],
    faqs: [
      {
        q: '¿Es Productivity-Plus una alternativa a Microsoft Planner?',
        a: 'Sí, sobre todo si no quieres depender de Microsoft 365 o si necesitas más que tareas: sprints, OKRs, métricas y reportes ejecutivos con IA. Planner es cómodo dentro de Office; Productivity-Plus está pensado para liderar proyectos y equipos, y funciona en cualquier navegador.',
      },
      {
        q: '¿Necesito Microsoft 365 para usar Productivity-Plus?',
        a: 'No. Productivity-Plus es una app web independiente: entras desde el navegador con tu correo, sin licencias de Office ni configuración de administrador. Tienes un plan gratis para empezar.',
      },
    ],
    related: ['reportes-con-ia', 'okrs-y-metricas'],
  },
];

export function getComparison(slug) {
  return comparisons.find((c) => c.slug === slug);
}
