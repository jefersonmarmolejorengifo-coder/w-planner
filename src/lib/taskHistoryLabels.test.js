// El historial de cambios (TaskForm) mostraba el nombre INTERNO del campo
// tal cual llegaba de task_history.field_name (p. ej. "progressPercent: 0 →
// 12.5"), en vez de un nombre que el dueño de la tarea reconociera.

import { describe, it, expect } from 'vitest';
import { getHistoryFieldLabel } from './taskHistoryLabels';

describe('getHistoryFieldLabel', () => {
  it('traduce los campos más comunes a un nombre legible', () => {
    expect(getHistoryFieldLabel('status')).toBe('Estado');
    expect(getHistoryFieldLabel('progressPercent')).toBe('Avance');
    expect(getHistoryFieldLabel('responsible')).toBe('Responsable');
  });

  it('si no hay etiqueta registrada, muestra el nombre del campo tal cual (nunca vacío)', () => {
    expect(getHistoryFieldLabel('customField:prioridad')).toBe('customField:prioridad');
    expect(getHistoryFieldLabel('unTotalDesconocido')).toBe('unTotalDesconocido');
  });
});
