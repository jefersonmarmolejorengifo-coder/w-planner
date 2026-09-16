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

  it('escribir un valor inválido no vacío ("0") y salir revierte al último valor bueno, no se queda mostrando "0"', () => {
    const onCommit = vi.fn();
    render(<Controlled initial={1} onCommit={onCommit} />);
    const input = screen.getByLabelText('peso de Tarea X');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0' } });
    expect(input.value).toBe('0'); // se deja ver mientras se edita, marcado inválido
    expect(input.getAttribute('aria-invalid')).toBe('true');

    fireEvent.blur(input);
    expect(input.value).toBe('1'); // vuelve al último valor confirmado, no se queda en "0"
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('un tercer decimal se ignora al teclear (o al pegar): no llega a mostrarse ni a confirmarse', () => {
    const onCommit = vi.fn();
    render(<Controlled initial={0.25} onCommit={onCommit} />);
    const input = screen.getByLabelText('peso de Tarea X');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.25' } });
    fireEvent.change(input, { target: { value: '0.255' } }); // pegado con 3 decimales
    expect(input.value).toBe('0.25');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('si "value" cambia desde afuera mientras el campo tiene foco, no pisa lo que la persona está escribiendo', () => {
    const onCommit = vi.fn();
    // A diferencia de <Controlled>, acá `value` lo maneja el test directamente
    // (no el propio onCommit): simula que llega un valor nuevo desde el padre
    // -otra pestaña guardó 1.5, o el padre recargó- mientras la persona edita.
    const { rerender } = render(<WeightInput value={1} ariaLabel="peso de Tarea X" onCommit={onCommit} />);
    const input = screen.getByLabelText('peso de Tarea X');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.' } }); // intermedio, aún no confirma nada
    expect(input.value).toBe('0.');

    rerender(<WeightInput value={1.5} ariaLabel="peso de Tarea X" onCommit={onCommit} />);

    expect(input.value).toBe('0.'); // no se pisa lo que se está tecleando
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('con disabled=true, el campo no deja escribir', () => {
    const onCommit = vi.fn();
    render(<WeightInput value={1} ariaLabel="peso de Tarea X" onCommit={onCommit} disabled />);
    const input = screen.getByLabelText('peso de Tarea X');

    expect(input.disabled).toBe(true);
  });
});
