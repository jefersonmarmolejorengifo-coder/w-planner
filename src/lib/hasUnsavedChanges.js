// hasUnsavedChanges.js — detecta si el formulario de una tarjeta tiene algo
// que perder frente a su estado original (H-0XX, "salir de la tarjeta guarda").
//
// openEdit copia la tarea con `{ ...t }` (copia superficial): los campos
// anidados (subtasks, customFields, dimensionValues, indicators) comparten
// referencia con la tarea original hasta que el usuario los edita — TaskForm
// siempre reemplaza esos campos con un arreglo/objeto NUEVO al editarlos
// (nunca los muta en el sitio), así que la comparación por VALOR (JSON
// estable, claves ordenadas) es la única forma correcta de detectar cambios:
// una copia sin ediciones debe leerse como "sin cambios" aunque sea un
// objeto distinto, y un campo editado debe detectarse aunque el resto del
// formulario siga compartiendo referencia con el original.

function stableStringify(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compara el formulario actual de una tarjeta contra su estado original
 * (la tarea tal cual estaba al abrir el modal, o una tarjeta vacía si es
 * "Nueva tarea"). Devuelve true si hay algo sin guardar.
 *
 * @param {object|null} form - estado actual del formulario (BoardTab.form)
 * @param {object|null} original - snapshot tomado al abrir el modal
 * @returns {boolean}
 */
export function hasUnsavedChanges(form, original) {
  if (!form || !original) return false;
  return stableStringify(form) !== stableStringify(original);
}
