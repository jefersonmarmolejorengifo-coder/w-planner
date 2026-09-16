// Mueve un elemento de una posición a otra dentro de un array, sin mutar el
// original. Función pura compartida por las flechas subir/bajar y por el
// arrastre nativo de las subtareas en TaskForm — un solo lugar donde vive la
// lógica de "insertar aquí" para no duplicarla entre los dos caminos.
export function moveItem(arr, from, to) {
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  const max = arr.length - 1;
  // Índices fuera de rango o sin cambio real: no-op. Devolver la MISMA
  // referencia le permite al llamador detectar "no pasó nada" con `===` y
  // evitar un setState/recálculo de avance innecesario.
  if (from < 0 || from > max || to < 0 || to > max || from === to) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
