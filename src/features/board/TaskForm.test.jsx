// @vitest-environment jsdom
//
// Pruebas de COMPORTAMIENTO del debounce real de TaskSuperLinksEditor (dentro
// de TaskForm): el bug original guardaba los timers en `updateWeight._timers`,
// una propiedad de una función que se recreaba en cada render, así que nunca
// frenaba nada — cada tecla disparaba su propio UPDATE. El fix mueve los
// timers a un useRef por super-tarea. Este archivo monta TaskForm de verdad
// (no se puede probar TaskSuperLinksEditor aislado: no está exportado, y no
// se exporta solo para testear — ver CLAUDE.md del encargo) y ejerce el
// camino completo: cargar super-tareas, escribir el peso varias veces rápido,
// y comprobar cuántos UPDATE llegan al "servidor" y con qué valor.
//
// No hay @testing-library/user-event instalado: se usa fireEvent, igual que
// WeightInput.test.jsx y AuthScreen.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { ConfirmProvider } from '../../ui/ConfirmDialog';
import TaskForm from './TaskForm.jsx';

const fromMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());
const channelMock = vi.hoisted(() => vi.fn());
const removeChannelMock = vi.hoisted(() => vi.fn());
const updateCalls = vi.hoisted(() => []);

// TaskForm importa "../../supabaseClient" (dos niveles arriba de
// src/features/board/); este mock vive en el mismo archivo del test, así que
// la ruta relativa es la misma que ve TaskForm.jsx.
vi.mock('../../supabaseClient', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    auth: { getUser: (...args) => getUserMock(...args) },
    channel: (...args) => channelMock(...args),
    removeChannel: (...args) => removeChannelMock(...args),
  },
}));

// Doble mínimo del builder encadenable de PostgREST, thenable en cualquier
// punto de la cadena (select/eq/is/order/insert/update/delete), igual que lo
// necesita el código real (Promise.all sobre dos builders distintos).
function chainBuilder(resolve) {
  const state = { op: undefined, payload: undefined };
  const builder = {
    select: () => { state.op = state.op || 'select'; return builder; },
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    insert: (payload) => { state.op = 'insert'; state.payload = payload; return builder; },
    update: (payload) => { state.op = 'update'; state.payload = payload; return builder; },
    delete: () => { state.op = 'delete'; return builder; },
    then: (onFulfilled, onRejected) => resolve(state).then(onFulfilled, onRejected),
  };
  return builder;
}

function makeChannel() {
  const ch = { on: () => ch, subscribe: () => ch };
  return ch;
}

function resolverFor(table) {
  return (state) => {
    if (table === 'super_tasks') {
      return Promise.resolve({
        data: [{ id: 1, title: 'Meta X', color: '#123456', icon: '🎯', target_aporte: 10 }],
        error: null,
      });
    }
    if (table === 'task_super_links') {
      if (state.op === 'update') {
        updateCalls.push({ weight: state.payload.weight });
        return Promise.resolve({ error: null });
      }
      if (state.op === 'insert' || state.op === 'delete') {
        return Promise.resolve({ error: null });
      }
      // select: la tarea ya está enlazada a "Meta X" con peso 1.
      return Promise.resolve({ data: [{ super_task_id: 1, weight: 1 }], error: null });
    }
    if (table === 'task_comments') {
      return Promise.resolve({ data: [], error: null });
    }
    return Promise.resolve({ data: [], error: null });
  };
}

// type: 'Otra' NO sirve para este test: todo el bloque grande de TaskForm
// (indicadores, dimensiones, responsable, sprint/OKR, "Super-tareas que
// alimenta", Descripción, Bitácora, Subtareas...) vive DENTRO de un único
// `{!isOtra && (<>...</>)}` que abre en TaskForm.jsx:513 y cierra hasta
// TaskForm.jsx:898 — con type "Otra" ese fragmento entero, incluido el
// editor de super-tareas, no se dibuja nunca.
const BASE_TASK = {
  id: 42,
  createdAt: '2026-09-01',
  title: 'Tarea de prueba',
  type: 'Operativa',
  status: 'Pendiente',
  startDate: '',
  endDate: '',
  subtasks: [],
  aporteSnapshot: null,
  comments: '',
  indicators: [],
  extProgress1: '',
  extProgress2: '',
  progressPercent: 0,
  responsible: '',
  dependentTask: '',
};

function renderTaskForm() {
  return render(
    <ConfirmProvider>
      <TaskForm
        task={BASE_TASK}
        setTask={() => {}}
        participants={[]}
        indicators={[]}
        taskTypes={[]}
        currentUser={{}}
        weights={[]}
        dimensions={[]}
        projectId={7}
      />
    </ConfirmProvider>
  );
}

beforeEach(() => {
  fromMock.mockReset();
  fromMock.mockImplementation((table) => chainBuilder(resolverFor(table)));
  getUserMock.mockReset();
  getUserMock.mockResolvedValue({ data: { user: null } });
  channelMock.mockReset();
  channelMock.mockImplementation(() => makeChannel());
  removeChannelMock.mockReset();
  updateCalls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TaskSuperLinksEditor (vía TaskForm) — debounce real del peso', () => {
  it('tres cambios de peso en menos de 400ms mandan UN SOLO update, con el último valor', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderTaskForm();

    const input = await screen.findByLabelText('peso de Meta X');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.1' } });
    fireEvent.change(input, { target: { value: '0.12' } });
    fireEvent.change(input, { target: { value: '0.15' } });

    // Todavía no debería haber llegado nada al "servidor": el debounce real
    // frena hasta que pasen 400ms sin más cambios.
    expect(updateCalls).toEqual([]);

    // advanceTimersByTimeAsync (no la variante sync) también deja correr los
    // microtasks pendientes: el builder mock resuelve en dos ticks de
    // Promise (uno para invocar su `.then()`, otro para asentar la promesa
    // real), y advanceTimersByTime a secas no los drena antes del assert.
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    expect(updateCalls).toEqual([{ weight: 0.15 }]);
  });

  it('si el editor se desmonta con una escritura pendiente, el update igual llega (por diseño)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = renderTaskForm();

    const input = await screen.findByLabelText('peso de Meta X');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.4' } });

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    expect(updateCalls).toEqual([{ weight: 0.4 }]);
  });
});
