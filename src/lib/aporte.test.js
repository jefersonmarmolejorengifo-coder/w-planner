import { describe, it, expect } from 'vitest';
import { calcAporte, calcProgressFromSubtasks } from './aporte';

describe('calcAporte (dimensiones como array)', () => {
  const dims = [
    { key: 'tiempo', weight: 33 },
    { key: 'dificultad', weight: 34 },
    { key: 'estrategico', weight: 33 },
  ];

  it('pondera las tres dimensiones built-in y divide entre 100', () => {
    const task = { estimatedTime: 5, difficulty: 5, strategicValue: 5 };
    // (5*33 + 5*34 + 5*33) / 100 = 500/100 = 5
    expect(calcAporte(task, dims)).toBeCloseTo(5, 10);
  });

  it('usa 1 como mínimo cuando un valor es 0 o ausente', () => {
    const task = { estimatedTime: 0, difficulty: undefined, strategicValue: null };
    // todos caen a 1: (1*33 + 1*34 + 1*33)/100 = 1
    expect(calcAporte(task, dims)).toBeCloseTo(1, 10);
  });

  it('lee dimensiones custom desde dimensionValues con default 5', () => {
    const customDims = [{ key: 'impacto', weight: 100 }];
    expect(calcAporte({ dimensionValues: { impacto: 8 } }, customDims)).toBeCloseTo(8, 10);
    // sin valor → default 5
    expect(calcAporte({ dimensionValues: {} }, customDims)).toBeCloseTo(5, 10);
  });

  it('ignora pesos faltantes (weight ausente cuenta como 0)', () => {
    const task = { estimatedTime: 10, difficulty: 10, strategicValue: 10 };
    expect(calcAporte(task, [{ key: 'tiempo' }])).toBeCloseTo(0, 10);
  });
});

describe('calcAporte (objeto legacy {tiempo,dificultad,estrategico})', () => {
  it('replica la fórmula legacy', () => {
    const task = { estimatedTime: 4, difficulty: 6, strategicValue: 8 };
    const weights = { tiempo: 33, dificultad: 34, estrategico: 33 };
    // (4*33 + 6*34 + 8*33)/100 = (132+204+264)/100 = 6
    expect(calcAporte(task, weights)).toBeCloseTo(6, 10);
  });

  it('aplica el piso de 1 también en modo legacy', () => {
    const weights = { tiempo: 50, dificultad: 50, estrategico: 0 };
    // estimatedTime 0→1, difficulty 0→1: (1*50 + 1*50)/100 = 1
    expect(calcAporte({ estimatedTime: 0, difficulty: 0 }, weights)).toBeCloseTo(1, 10);
  });
});

describe('calcProgressFromSubtasks', () => {
  it('retorna null sin subtareas (modo manual)', () => {
    expect(calcProgressFromSubtasks([])).toBeNull();
    expect(calcProgressFromSubtasks(undefined)).toBeNull();
    expect(calcProgressFromSubtasks(null)).toBeNull();
  });

  it('calcula el porcentaje completado', () => {
    expect(calcProgressFromSubtasks([{ done: true }, { done: false }])).toBe(50);
    expect(calcProgressFromSubtasks([{ done: true }, { done: true }, { done: true }])).toBe(100);
  });

  it('redondea a un decimal', () => {
    // 1/3 = 33.333… → 33.3
    expect(calcProgressFromSubtasks([{ done: true }, { done: false }, { done: false }])).toBe(33.3);
  });
});
