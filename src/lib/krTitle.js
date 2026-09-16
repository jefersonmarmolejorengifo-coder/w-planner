// Resuelve el título del resultado clave (OKR) al que aporta una tarea, para
// pintarlo en su tarjeta del tablero. Funciones puras y sin React: BoardTab
// arma el mapa UNA sola vez con useMemo y le pasa a cada TaskCard solo el
// string ya resuelto — pasarle el arreglo `keyResults` completo a cada
// tarjeta memoizada (`memo`) rompería esa memoización en cada render, porque
// el arreglo cambia de identidad aunque su contenido sea el mismo.

// Mapa id -> título, para resolver el de cada tarea en O(1) sin recorrer el
// arreglo de resultados clave una vez por tarjeta.
export function buildKrTitleMap(keyResults) {
  const map = {};
  (keyResults || []).forEach((kr) => {
    if (kr && kr.id != null) map[kr.id] = kr.title || '';
  });
  return map;
}

// Título del resultado clave de una tarea, o null si la tarea no aporta a
// ninguno o si el resultado clave ya no existe (se borró después de
// vincularse). null (no string vacío) para que la tarjeta decida no pintar
// nada en vez de una etiqueta vacía.
export function resolveKrTitle(krId, krTitleById) {
  if (krId == null) return null;
  const title = (krTitleById || {})[krId];
  return title != null ? title : null;
}
