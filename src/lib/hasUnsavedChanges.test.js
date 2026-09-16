import { describe, it, expect } from 'vitest';
import { hasUnsavedChanges } from './hasUnsavedChanges';

const baseTask = {
  id: 5,
  title: 'Preparar informe',
  subtasks: [{ uid: 'a', text: 'Paso 1', done: false }],
  customFields: { prioridad: 'alta' },
  dimensionValues: { impacto: 7 },
};

describe('hasUnsavedChanges', () => {
  it('sin cambios: una copia superficial idéntica no reporta diferencias', () => {
    const original = { ...baseTask };
    const form = { ...baseTask }; // misma forma que openEdit(t): copia superficial
    expect(hasUnsavedChanges(form, original)).toBe(false);
  });

  it('detecta un cambio en un campo simple (título)', () => {
    const original = { ...baseTask };
    const form = { ...baseTask, title: 'Preparar informe final' };
    expect(hasUnsavedChanges(form, original)).toBe(true);
  });

  it('detecta un cambio dentro de subtareas aunque el resto no cambie', () => {
    const original = { ...baseTask };
    const form = {
      ...baseTask,
      subtasks: [{ uid: 'a', text: 'Paso 1', done: true }], // se marcó como hecha
    };
    expect(hasUnsavedChanges(form, original)).toBe(true);
  });

  it('detecta un cambio en campos personalizados', () => {
    const original = { ...baseTask };
    const form = { ...baseTask, customFields: { prioridad: 'baja' } };
    expect(hasUnsavedChanges(form, original)).toBe(true);
  });

  it('tarjeta nueva vacía contra sí misma: sin cambios', () => {
    const empty = { id: null, title: '', subtasks: [], customFields: {} };
    const original = { ...empty };
    const form = { ...empty };
    expect(hasUnsavedChanges(form, original)).toBe(false);
  });

  it('tarjeta nueva con título escrito: hay cambios', () => {
    const empty = { id: null, title: '', subtasks: [], customFields: {} };
    const original = { ...empty };
    const form = { ...empty, title: 'Nueva tarea' };
    expect(hasUnsavedChanges(form, original)).toBe(true);
  });

  it('sin form u original no reporta cambios (evita romper antes de abrir el modal)', () => {
    expect(hasUnsavedChanges(null, baseTask)).toBe(false);
    expect(hasUnsavedChanges(baseTask, null)).toBe(false);
    expect(hasUnsavedChanges(null, null)).toBe(false);
  });
});
