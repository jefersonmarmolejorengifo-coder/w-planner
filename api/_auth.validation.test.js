import { describe, it, expect } from 'vitest';
import {
  requireString,
  requirePositiveInt,
  requireEnum,
  MAX_USER_MESSAGE_CHARS,
  BadRequestError,
} from './_auth.js';

describe('requireString', () => {
  it('acepta y recorta un string válido', () => {
    expect(requireString('  hola  ', 'campo')).toBe('hola');
  });

  it('rechaza no-strings con 400', () => {
    expect(() => requireString(123, 'campo')).toThrow(BadRequestError);
    try { requireString(null, 'campo'); } catch (e) { expect(e.status).toBe(400); }
  });

  it('rechaza string vacío (después de trim)', () => {
    expect(() => requireString('   ', 'campo')).toThrow(/requerido/);
  });

  it('rechaza con 413 cuando excede max', () => {
    const big = 'x'.repeat(MAX_USER_MESSAGE_CHARS + 1);
    try {
      requireString(big, 'userMessage', { max: MAX_USER_MESSAGE_CHARS });
      throw new Error('no lanzó');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestError);
      expect(e.status).toBe(413);
    }
  });

  it('acepta exactamente el largo máximo', () => {
    const exact = 'y'.repeat(MAX_USER_MESSAGE_CHARS);
    expect(requireString(exact, 'm', { max: MAX_USER_MESSAGE_CHARS })).toHaveLength(MAX_USER_MESSAGE_CHARS);
  });
});

describe('requirePositiveInt', () => {
  it('acepta enteros positivos (también como string numérico)', () => {
    expect(requirePositiveInt(27, 'projectId')).toBe(27);
    expect(requirePositiveInt('27', 'projectId')).toBe(27);
  });

  it('rechaza cero, negativos, decimales y basura', () => {
    for (const bad of [0, -1, 1.5, 'abc', null, undefined, NaN]) {
      expect(() => requirePositiveInt(bad, 'projectId')).toThrow(BadRequestError);
    }
  });
});

describe('requireEnum', () => {
  it('acepta valores permitidos', () => {
    expect(requireEnum('po', 'role', ['po', 'scrum_master', 'participant'])).toBe('po');
  });

  it('rechaza valores fuera del set', () => {
    expect(() => requireEnum('admin', 'role', ['po', 'participant'])).toThrow(BadRequestError);
  });
});
