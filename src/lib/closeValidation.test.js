import { describe, it, expect } from 'vitest';
import { applyStatusChange, CLOSE_STATES } from './closeValidation.js';

describe('applyStatusChange', () => {
  it('al pasar a "Finalizada" rellena validationClose con ese estado', () => {
    const task = { status: 'En proceso', validationClose: null };
    expect(applyStatusChange(task, 'Finalizada')).toEqual({
      status: 'Finalizada',
      validationClose: 'Finalizada',
    });
  });

  it('al pasar a "Cancelada" rellena validationClose con ese estado', () => {
    const task = { status: 'Bloqueada', validationClose: null };
    expect(applyStatusChange(task, 'Cancelada')).toEqual({
      status: 'Cancelada',
      validationClose: 'Cancelada',
    });
  });

  it('al pasar a un estado que no cierra, no toca validationClose', () => {
    const task = { status: 'Sin iniciar', validationClose: null };
    expect(applyStatusChange(task, 'En proceso')).toEqual({
      status: 'En proceso',
      validationClose: null,
    });
  });

  it('si ya tenía un valor de cierre y se mueve a OTRO estado de cierre, lo sobrescribe (igual que el formulario)', () => {
    const task = { status: 'Cancelada', validationClose: 'Cancelada' };
    expect(applyStatusChange(task, 'Finalizada')).toEqual({
      status: 'Finalizada',
      validationClose: 'Finalizada',
    });
  });

  it('no muta la tarea original', () => {
    const task = { status: 'En proceso', validationClose: null };
    applyStatusChange(task, 'Finalizada');
    expect(task).toEqual({ status: 'En proceso', validationClose: null });
  });

  it('CLOSE_STATES expone exactamente los dos estados de cierre', () => {
    expect(CLOSE_STATES).toEqual(['Finalizada', 'Cancelada']);
  });
});
