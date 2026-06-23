// Constantes compartidas extraídas del monolito (H-002) para poder reutilizarlas
// entre módulos sin acoplar a ProductivityPlus.jsx.

// Etiqueta legible por tipo de reporte de IA. La usan el dashboard consolidado y
// la pastilla de resumen del tablero.
export const REPORT_TYPE_LABEL = {
  scrum: "Scrum",
  weekly_po: "Semanal PO",
  monthly_team: "Mensual Equipo",
};

// Colores por estado de tarea (sólido y claro). Compartidos por el tablero, las
// métricas, la red de tareas y los sprints.
export const STATUS_COLORS = {
  "No programada": "#969696",
  "Sin iniciar":   "#542c9c",
  "En proceso":    "#ec6c04",
  "Bloqueada":     "#c0392b",
  "En pausa":      "#149cac",
  "Cancelada":     "#969696",
  "Finalizada":    "#27ae60",
};
export const STATUS_LIGHT = {
  "No programada": "#f4f4f4",
  "Sin iniciar":   "#ede8f8",
  "En proceso":    "#fff3ea",
  "Bloqueada":     "#fde8e8",
  "En pausa":      "#e6f7f8",
  "Cancelada":     "#f4f4f4",
  "Finalizada":    "#e8f8ee",
};

// Tipos de tarea y estados base (compartidos por tablero, formulario, métricas…).
export const TIPOS = ["Administrativa", "Operativa", "Apadrinamiento", "Seguimiento", "Creativa", "Otra"];
export const DEFAULT_TASK_TYPES = [...TIPOS];
export const ESTADOS = ["No programada", "Sin iniciar", "En proceso", "Bloqueada", "En pausa", "Cancelada", "Finalizada"];
