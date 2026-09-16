// Peso de un enlace tarea → super-tarea: fija el contrato de parseWeight /
// formatWeight / isTypeableWeightText que reemplaza el <input type="number">
// viejo (ver superTaskWeight.js para el porqué completo).

import { describe, it, expect } from 'vitest';
import { parseWeight, formatWeight, isTypeableWeightText } from './superTaskWeight';

describe('parseWeight', () => {
  it('acepta un entero simple', () => {
    expect(parseWeight('1')).toBe(1);
  });

  it('acepta punto como separador decimal', () => {
    expect(parseWeight('0.5')).toBe(0.5);
  });

  it('acepta coma como separador decimal', () => {
    expect(parseWeight('0,5')).toBe(0.5);
  });

  it('acepta un punto inicial sin el cero (".5")', () => {
    expect(parseWeight('.5')).toBe(0.5);
  });

  it('recorta espacios alrededor', () => {
    expect(parseWeight(' 0.5 ')).toBe(0.5);
  });

  it('rechaza "0" (el peso debe ser mayor que 0)', () => {
    expect(parseWeight('0')).toBeNull();
  });

  it('rechaza vacío', () => {
    expect(parseWeight('')).toBeNull();
  });

  it('rechaza un solo punto', () => {
    expect(parseWeight('.')).toBeNull();
  });

  it('rechaza valores mayores a 1', () => {
    expect(parseWeight('1.5')).toBeNull();
  });

  it('rechaza letras', () => {
    expect(parseWeight('abc')).toBeNull();
  });

  it('rechaza más de 2 decimales', () => {
    expect(parseWeight('0.255')).toBeNull();
  });

  it('rechaza números negativos', () => {
    expect(parseWeight('-0.5')).toBeNull();
  });

  it('acepta coma con un cero final ("1,0")', () => {
    expect(parseWeight('1,0')).toBe(1);
  });

  it('acepta ceros a la izquierda ("00.5")', () => {
    expect(parseWeight('00.5')).toBe(0.5);
  });

  it('acepta dos decimales exactos que redondean a un entero ("1.00")', () => {
    expect(parseWeight('1.00')).toBe(1);
  });
});

// Contrato con la base: task_super_links.weight tiene
// CHECK (weight > 0 AND weight <= 5). parseWeight es el ÚNICO portón por el
// que un valor tecleado llega a un `onCommit` (y de ahí a un UPDATE/INSERT);
// estas pruebas fijan que ninguna entrada límite puede colarse fuera de
// (0, 1] — un rango más estricto que el CHECK, así que cumplirlo también
// cumple el CHECK. Si esto se rompe, un `insert`/`update` real chocaría con
// el CHECK de Postgres (o peor, lo violaría si algún día se relaja).
describe('parseWeight — contrato con el CHECK de la base', () => {
  it.each([
    ['0', 'cero exacto, excluido'],
    ['-1', 'negativo'],
    ['5', 'dentro del CHECK de la base pero fuera del rango de la app'],
    ['6', 'fuera del CHECK de la base'],
    ['', 'vacío'],
    ['   ', 'solo espacios'],
    ['NaN', 'texto que parece número pero no lo es'],
    ['Infinity', 'no finito'],
  ])('rechaza "%s" (%s)', (raw) => {
    expect(parseWeight(raw)).toBeNull();
  });
});

describe('formatWeight', () => {
  it('un entero se muestra sin decimales', () => {
    expect(formatWeight(1)).toBe('1');
  });

  it('0.5 se muestra con un decimal', () => {
    expect(formatWeight(0.5)).toBe('0.5');
  });

  it('0.25 conserva sus dos decimales', () => {
    expect(formatWeight(0.25)).toBe('0.25');
  });

  it('0.3 no muestra un cero sobrante ("0.3", no "0.30")', () => {
    expect(formatWeight(0.3)).toBe('0.3');
  });

  it('un valor guardado fuera de rango (1.5) se muestra tal cual, sin reescribirlo', () => {
    expect(formatWeight(1.5)).toBe('1.5');
  });

  it('acepta un numeric de PostgREST devuelto como string', () => {
    expect(formatWeight('0.25')).toBe('0.25');
  });

  it('NaN cae al peso por defecto (1) en vez de mostrar basura', () => {
    expect(formatWeight(NaN)).toBe('1');
  });
});

describe('isTypeableWeightText', () => {
  it('acepta vacío (se está borrando el campo)', () => {
    expect(isTypeableWeightText('')).toBe(true);
  });

  it('acepta un separador suelto, punto o coma', () => {
    expect(isTypeableWeightText('.')).toBe(true);
    expect(isTypeableWeightText(',')).toBe(true);
  });

  it('acepta hasta 2 decimales', () => {
    expect(isTypeableWeightText('0.25')).toBe(true);
  });

  it('rechaza un tercer decimal', () => {
    expect(isTypeableWeightText('0.255')).toBe(false);
  });

  it('rechaza letras', () => {
    expect(isTypeableWeightText('0.5a')).toBe(false);
  });

  it('rechaza dos separadores', () => {
    expect(isTypeableWeightText('0..5')).toBe(false);
  });
});
