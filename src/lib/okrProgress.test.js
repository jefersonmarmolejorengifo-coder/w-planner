// Fija el contrato del avance de un KR (ver okrProgress.js para el porqué
// completo): promedio del avance real de las tareas enlazadas, no todo-o-nada.

import { describe, it, expect } from 'vitest';
import { calcKrProgress } from './okrProgress';

const kr = (overrides = {}) => ({ id: 1, target_value: 100, current_value: 0, ...overrides });
const task = (overrides = {}) => ({ krId: 1, status: 'En proceso', progressPercent: 0, ...overrides });

describe('calcKrProgress', () => {
  it('sin tareas enlazadas, cae al cálculo manual current_value/target_value', () => {
    expect(calcKrProgress(kr({ current_value: 40, target_value: 100 }), [])).toBe(40);
  });

  it('una tarea enlazada al 50% de avance da 50', () => {
    const tasks = [task({ progressPercent: 50 })];
    expect(calcKrProgress(kr(), tasks)).toBe(50);
  });

  it('tres tareas 100/50/0 promedian 50', () => {
    const tasks = [
      task({ status: 'Finalizada', progressPercent: 100 }),
      task({ progressPercent: 50 }),
      task({ progressPercent: 0 }),
    ];
    expect(calcKrProgress(kr(), tasks)).toBe(50);
  });

  it('una tarea Finalizada cuenta 100 aunque su progressPercent guardado diga otra cosa', () => {
    const tasks = [task({ status: 'Finalizada', progressPercent: 30 })];
    expect(calcKrProgress(kr(), tasks)).toBe(100);
  });

  it('una tarea Cancelada se excluye del promedio (ni suma ni castiga)', () => {
    const tasks = [
      task({ progressPercent: 50 }),
      task({ status: 'Cancelada', progressPercent: 0 }),
    ];
    expect(calcKrProgress(kr(), tasks)).toBe(50);
  });

  it('si TODAS las tareas enlazadas están canceladas, se comporta como si no hubiera tareas', () => {
    const tasks = [
      task({ status: 'Cancelada', progressPercent: 90 }),
      task({ status: 'Cancelada', progressPercent: 10 }),
    ];
    expect(calcKrProgress(kr({ current_value: 25, target_value: 100 }), tasks)).toBe(25);
  });

  it('progressPercent ausente cuenta como 0', () => {
    const tasks = [task({ progressPercent: undefined })];
    expect(calcKrProgress(kr(), tasks)).toBe(0);
  });

  it('progressPercent con texto no numérico cuenta como 0', () => {
    const tasks = [task({ progressPercent: 'no aplica' })];
    expect(calcKrProgress(kr(), tasks)).toBe(0);
  });

  it('el resultado queda acotado a 0-100 aunque el cálculo manual se pase', () => {
    expect(calcKrProgress(kr({ current_value: 150, target_value: 100 }), [])).toBe(100);
    expect(calcKrProgress(kr({ current_value: -20, target_value: 100 }), [])).toBe(0);
  });
});
