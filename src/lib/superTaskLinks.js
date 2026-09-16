// Construye las filas de task_super_links a partir del id de una tarea recién
// creada y del mapa de enlaces pendientes { [superTaskId]: weight } que arma
// TaskSuperLinksEditor en memoria mientras la tarjeta todavía no existe en la
// base (task_super_links.task_id tiene FK a tasks, así que no se puede
// escribir ahí antes de crear la tarea). Pura y sin Supabase para poder
// probarla aparte del componente — la usa BoardTab justo después de
// createTask() (ver save() en BoardTab.jsx).
export function buildSuperLinkRows(taskId, pendingLinks) {
  if (taskId == null || !pendingLinks) return [];
  return Object.entries(pendingLinks).map(([superTaskId, weight]) => ({
    task_id: taskId,
    // Las claves de un objeto JS siempre son string; super_task_id es bigint
    // en Postgres, así que hay que devolverlo a número.
    super_task_id: Number(superTaskId),
    weight,
  }));
}
