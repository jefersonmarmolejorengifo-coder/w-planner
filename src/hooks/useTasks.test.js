// @vitest-environment jsdom
//
// Verifica la opción `skipAporteRecalc` de updateTask (la usa EXCLUSIVAMENTE
// el arrastre del tablero, ver BoardTab.jsx): sin ella, aporte_snapshot sigue
// recalculándose con los pesos vigentes como siempre (guardado desde el
// formulario); con ella, el valor histórico que traía la tarea viaja intacto
// a la base — arrastrar una tarjeta no puede mover el jarrón de aporte de las
// super-tareas.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTasks } from './useTasks.js';

const fromMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('../supabaseClient', () => ({
  supabase: { from: (...args) => fromMock(...args) },
}));
vi.mock('../ui/Toast', () => ({
  useToast: () => toastMock,
}));

// Doble mínimo de supabase.from('tasks').update(dbTask).eq('id', id).select().
// projectId y updatedAt vienen vacíos en las tareas de prueba, así que
// updateTask solo encadena UN `.eq()` — ver useTasks.js.
function updateChain(dbTaskCapturado, respuesta) {
  return {
    update: (dbTask) => {
      Object.assign(dbTaskCapturado, dbTask);
      return { eq: () => ({ select: () => Promise.resolve(respuesta) }) };
    },
  };
}

beforeEach(() => {
  fromMock.mockReset();
  toastMock.mockReset();
});

const DIMENSIONS = [
  { key: 'tiempo', label: 'Tiempo estimado', weight: 33, builtin: true },
  { key: 'dificultad', label: 'Dificultad', weight: 34, builtin: true },
  { key: 'estrategico', label: 'Valor estratégico', weight: 33, builtin: true },
];

const baseTask = {
  id: 1, title: 'X', status: 'En proceso', estimatedTime: 10, difficulty: 10,
  strategicValue: 10, aporteSnapshot: 5, subtasks: [], indicators: [], customFields: {},
  dimensionValues: {}, validationClose: null, updatedAt: null,
};

describe('useTasks.updateTask — opción skipAporteRecalc', () => {
  it('sin la opción, recalcula aporte_snapshot con los pesos vigentes (comportamiento de siempre)', async () => {
    const dbTaskCapturado = {};
    fromMock.mockImplementation(() => updateChain(dbTaskCapturado, { data: [{ updated_at: '2026-01-01' }], error: null }));
    const { result } = renderHook(() => useTasks({ projectId: null, dimensions: DIMENSIONS, hasCustomFieldsSchema: true, activeUser: null, taskFieldDefs: [] }));

    await act(async () => { await result.current.updateTask({ ...baseTask }); });

    // (10*33 + 10*34 + 10*33) / 100 = 10, distinto del snapshot original (5):
    // si esto fallara silenciosamente, no distinguiría "recalculó" de "no tocó nada".
    expect(dbTaskCapturado.aporte_snapshot).toBe(10);
  });

  it('con skipAporteRecalc, NO toca aporte_snapshot (lo usa el arrastre del tablero)', async () => {
    const dbTaskCapturado = {};
    fromMock.mockImplementation(() => updateChain(dbTaskCapturado, { data: [{ updated_at: '2026-01-01' }], error: null }));
    const { result } = renderHook(() => useTasks({ projectId: null, dimensions: DIMENSIONS, hasCustomFieldsSchema: true, activeUser: null, taskFieldDefs: [] }));

    await act(async () => { await result.current.updateTask({ ...baseTask, status: 'Bloqueada' }, { skipAporteRecalc: true }); });

    // El snapshot histórico (5) queda intacto, no el recalculado (10).
    expect(dbTaskCapturado.aporte_snapshot).toBe(5);
  });
});
