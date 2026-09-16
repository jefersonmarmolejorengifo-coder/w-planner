// boardDrag.js — decide qué pasa cuando se suelta una tarjeta del tablero
// sobre una columna (arrastre nativo del navegador, ver BoardTab.jsx). Se
// extrae como función pura para poder probarla sin simular eventos de
// arrastre reales ni montar el DOM.
import { ESTADOS } from "../constants";
import { applyStatusChange } from "./closeValidation";

/**
 * Resuelve el resultado de soltar `task` sobre la columna `targetStatus`.
 *
 * @param {object|null} task - tarea arrastrada
 * @param {string} targetStatus - estado de la columna donde se soltó
 * @returns {object|null} la tarea con el nuevo `status` (y `validationClose`
 *   si el destino es un estado de cierre — ver closeValidation.js), o `null`
 *   si no hay que escribir nada:
 *   - se soltó sobre su propia columna (no-op), o
 *   - `targetStatus` no es uno de los 7 estados del tablero. BoardTab agrupa
 *     las tarjetas con `if (g[t.status])`: una tarea con un status fuera de
 *     ESTADOS desaparecería del tablero en silencio, así que nunca se asigna
 *     un destino que no esté en esa lista.
 */
export function resolveTaskDrop(task, targetStatus) {
  if (!task || !ESTADOS.includes(targetStatus)) return null;
  if (task.status === targetStatus) return null;
  return applyStatusChange(task, targetStatus);
}
