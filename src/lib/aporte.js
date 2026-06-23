// Lógica pura del cálculo de aporte y de progreso. Extraída del monolito
// ProductivityPlus.jsx para poder testearla de forma aislada (H-003) y como
// primer paso de la descomposición por dominio (H-002).
//
// IMPORTANTE: el aporte es un snapshot (ver modelo de la calculadora): cambiar
// los pesos NO recalcula el histórico. Esta función solo computa el valor actual.

// Dimensiones de aporte por defecto (las 3 builtin). Compartidas por la
// calculadora, las plantillas y el DimensionEditor. H-002.
export const DEFAULT_DIMENSIONS = [
  { key: "tiempo",      label: "Tiempo estimado",   weight: 33, builtin: true },
  { key: "dificultad",  label: "Dificultad",         weight: 34, builtin: true },
  { key: "estrategico", label: "Valor estratégico",  weight: 33, builtin: true },
];

// ─── calcAporte ────────────────────────────────────────────
// Soporta tanto dimensiones como array como el objeto legacy
// {tiempo, dificultad, estrategico}.
export const calcAporte = (task, weights) => {
  if (Array.isArray(weights)) {
    return weights.reduce((sum, dim) => {
      const val = dim.key === 'tiempo'      ? (task.estimatedTime  || 1)
                : dim.key === 'dificultad'  ? (task.difficulty     || 1)
                : dim.key === 'estrategico' ? (task.strategicValue || 1)
                : (task.dimensionValues?.[dim.key] ?? 5);
      return sum + val * (dim.weight || 0);
    }, 0) / 100;
  }
  return ((task.estimatedTime || 1) * (weights.tiempo      || 0) +
          (task.difficulty    || 1) * (weights.dificultad  || 0) +
          (task.strategicValue|| 1) * (weights.estrategico || 0)) / 100;
};

/**
 * Calcula el porcentaje de avance basado en subtareas.
 * Retorna null si no hay subtareas (modo manual).
 */
export const calcProgressFromSubtasks = (subtasks) => {
  if (!subtasks || subtasks.length === 0) return null;
  const done = subtasks.filter((s) => s.done).length;
  return parseFloat(((done / subtasks.length) * 100).toFixed(1));
};
