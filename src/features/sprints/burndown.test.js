// El burndown llevaba desde mayo pintando curvas inventadas.
//
// `finalizedAt` se guarda con toLocaleString("es-CO") → "06/08/2026, 14:30",
// mientras que el eje del burndown avanza en ISO ("2026-08-06"). El código
// comparaba ambos con `>` directamente. En JavaScript eso no es un error: es
// una comparación de cadenas perfectamente válida cuyo resultado depende del
// PRIMER DÍGITO del día del mes.
//
//   "06/08/2026," > "2026-08-10"  →  false  ('0' < '2')
//   "25/08/2026," > "2026-08-30"  →  true   ('5' > '0')
//
// Es decir: las tareas cerradas del día 1 al 19 aparecían terminadas desde el
// arranque del sprint, y las cerradas del 20 al 31 no se daban por terminadas
// jamás. La gráfica siempre dibujaba una línea plausible, así que nadie la
// contrastó nunca contra la realidad.
//
// Estos tests fijan el normalizador que lo arregla.

import { describe, it, expect } from 'vitest';
import { isoDeFinalizacion } from './burndown';

describe('isoDeFinalizacion', () => {
  it('convierte el formato es-CO que realmente se guarda', () => {
    expect(isoDeFinalizacion('06/08/2026, 14:30')).toBe('2026-08-06');
    expect(isoDeFinalizacion('25/08/2026, 09:05')).toBe('2026-08-25');
  });

  it('tolera que no venga la hora', () => {
    expect(isoDeFinalizacion('01/12/2026')).toBe('2026-12-01');
  });

  it('deja pasar lo que ya viene en ISO', () => {
    expect(isoDeFinalizacion('2026-08-06')).toBe('2026-08-06');
    expect(isoDeFinalizacion('2026-08-06 14:30')).toBe('2026-08-06');
  });

  it('devuelve null para lo que no sabe interpretar, en vez de inventar', () => {
    expect(isoDeFinalizacion(null)).toBeNull();
    expect(isoDeFinalizacion('')).toBeNull();
    expect(isoDeFinalizacion('ayer por la tarde')).toBeNull();
  });

  // ── El corazón del bug ────────────────────────────────────────────────────
  it('ordena correctamente contra el eje ISO en TODO el mes', () => {
    // Con la comparación vieja, los días 1–19 daban un resultado y los 20–31 el
    // contrario. Aquí se recorre el mes entero contra un corte fijo.
    const corte = '2026-08-15';
    for (let dia = 1; dia <= 31; dia++) {
      const dd = String(dia).padStart(2, '0');
      const fin = isoDeFinalizacion(`${dd}/08/2026, 10:00`);
      // "Sigue pendiente el día del corte" ⇔ se cerró DESPUÉS del corte.
      expect(fin > corte, `día ${dd}`).toBe(dia > 15);
    }
  });

  it('la comparación directa que se usaba antes era efectivamente errónea', () => {
    // Se deja como documentación ejecutable de por qué existe el normalizador:
    // si alguien vuelve a comparar el valor crudo, esto explica qué pasaba.
    expect('06/08/2026,' > '2026-08-10').toBe(false); // cerrada el 6: parecía ya terminada
    expect('25/08/2026,' > '2026-08-30').toBe(true);  // cerrada el 25: parecía pendiente
  });
});
