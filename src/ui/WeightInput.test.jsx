// @vitest-environment jsdom
//
// Pruebas de COMPORTAMIENTO de WeightInput (fix del peso que no dejaba
// escribir en "Super-tareas que alimenta"). src/lib/superTaskWeight.test.js
// ya fija el parseo/formato puro; este archivo monta el componente de
// verdad y ejerce lo que hace una persona tecleando.
//
// No hay @testing-library/user-event instalado (ver package.json): se usa
// fireEvent, igual que src/screens/AuthScreen.test.jsx.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WeightInput from './WeightInput';

afterEach(() => {
  cleanup();
});

// Envoltorio controlado: así es como lo usan TaskForm y SuperTaskCreatorModal
// de verdad (el padre guarda `value` en su propio estado y se lo devuelve al
// componente), para ejercer también el efecto de sincronización.
function Controlled({ initial, onCommit }) {
  const [value, setValue] = useState(initial);
  return (
    <WeightInput
      value={value}
      ariaLabel="peso de Tarea X"
      onCommit={(n) => { setValue(n); onCommit?.(n); }}
    />
  );
}

describe('WeightInput', () => {
  it('con valor 1: al enfocar y escribir "0.5" confirma 0.5 y lo muestra', () => {
    const onCommit = vi.fn();
    render(<Controlled initial={1} onCommit={onCommit} />);
    const input = screen.getByLabelText('peso de Tarea X');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.5' } });

    expect(onCommit).toHaveBeenCalledWith(0.5);
    expect(input.value).toBe('0.5');
  });

  it('escribir "0,25" confirma 0.25 y al salir se ve con punto', () => {
    const onCommit = vi.fn();
    render(<Controlled initial={1} onCommit={onCommit} />);
    const input = screen.getByLabelText('peso de Tarea X');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0,25' } });
    expect(onCommit).toHaveBeenCalledWith(0.25);

    fireEvent.blur(input);
    expect(input.value).toBe('0.25');
  });

  it('borrar todo y salir vuelve a "1" y NO confirma basura', () => {
    const onCommit = vi.fn();
    render(<Controlled initial={1} onCommit={onCommit} />);
    const input = screen.getByLabelText('peso de Tarea X');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(input.value).toBe('1');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('escribir "0" no confirma y marca aria-invalid', () => {
    const onCommit = vi.fn();
    render(<Controlled initial={1} onCommit={onCommit} />);
    const input = screen.getByLabelText('peso de Tarea X');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0' } });

    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('las letras se ignoran: el texto no cambia ni se confirma', () => {
    const onCommit = vi.fn();
    render(<Controlled initial={1} onCommit={onCommit} />);
    const input = screen.getByLabelText('peso de Tarea X');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });

    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('1');
  });

  it('un valor guardado fuera de rango (1.5) se ve tal cual y NO está inválido', () => {
    render(<Controlled initial={1.5} />);
    const input = screen.getByLabelText('peso de Tarea X');

    expect(input.value).toBe('1.5');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });
});
