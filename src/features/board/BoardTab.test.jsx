// @vitest-environment jsdom
//
// Ajuste 1 (UX, ALTO): candado contra doble guardado al cerrar la tarjeta.
// Antes de este arreglo, `closeAttempt` llamaba a `save()` sin nada que
// impidiera una segunda llamada mientras la primera seguía en vuelo. Con
// conexión lenta, un doble clic en la X o un Escape repetido (la tecla
// repite sola si se mantiene) reservaba DOS ids con `claim_task_id` e
// insertaba dos tareas duplicadas — sin ningún error visible.
//
// Este test simula justo esa condición de carrera: deja la escritura
// (`createTask`) colgada a propósito y dispara el cierre dos veces seguidas,
// de forma síncrona, antes de que la primera termine. Sin el candado
// (`savingRef` + `saving` en BoardTab.jsx), la segunda llamada reservaría su
// propio id y crearía una segunda tarea — este test debe FALLAR si el
// candado se quita (ver instrucción de verificación al cierre del encargo).
//
// No hay @testing-library/user-event instalado: se usa fireEvent, igual que
// TaskForm.test.jsx y AuthScreen.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { ToastProvider } from '../../ui/Toast';
import { ConfirmProvider } from '../../ui/ConfirmDialog';
import BoardTab from './BoardTab.jsx';

// Este repo no tiene @testing-library/jest-dom instalado (sin matchers como
// toBeInTheDocument): se usa toBeNull()/toBeTruthy() sobre queryBy*, igual
// que TaskForm.test.jsx y WeightInput.test.jsx.
afterEach(() => {
  cleanup();
});

const fromMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

// BoardTab importa "../../supabaseClient" (dos niveles arriba de
// src/features/board/), igual que TaskForm — mismo patrón de mock.
vi.mock('../../supabaseClient', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    rpc: (...args) => rpcMock(...args),
  },
}));

// Doble mínimo del builder encadenable de PostgREST, thenable en cualquier
// punto de la cadena — mismo patrón que TaskForm.test.jsx.
function chainBuilder(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  fromMock.mockImplementation(() => chainBuilder({ data: [], error: null }));
  rpcMock.mockResolvedValue({ data: 999, error: null }); // claim_task_id
});

// projectId se omite a propósito (como en renderSubtasksForm de
// TaskForm.test.jsx): sin él, TaskSuperLinksEditor y TaskCommentsThread no se
// montan y el test queda enfocado solo en el candado de guardado.
function renderBoard(overrides = {}) {
  const props = {
    tasks: [],
    createTask: vi.fn().mockResolvedValue(true),
    updateTask: vi.fn().mockResolvedValue(true),
    deleteTask: vi.fn().mockResolvedValue(true),
    participants: [],
    indicators: [],
    currentUser: {},
    weights: [],
    taskTypes: [],
    dimensions: [],
    ...overrides,
  };
  render(
    <ToastProvider>
      <ConfirmProvider>
        <BoardTab {...props} />
      </ConfirmProvider>
    </ToastProvider>
  );
  return props;
}

describe('BoardTab — candado contra doble guardado al cerrar (Ajuste 1)', () => {
  it('Escape repetido mientras el primer guardado sigue en vuelo solo crea UNA tarea', async () => {
    let resolveCreate;
    const createTask = vi.fn(() => new Promise((resolve) => { resolveCreate = resolve; }));
    renderBoard({ createTask });

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva tarea' }));
    fireEvent.change(screen.getByPlaceholderText('Descripción breve...'), { target: { value: 'Tarea de prueba' } });

    // Escape (no un clic en el botón X): useDialog escucha 'keydown' en
    // `document`, un camino que NO pasa por el atributo `disabled` del botón
    // — así la prueba ataca de verdad el candado (`savingRef`), no el efecto
    // colateral de que React ya haya deshabilitado el botón entre un clic y
    // el siguiente. Dos Escape SIN await entre medio simulan la tecla
    // repitiéndose sola al mantenerla presionada: el segundo debe llegar
    // antes de que la promesa de createTask del primero se resuelva.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    // El candado también corta antes de reservar un segundo id.
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // Deja que la escritura en vuelo termine y confirma que sigue en 1: nadie
    // quedó encolado esperando para disparar una segunda escritura.
    await act(async () => { resolveCreate(true); });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull());
    expect(createTask).toHaveBeenCalledTimes(1);
  });

  it('mientras guarda, el pie muestra "Guardando…" deshabilitado; al terminar avisa con un toast', async () => {
    let resolveCreate;
    const createTask = vi.fn(() => new Promise((resolve) => { resolveCreate = resolve; }));
    renderBoard({ createTask });

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva tarea' }));
    fireEvent.change(screen.getByPlaceholderText('Descripción breve...'), { target: { value: 'Tarea de prueba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    // El estado "guardando" se activa de forma síncrona (antes del await a la
    // RPC), así que el botón cambia de texto en el siguiente render.
    const savingBtn = await screen.findByRole('button', { name: 'Guardando…' });
    expect(savingBtn.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Descartar' }).disabled).toBe(true);

    await act(async () => { resolveCreate(true); });

    // Ajuste 3: cerrar SÍ guardó, y ahora lo dice.
    await waitFor(() => expect(screen.getByText('Tarjeta guardada')).toBeTruthy());
  });

  it('abrir y cerrar sin escribir nada no guarda ni avisa con ningún toast', async () => {
    renderBoard();

    fireEvent.click(screen.getByRole('button', { name: '+ Nueva tarea' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull());
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.queryByText('Tarjeta guardada')).toBeNull();
  });
});
