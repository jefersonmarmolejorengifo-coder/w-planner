import { describe, it, expect } from 'vitest';
import { buildKrTitleMap, resolveKrTitle } from './krTitle.js';

describe('buildKrTitleMap', () => {
  it('con lista vacía devuelve un mapa vacío', () => {
    expect(buildKrTitleMap([])).toEqual({});
  });

  it('sin argumento (defensivo) devuelve un mapa vacío', () => {
    expect(buildKrTitleMap(undefined)).toEqual({});
  });

  it('arma id -> título por cada resultado clave', () => {
    const map = buildKrTitleMap([
      { id: 1, title: 'Aumentar retención' },
      { id: 2, title: 'Reducir churn' },
    ]);
    expect(map).toEqual({ 1: 'Aumentar retención', 2: 'Reducir churn' });
  });
});

describe('resolveKrTitle', () => {
  const krTitleById = { 1: 'Aumentar retención', 2: 'Reducir churn' };

  it('tarea sin krId no resuelve nada', () => {
    expect(resolveKrTitle(null, krTitleById)).toBeNull();
    expect(resolveKrTitle(undefined, krTitleById)).toBeNull();
  });

  it('con krId que existe devuelve su título', () => {
    expect(resolveKrTitle(1, krTitleById)).toBe('Aumentar retención');
  });

  it('con krId que ya no existe (el resultado clave se borró) devuelve null', () => {
    expect(resolveKrTitle(99, krTitleById)).toBeNull();
  });

  it('con mapa vacío (proyecto sin OKRs) devuelve null', () => {
    expect(resolveKrTitle(1, {})).toBeNull();
  });
});
