// Funciones del producto. Cada una es una página propia (/funciones/[slug]) con
// contenido answer-first, pensado para SEO y para que un motor de IA pueda citar.

export const features = [
  {
    slug: 'tableros-scrum-kanban',
    title: 'Tableros Scrum y Kanban',
    icon: '🗂️',
    short: 'Arrastra tareas, asigna responsables y ve dependencias, todo en un tablero.',
    seoTitle: 'Tableros Scrum y Kanban en español | Productivity-Plus',
    seoDesc:
      'Gestiona tu equipo con tableros Scrum y Kanban: estados, responsables, subtareas, dependencias y avance en tiempo real. En español, pensado para Colombia.',
    answer:
      'Productivity-Plus reúne Scrum y Kanban en el mismo lugar. Arrastras cada tarea entre columnas, le pones responsable, subtareas y dependencias, y ves el avance del sprint sin salir del tablero.',
    body: [
      'La mayoría de equipos no necesitan dos herramientas separadas para planear y para ejecutar. Acá el mismo tablero sirve para el día a día en Kanban y para correr sprints en Scrum, con estados que tú defines según cómo trabaja tu equipo.',
      'Cada tarjeta guarda lo que importa: quién es responsable, en qué va, de qué otra tarea depende y qué subtareas le faltan. Cuando algo se atasca, se nota en el tablero antes de que frene la entrega.',
    ],
    points: [
      'Estados y columnas que se adaptan a tu flujo, no al revés',
      'Responsables, indicadores y subtareas en cada tarjeta',
      'Dependencias entre tareas y red visual para ver qué bloquea qué',
      'Vista "Mi Día" para que cada persona sepa qué sigue',
      'Presencia en tiempo real: ves quién está trabajando en el tablero',
    ],
  },
  {
    slug: 'reportes-con-ia',
    title: 'Reportes ejecutivos con IA',
    icon: '📊',
    short: 'La herramienta lee tu tablero y arma el informe que hoy haces a mano.',
    seoTitle: 'Reportes de proyectos y sprint con IA | Productivity-Plus',
    seoDesc:
      'Genera reportes ejecutivos con IA: Scrum, semanal, mensual y evolutivo. Detecta tareas atascadas, prioriza el backlog y mide el aporte de cada persona.',
    answer:
      'Productivity-Plus lee tu tablero y arma el informe que normalmente escribes a mano: qué tareas están atascadas, qué riesgos aparecen, cómo va el backlog y cuánto aportó cada persona. Es el diferenciador del producto.',
    body: [
      'Armar el reporte de la semana suele robar un par de horas a quien lidera. Acá ese informe se genera solo a partir de lo que ya está en el tablero, con lenguaje claro y foco en decisiones, no en relleno.',
      'Hay cuatro reportes según lo que necesites: el Scrum caza tareas atascadas y riesgos del sprint; el semanal prioriza el backlog y mide el aporte de cada persona; el mensual da una lectura privada del equipo; y el evolutivo mide crecimiento a lo largo del tiempo y reconoce a tu gente.',
    ],
    points: [
      'Reporte Scrum: tareas atascadas y riesgos antes de que exploten',
      'Reporte semanal: prioriza el backlog y mide el aporte por persona',
      'Análisis mensual privado del equipo',
      'Reporte evolutivo: crecimiento y reconocimiento en el tiempo',
      'Se envía por correo automáticamente si lo programas',
    ],
  },
  {
    slug: 'okrs-y-metricas',
    title: 'OKRs y métricas',
    icon: '🎯',
    short: 'Conecta el trabajo diario con los objetivos y mide avance real.',
    seoTitle: 'Software de OKRs y métricas para equipos | Productivity-Plus',
    seoDesc:
      'Define OKRs, enlázalos a tareas y sprints, y mide el avance real de tu equipo con métricas claras. Software de OKRs en español para Colombia.',
    answer:
      'Con Productivity-Plus defines OKRs, los enlazas a las tareas y sprints del equipo, y las métricas te muestran avance real en vez de percepción.',
    body: [
      'Un OKR sirve de poco si vive en una hoja aparte que nadie abre. Acá los objetivos quedan pegados al trabajo real: cada tarea y sprint suma a un resultado clave, así el progreso se actualiza solo.',
      'Las métricas responden lo que un líder pregunta de verdad: cómo vamos contra lo planeado, dónde se está yendo el tiempo y qué tan cerca estamos de cerrar el objetivo del trimestre.',
    ],
    points: [
      'OKRs enlazados a tareas y sprints, no en una hoja suelta',
      'Avance calculado a partir del trabajo real del tablero',
      'Métricas de progreso, carga y cierre',
      'Super-tareas para agrupar iniciativas grandes',
    ],
  },
  {
    slug: 'gantt-y-dependencias',
    title: 'Gantt y dependencias',
    icon: '🔗',
    short: 'Ve el proyecto en el tiempo y detecta qué bloquea a qué.',
    seoTitle: 'Diagrama de Gantt y dependencias de tareas | Productivity-Plus',
    seoDesc:
      'Planea en el tiempo con diagrama de Gantt, encadena tareas con dependencias y detecta bloqueos antes de que frenen al equipo. En español.',
    answer:
      'Productivity-Plus te muestra el proyecto en una línea de tiempo con Gantt, encadena tareas con dependencias y te deja ver qué bloquea a qué antes de que frene al equipo.',
    body: [
      'Cuando un proyecto tiene varias entregas encadenadas, el tablero no alcanza para ver el orden en el tiempo. El Gantt muestra fechas, duración y qué va después de qué, de un vistazo.',
      'Las dependencias no son adorno: si una tarea se retrasa, ves de inmediato a qué otras arrastra. La red de tareas te deja seguir esa cadena y actuar antes de que se convierta en un bloqueo real.',
    ],
    points: [
      'Diagrama de Gantt con fechas y duración',
      'Dependencias entre tareas (esta va después de aquella)',
      'Red visual para seguir la cadena de bloqueos',
      'Detección temprana de lo que frena la entrega',
    ],
  },
];

export function getFeature(slug) {
  return features.find((f) => f.slug === slug);
}
