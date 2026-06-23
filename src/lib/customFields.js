// Helpers puros de campos personalizados (sin JSX). El componente visual vive en
// ./CustomFieldsRenderer.jsx. Extraídos del monolito (H-002), compartidos por
// TaskForm, FieldDefEditor y otras vistas.

// Auto fields (type='auto') derive their value from a fixed source column on
// the task row. Allowed sources are fixed in DB/UI to keep the contract tight.
export const AUTO_FIELD_SOURCES = {
  created_at:       (task) => task.createdAt || '',
  updated_at:       (task) => task.updatedAt ? new Date(task.updatedAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false }) : '',
  closed_at:        (task) => task.closedAt ? new Date(task.closedAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false }) : '',
  last_modified_by: (task) => task.lastModifiedBy || '',
};
export const AUTO_FIELD_SOURCE_LABELS = {
  created_at:       'Fecha de creación',
  updated_at:       'Última modificación',
  closed_at:        'Fecha de cierre',
  last_modified_by: 'Último usuario que modificó',
};

// Normaliza un label a una key segura (snake_case, sin acentos). Usado por FieldDefEditor.
export function slugifyKey(label) {
  return String(label || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'campo';
}

// Returns the visible value of a custom field given the task and the def.
// Used by both the form and (later) the card / CSV / report layers.
export function readCustomFieldValue(def, task) {
  if (!def) return undefined;
  if (def.type === 'auto') {
    const src = def.config?.source;
    const fn = AUTO_FIELD_SOURCES[src];
    return fn ? fn(task) : '';
  }
  const v = task?.customFields?.[def.key];
  if (v === undefined || v === null) {
    if (def.type === 'multiselect' || def.type === 'subitems') return [];
    return '';
  }
  return v;
}
