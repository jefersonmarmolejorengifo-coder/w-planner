// moveItem es la base de reordenar subtareas (flechas + arrastre nativo, ver
// TaskForm.jsx). Se prueba aislada porque es la pieza que decide "a dónde va
// a parar" el elemento: cualquier error aquí se ve como una subtarea que
// desaparece o se duplica en pantalla.
import { describe, it, expect } from 'vitest';
import { moveItem } from './reorder.js';

describe('moveItem', () => {
  it('mueve un elemento al medio del array', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('mueve un elemento al principio', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('mueve un elemento al final', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('con índices iguales no cambia el orden (y devuelve la misma referencia)', () => {
    const arr = ['a', 'b', 'c'];
    expect(moveItem(arr, 1, 1)).toBe(arr);
  });

  it('con un índice de destino fuera de rango devuelve el array sin tocar', () => {
    const arr = ['a', 'b'];
    expect(moveItem(arr, 0, 5)).toBe(arr);
  });

  it('con un índice de origen negativo devuelve el array sin tocar', () => {
    const arr = ['a', 'b'];
    expect(moveItem(arr, -1, 1)).toBe(arr);
  });

  it('con un array vacío no revienta', () => {
    expect(moveItem([], 0, 1)).toEqual([]);
  });

  it('no muta el array original', () => {
    const arr = ['a', 'b', 'c'];
    moveItem(arr, 0, 2);
    expect(arr).toEqual(['a', 'b', 'c']);
  });
});
