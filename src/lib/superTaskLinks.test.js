import { describe, it, expect } from 'vitest';
import { buildSuperLinkRows } from './superTaskLinks.js';

describe('buildSuperLinkRows', () => {
  it('arma una fila por cada super-tarea pendiente, con el id de la tarea recién creada', () => {
    const rows = buildSuperLinkRows(42, { 1: 0.5, 3: 1 });
    expect(rows).toEqual([
      { task_id: 42, super_task_id: 1, weight: 0.5 },
      { task_id: 42, super_task_id: 3, weight: 1 },
    ]);
  });

  it('sin enlaces pendientes devuelve un arreglo vacío (no dispara un insert vacío)', () => {
    expect(buildSuperLinkRows(42, {})).toEqual([]);
  });

  it('sin id de tarea (defensivo) no arma nada', () => {
    expect(buildSuperLinkRows(null, { 1: 1 })).toEqual([]);
  });

  it('sin mapa de enlaces (defensivo) no arma nada', () => {
    expect(buildSuperLinkRows(42, null)).toEqual([]);
  });

  it('convierte las claves del mapa (string por ser propiedades de objeto) a número', () => {
    const rows = buildSuperLinkRows(7, { '10': 0.25 });
    expect(rows[0].super_task_id).toBe(10);
    expect(typeof rows[0].super_task_id).toBe('number');
  });
});
