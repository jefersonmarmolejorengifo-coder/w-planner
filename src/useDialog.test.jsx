// @vitest-environment jsdom
//
// Pruebas de la pila de Escape entre diálogos de useDialog.js.
// Antes, cada instancia del hook registraba su propio listener de 'keydown'
// en `document` (fase de captura), así que con DOS diálogos montados a la
// vez (p. ej. la tarjeta + "¿Descartar los cambios?" encima) una sola
// pulsación de Escape disparaba los DOS onClose: stopPropagation() no calla
// a otros listeners del MISMO nodo. El fix agrega `openDialogStack` a nivel
// de módulo: cada instancia se apila con una identidad propia al montarse y
// solo reacciona a Escape si es la última de la pila.
//
// No se usa @testing-library/jest-dom (no está en las dependencias de este
// repo): las aserciones se hacen con vi.fn()/toHaveBeenCalledTimes y
// propiedades nativas del DOM, igual que TaskForm.test.jsx y
// AuthScreen.test.jsx.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { useDialog } from './useDialog';

afterEach(() => {
  cleanup();
});

// Componente mínimo que usa el hook tal como lo usan los 6 diálogos reales
// (NameCaptureModal, PlanSelectionModal, ConfirmDialog, SuperTaskCreatorModal,
// el Modal del tablero y BoardSummaryPill): un contenedor con tabIndex={-1},
// role="dialog" y aria-modal="true".
function Dialog({ onClose, testId }) {
  const ref = useDialog(onClose);
  return <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" data-testid={testId} />;
}

// Varios diálogos identificados por `id`, con onClose independiente por id.
// Usar `key={id}` (no la posición) es lo que le permite a React distinguir
// "se agregó/quitó un diálogo" de "se reordenaron los mismos", y así montar y
// desmontar exactamente la instancia esperada al cambiar `ids` entre renders.
function MultiDialog({ ids, onCloseById }) {
  return (
    <>
      {ids.map((id) => (
        <Dialog key={id} testId={id} onClose={() => onCloseById[id]()} />
      ))}
    </>
  );
}

function pressEscape() {
  fireEvent.keyDown(document, { key: 'Escape' });
}

function pressKey(key) {
  fireEvent.keyDown(document, { key });
}

describe('useDialog — pila de Escape entre diálogos', () => {
  it('caso feliz: un solo diálogo, Escape llama a su onClose una vez (comportamiento de 5 de las 6 pantallas, sin cambios)', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} testId="solo" />);

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fallo esperado: otras teclas (Enter, letra, Tab) no disparan onClose', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} testId="solo" />);

    pressKey('Enter');
    pressKey('a');
    pressKey('Tab'); // Tab activa la trampa de foco, no el cierre.

    expect(onClose).not.toHaveBeenCalled();
  });

  it('dos diálogos montados: Escape llama SOLO al onClose del último montado; el de abajo no se entera y sigue montado', () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const { rerender } = render(
      <MultiDialog ids={['A']} onCloseById={{ A: onCloseA }} />
    );

    // B se monta DESPUÉS de A, como la confirmación que aparece encima de la tarjeta.
    rerender(
      <MultiDialog ids={['A', 'B']} onCloseById={{ A: onCloseA, B: onCloseB }} />
    );

    pressEscape();

    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();
    expect(screen.getByTestId('A')).toBeTruthy();
    expect(screen.getByTestId('B')).toBeTruthy();
  });

  it('después de desmontar el de encima, Escape vuelve a cerrar el de abajo (la pila se limpia de verdad)', () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const { rerender } = render(
      <MultiDialog ids={['A', 'B']} onCloseById={{ A: onCloseA, B: onCloseB }} />
    );

    // Se desmonta B, como cuando la confirmación ya se resolvió.
    rerender(<MultiDialog ids={['A']} onCloseById={{ A: onCloseA, B: onCloseB }} />);

    pressEscape();

    expect(onCloseA).toHaveBeenCalledTimes(1);
    expect(onCloseB).not.toHaveBeenCalled();
  });

  it('tres diálogos: Escape solo cierra el tercero (el último) — no es un caso especial de dos', () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const onCloseC = vi.fn();
    const onCloseById = { A: onCloseA, B: onCloseB, C: onCloseC };
    const { rerender } = render(<MultiDialog ids={['A']} onCloseById={onCloseById} />);

    rerender(<MultiDialog ids={['A', 'B']} onCloseById={onCloseById} />);
    rerender(<MultiDialog ids={['A', 'B', 'C']} onCloseById={onCloseById} />);

    pressEscape();

    expect(onCloseC).toHaveBeenCalledTimes(1);
    expect(onCloseB).not.toHaveBeenCalled();
    expect(onCloseA).not.toHaveBeenCalled();
  });

  it('caso límite: desmontar el de ABAJO primero (orden raro con renders condicionales) — el de encima sigue respondiendo a Escape', () => {
    const onCloseA = vi.fn();
    const onCloseB = vi.fn();
    const onCloseById = { A: onCloseA, B: onCloseB };
    const { rerender } = render(<MultiDialog ids={['A', 'B']} onCloseById={onCloseById} />);

    // Se desmonta A (el de abajo) mientras B (el de encima) sigue abierto.
    rerender(<MultiDialog ids={['B']} onCloseById={onCloseById} />);

    pressEscape();

    expect(onCloseB).toHaveBeenCalledTimes(1);
    expect(onCloseA).not.toHaveBeenCalled();
  });
});
