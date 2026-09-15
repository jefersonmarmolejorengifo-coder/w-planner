// @vitest-environment jsdom
//
// Bug reportado por el dueño: "el historial de cambios lo veo en cada tarea,
// pero trae detalles de otras tarjetas". Dos causas, dos pruebas centrales:
//   1) BoardTab.openNew no limpiaba el historial → la tarea NUEVA heredaba
//      el de la última tarjeta abierta.
//   2) openEdit/openFromDependencyGraph disparaban la consulta sin guarda de
//      respuesta vieja → abrir la tarjeta A y enseguida la B podía mostrar,
//      en el formulario de B, el historial de A si la respuesta de A llegaba
//      tarde.
// `useTaskHistory` numera cada petición (requestId) y descarta cualquier
// respuesta que ya no sea la más reciente. Estas pruebas simulan esa carrera
// con promesas controladas a mano (deferido()), nunca con temporizadores
// reales, para que el resultado no dependa de qué tan rápido responda la red.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useTaskHistory } from './useTaskHistory.js';

const fromMock = vi.hoisted(() => vi.fn());

// vi.mock() se hoistea sobre los imports estáticos de arriba, así que
// useTaskHistory.js ya recibe este doble de supabase al importarse.
vi.mock('../supabaseClient', () => ({
  supabase: { from: (...args) => fromMock(...args) },
}));

function deferido() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Doble mínimo del builder encadenable de PostgREST
// (select().eq().eq().order().limit()). `resolver` decide, con el task_id
// capturado, qué promesa devolver — así cada test controla cuándo "llega"
// la respuesta de cada tarea.
function chainBuilder(resolver) {
  let taskId;
  const builder = {
    select: () => builder,
    eq: (col, val) => { if (col === 'task_id') taskId = val; return builder; },
    order: () => builder,
    limit: () => resolver(taskId),
  };
  return builder;
}

beforeEach(() => {
  fromMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('useTaskHistory', () => {
  it('carga el historial de la tarea pedida', async () => {
    fromMock.mockImplementation(() => chainBuilder((taskId) =>
      Promise.resolve({
        data: [{ id: 1, task_id: taskId, field_name: 'status', old_value: 'a', new_value: 'b', changed_at: '2026-01-01' }],
        error: null,
      })
    ));
    const { result } = renderHook(() => useTaskHistory());

    await act(async () => { await result.current.load(42, 'proj-1'); });

    expect(result.current.history).toEqual([
      { id: 1, task_id: 42, field_name: 'status', old_value: 'a', new_value: 'b', changed_at: '2026-01-01' },
    ]);
    expect(fromMock).toHaveBeenCalledWith('task_history');
  });

  it('limpiar deja el historial vacío', async () => {
    fromMock.mockImplementation(() => chainBuilder(() =>
      Promise.resolve({ data: [{ id: 1, field_name: 'status' }], error: null })
    ));
    const { result } = renderHook(() => useTaskHistory());

    await act(async () => { await result.current.load(1, 'proj-1'); });
    expect(result.current.history.length).toBe(1);

    act(() => { result.current.clear(); });
    expect(result.current.history).toEqual([]);
  });

  it('ignora una respuesta vieja cuando se pidió otra tarea después (abrir A y enseguida B)', async () => {
    const deferredA = deferido();
    const deferredB = deferido();
    fromMock.mockImplementation(() => chainBuilder((taskId) => {
      if (taskId === 'A') return deferredA.promise;
      if (taskId === 'B') return deferredB.promise;
      throw new Error('taskId inesperado en el test: ' + taskId);
    }));
    const { result } = renderHook(() => useTaskHistory());

    let pA, pB;
    act(() => { pA = result.current.load('A', 'proj-1'); });
    act(() => { pB = result.current.load('B', 'proj-1'); }); // se abre B antes de que A responda

    // A responde TARDE: su dato no debe pisar nada (ya se pidió B).
    await act(async () => {
      deferredA.resolve({ data: [{ id: 1, field_name: 'status' }], error: null });
      await pA;
    });
    expect(result.current.history).toEqual([]);

    // B responde después: su dato sí se aplica.
    await act(async () => {
      deferredB.resolve({ data: [{ id: 2, field_name: 'progressPercent' }], error: null });
      await pB;
    });
    expect(result.current.history).toEqual([{ id: 2, field_name: 'progressPercent' }]);
  });

  it('la tarea nueva no hereda el historial de la tarjeta anterior', async () => {
    // Simula BoardTab: se abre la tarjeta A (dispara la carga) y, antes de
    // que responda, se hace clic en "+ Nueva tarea" (openNew llama clear()).
    const deferredA = deferido();
    fromMock.mockImplementation(() => chainBuilder(() => deferredA.promise));
    const { result } = renderHook(() => useTaskHistory());

    let pA;
    act(() => { pA = result.current.load('A', 'proj-1'); });
    act(() => { result.current.clear(); });
    expect(result.current.history).toEqual([]);

    // La respuesta tardía de A ya está invalidada: no debe repoblar el
    // formulario de la tarea nueva.
    await act(async () => {
      deferredA.resolve({ data: [{ id: 1, field_name: 'status' }], error: null });
      await pA;
    });
    expect(result.current.history).toEqual([]);
  });
});
