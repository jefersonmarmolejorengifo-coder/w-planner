// Cálculo del avance de un resultado clave (KR) de un OKR.
//
// Antes, vincular tareas a un KR volvía su avance todo-o-nada: se medía como
// el % de tareas "Finalizada" sobre el total enlazado (ver git blame de
// OKRsTab.jsx). Eso obligaba a partir el trabajo en muchas tareas chiquitas
// (o inventar subtareas) solo para que la barra se moviera un poco.
//
// Ahora el avance es el PROMEDIO del avance real de cada tarea enlazada, así
// una sola tarea larga refleja su progreso parcial en el KR sin necesidad de
// trocearla.

// Tareas enlazadas a un KR que cuentan para el promedio.
// Las "Cancelada" se excluyen por completo (ni suman ni castigan el avance):
// un trabajo que se decidió no hacer no debería bajar el resultado clave.
export function getCountableLinkedTasks(kr, tasks) {
  return (tasks || []).filter((t) => t.krId === kr.id && t.status !== 'Cancelada');
}

// Avance de un KR, en el rango 0-100.
export function calcKrProgress(kr, tasks) {
  const countable = getCountableLinkedTasks(kr, tasks);

  // Sin tareas que contar (no hay ninguna enlazada, o TODAS las enlazadas
  // están canceladas): el KR se comporta como si no tuviera tareas y se usa
  // el cálculo manual de siempre (current_value / target_value).
  if (countable.length === 0) {
    const target = Number(kr.target_value);
    if (!(target > 0)) return 0;
    return clampPct((Number(kr.current_value) / target) * 100);
  }

  const suma = countable.reduce((acc, t) => {
    // Finalizada cuenta 100 sin importar el progressPercent que traiga
    // guardado (puede haber quedado desactualizado antes de cerrarla).
    if (t.status === 'Finalizada') return acc + 100;
    const p = Number(t.progressPercent);
    return acc + (Number.isFinite(p) ? p : 0);
  }, 0);

  return clampPct(suma / countable.length);
}

function clampPct(value) {
  return Math.max(0, Math.min(100, value));
}
