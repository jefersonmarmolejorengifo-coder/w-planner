// Nombres legibles para `task_history.field_name`. Cubre los campos que
// useTasks.js registra en su lista `tracked` al guardar una tarea (status,
// responsible, progressPercent); antes el historial de cambios de TaskForm
// mostraba el nombre interno del campo tal cual (p. ej. "progressPercent: 0
// → 12.5"). Los campos personalizados (`customField:<key>`) quedan fuera a
// propósito: su etiqueta real vive en customFieldDefs, y duplicarla aquí
// abriría una segunda fuente de verdad para mantener sincronizada.
const HISTORY_FIELD_LABELS = {
  status: 'Estado',
  responsible: 'Responsable',
  progressPercent: 'Avance',
};

// Si no hay etiqueta registrada, se muestra el nombre del campo tal cual
// llegó (nunca queda en blanco).
export const getHistoryFieldLabel = (fieldName) => HISTORY_FIELD_LABELS[fieldName] || fieldName;
