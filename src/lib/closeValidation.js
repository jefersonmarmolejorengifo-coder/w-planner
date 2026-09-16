// closeValidation.js — regla de "cerrar rellena su propia validación": al
// pasar una tarea a un estado de cierre (Finalizada o Cancelada), el campo
// `validationClose` se sincroniza con ese mismo estado. Antes vivía solo
// dentro de TaskForm.upd(); se extrae aquí para que el arrastre del tablero
// (BoardTab, ver src/lib/boardDrag.js) aplique EXACTAMENTE la misma regla que
// el formulario — si no, una tarjeta cerrada arrastrando quedaría con
// `validationClose` desactualizado frente a una cerrada desde el modal.

// Estados que cuentan como "cierre" de una tarjeta.
export const CLOSE_STATES = ["Finalizada", "Cancelada"];

/**
 * Aplica un cambio de `status` a una tarea. Si el nuevo estado es de cierre,
 * `validationClose` se sobrescribe con ese estado (igual que el formulario:
 * pasar de "Cancelada" a "Finalizada" también actualiza el valor, aunque ya
 * hubiera uno). Para estados que no cierran, `validationClose` no se toca.
 *
 * Función pura: no muta `task`, devuelve una copia.
 *
 * @param {object} task - tarea actual
 * @param {string} newStatus - nuevo valor de `status`
 * @returns {object} copia de `task` con `status` (y `validationClose` si aplica)
 */
export function applyStatusChange(task, newStatus) {
  const next = { ...task, status: newStatus };
  if (CLOSE_STATES.includes(newStatus)) next.validationClose = newStatus;
  return next;
}
