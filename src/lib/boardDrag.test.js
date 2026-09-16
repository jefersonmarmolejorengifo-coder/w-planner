import { describe, it, expect } from 'vitest';
import { resolveTaskDrop } from './boardDrag.js';

const task = (status) => ({ id: 1, status, validationClose: null });

describe('resolveTaskDrop', () => {
  it('soltar sobre su misma columna no hace nada', () => {
    expect(resolveTaskDrop(task('En proceso'), 'En proceso')).toBeNull();
  });

  it('soltar sobre una columna distinta devuelve la tarea con el nuevo estado', () => {
    expect(resolveTaskDrop(task('Sin iniciar'), 'En proceso')).toEqual({
      id: 1, status: 'En proceso', validationClose: null,
    });
  });

  it('soltar sobre una columna de cierre también rellena validationClose (misma regla del formulario)', () => {
    expect(resolveTaskDrop(task('En proceso'), 'Finalizada')).toEqual({
      id: 1, status: 'Finalizada', validationClose: 'Finalizada',
    });
  });

  it('un estado desconocido (fuera de los 7 del tablero) no hace nada', () => {
    expect(resolveTaskDrop(task('En proceso'), 'Archivada')).toBeNull();
  });

  it('sin tarea, no hace nada', () => {
    expect(resolveTaskDrop(null, 'En proceso')).toBeNull();
  });
});
