// Fechas: el huso horario como fuente de bugs silenciosos.
//
// POR QUÉ ESTE ARCHIVO
// El producto opera en Colombia (UTC−5) pero varias vistas calculaban y
// formateaban fechas en UTC. Ninguno de esos fallos lanzaba un error: producían
// un número o una etiqueta plausible, simplemente equivocada.
//   · "hoy" en UTC → desde las 19:00 de Bogotá, una tarea que vence HOY se
//     marcaba VENCIDA. Todos los días, cinco horas.
//   · `new Date("2026-01-01")` es medianoche UTC → en Bogotá se muestra el 31
//     de diciembre, y un OKR anual se agrupaba bajo el año ANTERIOR.
// Estos tests fijan el contrato de los helpers que los reemplazan, y están
// escritos para valer en cualquier huso: no dependen de dónde corra la suite.

import { describe, it, expect } from 'vitest';
import { hoyColombia, fechaColombiaHoy, isoLocal, fechaDesdeISO, formatearFechaISO } from './format';

describe('hoyColombia', () => {
  it('devuelve una fecha ISO de solo día', () => {
    expect(hoyColombia()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('coincide con lo que Intl dice de Bogotá', () => {
    const esperado = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    expect(hoyColombia()).toBe(esperado);
  });

  it('nunca se aleja más de un día del hoy en UTC', () => {
    const utc = new Date().toISOString().slice(0, 10);
    const dif = Math.abs(Date.parse(hoyColombia() + 'T00:00:00Z') - Date.parse(utc + 'T00:00:00Z'));
    expect(dif).toBeLessThanOrEqual(86400000);
  });
});

describe('fechaColombiaHoy + isoLocal', () => {
  it('van y vuelven sin perder el día', () => {
    // Si isoLocal usara campos UTC en vez de locales, este viaje de ida y
    // vuelta se desviaría un día según la hora a la que corra la suite.
    expect(isoLocal(fechaColombiaHoy())).toBe(hoyColombia());
  });

  it('isoLocal rellena con ceros', () => {
    expect(isoLocal(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(isoLocal(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('sobrevive a la aritmética de días que usan los rangos de informes', () => {
    const d = fechaColombiaHoy();
    d.setDate(d.getDate() - 7);
    expect(isoLocal(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Siete días antes, ni seis ni ocho.
    const dif = Date.parse(hoyColombia() + 'T00:00:00Z') - Date.parse(isoLocal(d) + 'T00:00:00Z');
    expect(dif).toBe(7 * 86400000);
  });
});

describe('fechaDesdeISO — el corrimiento que agrupaba los OKR en el año anterior', () => {
  it('el 1 de enero sigue siendo del año que dice, no del anterior', () => {
    const d = fechaDesdeISO('2026-01-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  it('conserva el día en cualquier fecha, no solo en los bordes', () => {
    const d = fechaDesdeISO('2026-08-15');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 8, 15]);
  });

  it('acepta un timestamp completo y se queda con su día', () => {
    const d = fechaDesdeISO('2026-03-09T23:45:00.000Z');
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 3, 9]);
  });

  it('devuelve null si no hay fecha', () => {
    expect(fechaDesdeISO(null)).toBeNull();
    expect(fechaDesdeISO('')).toBeNull();
  });
});

describe('formatearFechaISO', () => {
  it('muestra el día que dice la cadena', () => {
    const texto = formatearFechaISO('2026-01-01', { day: 'numeric', month: 'numeric', year: 'numeric' });
    expect(texto).toContain('2026');
    expect(texto).toContain('1');
    expect(texto).not.toContain('2025'); // el síntoma del corrimiento
  });

  it('no revienta con una entrada vacía', () => {
    expect(formatearFechaISO(null)).toBe('');
  });
});
