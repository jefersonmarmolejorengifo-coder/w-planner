import { describe, it, expect } from 'vitest';
import {
  requireString,
  requirePositiveInt,
  requireEnum,
  requireDateRange,
  isDateOnly,
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

// ── isDateOnly ────────────────────────────────────────────────────────────────
describe('isDateOnly', () => {
  it('acepta fechas YYYY-MM-DD válidas', () => {
    expect(isDateOnly('2026-01-15')).toBe(true);
    expect(isDateOnly('2000-12-31')).toBe(true);
  });

  it('rechaza formatos que no son YYYY-MM-DD', () => {
    expect(isDateOnly('01-15-2026')).toBe(false); // MM-DD-YYYY
    expect(isDateOnly('2026/01/15')).toBe(false); // separadores incorrectos
    expect(isDateOnly('2026-1-5')).toBe(false);   // sin padding
    expect(isDateOnly('hola')).toBe(false);
    expect(isDateOnly('')).toBe(false);
    expect(isDateOnly(null)).toBe(false);
    expect(isDateOnly(undefined)).toBe(false);
  });
});

// ── requireDateRange ──────────────────────────────────────────────────────────
describe('requireDateRange', () => {
  it('acepta un rango válido (start < end) y lo devuelve', () => {
    const result = requireDateRange('2026-01-01', '2026-03-31', {
      startName: 'periodStart',
      endName: 'periodEnd',
    });
    expect(result).toEqual({ start: '2026-01-01', end: '2026-03-31' });
  });

  it('rechaza cuando start === end (rango de duración cero)', () => {
    expect(() =>
      requireDateRange('2026-06-01', '2026-06-01', {
        startName: 'periodStart',
        endName: 'periodEnd',
      })
    ).toThrow(BadRequestError);

    try {
      requireDateRange('2026-06-01', '2026-06-01', {
        startName: 'periodStart',
        endName: 'periodEnd',
      });
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/periodStart/);
    }
  });

  it('rechaza cuando start > end (rango invertido)', () => {
    expect(() =>
      requireDateRange('2026-06-30', '2026-06-01', {
        startName: 'monthStart',
        endName: 'monthEnd',
      })
    ).toThrow(BadRequestError);

    try {
      requireDateRange('2026-06-30', '2026-06-01', {
        startName: 'monthStart',
        endName: 'monthEnd',
      });
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/monthStart/);
    }
  });

  it('rechaza cuando start tiene formato inválido', () => {
    expect(() =>
      requireDateRange('no-es-fecha', '2026-06-30', {
        startName: 'periodStart',
        endName: 'periodEnd',
      })
    ).toThrow(BadRequestError);

    try {
      requireDateRange('01/01/2026', '2026-06-30', {
        startName: 'periodStart',
        endName: 'periodEnd',
      });
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/periodStart/);
    }
  });

  it('rechaza cuando end tiene formato inválido', () => {
    expect(() =>
      requireDateRange('2026-01-01', 'no-es-fecha', {
        startName: 'periodStart',
        endName: 'periodEnd',
      })
    ).toThrow(BadRequestError);

    try {
      requireDateRange('2026-01-01', '31-12-2026', {
        startName: 'periodStart',
        endName: 'periodEnd',
      });
    } catch (e) {
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/periodEnd/);
    }
  });

  it('usa nombres de campo por defecto cuando no se pasan opciones', () => {
    try {
      requireDateRange('2026-06-01', '2026-06-01');
    } catch (e) {
      expect(e.message).toMatch(/start/);
    }
  });

  it('status es siempre 400 en todos los casos de rechazo', () => {
    const casos = [
      ['2026-06-01', '2026-06-01'], // igual
      ['2026-06-30', '2026-01-01'], // invertido
      ['nofecha', '2026-06-30'],    // start inválido
      ['2026-06-01', 'nofecha'],    // end inválido
    ];
    for (const [s, e] of casos) {
      try {
        requireDateRange(s, e, { startName: 'start', endName: 'end' });
        throw new Error(`Debería haber lanzado para ${s} → ${e}`);
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestError);
        expect(err.status).toBe(400);
      }
    }
  });
});
