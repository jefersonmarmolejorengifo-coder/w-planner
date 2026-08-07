// Casuística del planificador de informes del cron.
//
// POR QUÉ ESTE ARCHIVO
// El cron corre sin nadie mirando y decide cuándo sale un correo a los clientes.
// Sus dos formas de equivocarse son caras y silenciosas: no enviar un informe
// (nadie lo echa de menos hasta que lo echa de menos) o enviarlo dos veces
// (queda fatal). Hasta el 2026-08-06 la decisión exigía que la hora coincidiera
// clavada, así que si el cron agotaba su presupuesto de 60 s en esa única
// pasada, el informe se perdía hasta el siguiente periodo.
//
// La corrección introduce una ventana de tolerancia de 6 h. Una ventana, por sí
// sola, es un multiplicador de duplicados: por eso `ocurrenciaPendiente` deduce
// la ocurrencia EXACTA y la compara con `last_sent`, en vez de contar horas
// transcurridas. Como es una función pura, se puede recorrer entera aquí.
//
// Referencias horarias: Colombia es UTC-5 sin horario de verano, así que
// "lunes 08:00 Colombia" es siempre "lunes 13:00Z".

import { describe, it, expect } from 'vitest';
import { ocurrenciaPendiente, partesColombia, TOLERANCIA_HORAS } from './cron.js';

// 2026-08-03 fue lunes; 2026-08-05, miércoles.
const LUNES_08_COL = new Date('2026-08-03T13:00:00.000Z');
const utc = (iso) => new Date(iso);

const weekly = (extra = {}) => ({
  id: 1, project_id: 10, report_type: 'weekly_po',
  recipients: ['a@b.c'], schedule: { send_day: 'monday', hour: 8 },
  last_sent: null, ...extra,
});
const scrum = (extra = {}) => ({
  id: 2, project_id: 10, report_type: 'scrum',
  recipients: ['a@b.c'], schedule: { days: ['wednesday', 'friday'], hour: 8 },
  last_sent: null, ...extra,
});
const monthly = (extra = {}) => ({
  id: 3, project_id: 10, report_type: 'monthly_team',
  recipients: ['a@b.c'], schedule: { send_day: 'monday', week: 1, hour: 8 },
  last_sent: null, ...extra,
});

describe('partesColombia', () => {
  it('traduce a hora de pared colombiana sin depender del huso del servidor', () => {
    // 13:00Z = 08:00 en Colombia, mismo día.
    expect(partesColombia(utc('2026-08-03T13:00:00Z'))).toMatchObject({ dia: 3, hora: 8, diaSemana: 1 });
  });

  it('retrocede de día cuando en UTC ya es el siguiente', () => {
    // 02:00Z del martes son las 21:00 del lunes en Colombia.
    expect(partesColombia(utc('2026-08-04T02:00:00Z'))).toMatchObject({ dia: 3, hora: 21, diaSemana: 1 });
  });
});

describe('ocurrenciaPendiente — la hora pactada', () => {
  it('devuelve la ocurrencia justo a la hora', () => {
    expect(ocurrenciaPendiente(weekly(), LUNES_08_COL)?.toISOString())
      .toBe('2026-08-03T13:00:00.000Z');
  });

  it('no dispara antes de la hora', () => {
    expect(ocurrenciaPendiente(weekly(), utc('2026-08-03T12:59:00Z'))).toBeNull();
  });

  it('no dispara el día equivocado', () => {
    expect(ocurrenciaPendiente(weekly(), utc('2026-08-04T13:00:00Z'))).toBeNull();
  });

  it('respeta la hora 0 (medianoche) en vez de caer al valor por defecto', () => {
    const cfg = weekly({ schedule: { send_day: 'monday', hour: 0 } });
    // 00:00 Colombia del lunes = 05:00Z del lunes.
    expect(ocurrenciaPendiente(cfg, utc('2026-08-03T05:00:00Z'))?.toISOString())
      .toBe('2026-08-03T05:00:00.000Z');
  });

  it('usa 8 si la hora configurada es basura', () => {
    const cfg = weekly({ schedule: { send_day: 'monday', hour: 'tarde' } });
    expect(ocurrenciaPendiente(cfg, LUNES_08_COL)).not.toBeNull();
  });
});

describe('ocurrenciaPendiente — la ventana de tolerancia', () => {
  it('sigue pendiente horas después de la hora pactada', () => {
    // Este es el caso que motivó el cambio: el primer tick se quedó sin
    // presupuesto y el informe lo recoge un tick posterior.
    for (const h of [1, 3, 5]) {
      const ahora = new Date(LUNES_08_COL.getTime() + h * 3600000);
      expect(ocurrenciaPendiente(weekly(), ahora), `+${h}h`).not.toBeNull();
    }
  });

  it('deja de estar pendiente al cerrarse la ventana', () => {
    const ahora = new Date(LUNES_08_COL.getTime() + TOLERANCIA_HORAS * 3600000);
    expect(ocurrenciaPendiente(weekly(), ahora)).toBeNull();
  });

  it('devuelve SIEMPRE el mismo instante dentro de la ventana', () => {
    // Si la ocurrencia "se moviera" con el reloj, la reserva no serviría de
    // nada: cada tick reservaría un instante distinto y habría duplicados.
    const a = ocurrenciaPendiente(weekly(), LUNES_08_COL);
    const b = ocurrenciaPendiente(weekly(), new Date(LUNES_08_COL.getTime() + 4 * 3600000));
    expect(a.toISOString()).toBe(b.toISOString());
  });

  it('la ventana nunca cruza la medianoche colombiana', () => {
    // A las 22:00 solo quedan 2 h de día: la ventana se recorta ahí, porque
    // pasada la medianoche el predicado del día ya no se cumpliría.
    const cfg = weekly({ schedule: { send_day: 'monday', hour: 22 } });
    const base = utc('2026-08-04T03:00:00Z'); // lunes 22:00 Colombia
    expect(ocurrenciaPendiente(cfg, base)).not.toBeNull();
    expect(ocurrenciaPendiente(cfg, new Date(base.getTime() + 1.5 * 3600000))).not.toBeNull();
    expect(ocurrenciaPendiente(cfg, new Date(base.getTime() + 2 * 3600000))).toBeNull();
  });
});

describe('ocurrenciaPendiente — nunca dos veces la misma', () => {
  it('no repite si ya se envió esa ocurrencia', () => {
    const cfg = weekly({ last_sent: '2026-08-03T13:00:00.000Z' });
    expect(ocurrenciaPendiente(cfg, LUNES_08_COL)).toBeNull();
  });

  it('no repite en NINGÚN punto de la ventana una vez enviada', () => {
    // La regresión que más importa: con una regla de "han pasado N horas", a
    // las 4 h volvería a considerarse pendiente y el cliente recibiría dos.
    const cfg = weekly({ last_sent: '2026-08-03T13:00:05.000Z' });
    for (const h of [0.5, 1, 2, 4, 5.9]) {
      const ahora = new Date(LUNES_08_COL.getTime() + h * 3600000);
      expect(ocurrenciaPendiente(cfg, ahora), `+${h}h`).toBeNull();
    }
  });

  it('tampoco repite si ya salió un envío manual ese mismo día', () => {
    const cfg = weekly({ last_sent: '2026-08-03T11:00:00.000Z' }); // 06:00 Colombia
    expect(ocurrenciaPendiente(cfg, LUNES_08_COL)).toBeNull();
  });

  it('sí dispara a la semana siguiente', () => {
    const cfg = weekly({ last_sent: '2026-08-03T13:00:00.000Z' });
    expect(ocurrenciaPendiente(cfg, utc('2026-08-10T13:00:00Z'))).not.toBeNull();
  });

  it('ignora un last_sent corrupto en vez de bloquearse para siempre', () => {
    const cfg = weekly({ last_sent: 'no es una fecha' });
    expect(ocurrenciaPendiente(cfg, LUNES_08_COL)).not.toBeNull();
  });
});

describe('ocurrenciaPendiente — scrum', () => {
  it('dispara en los días configurados y no en otros', () => {
    expect(ocurrenciaPendiente(scrum(), utc('2026-08-05T13:00:00Z'))).not.toBeNull(); // miércoles
    expect(ocurrenciaPendiente(scrum(), utc('2026-08-04T13:00:00Z'))).toBeNull();     // martes
  });

  it('respeta una hora distinta por día', () => {
    const cfg = scrum({ schedule: { days: ['wednesday', 'friday'], hours: { wednesday: 8, friday: 17 } } });
    expect(ocurrenciaPendiente(cfg, utc('2026-08-07T22:00:00Z'))?.toISOString()) // viernes 17:00 Col
      .toBe('2026-08-07T22:00:00.000Z');
    expect(ocurrenciaPendiente(cfg, utc('2026-08-07T13:00:00Z'))).toBeNull();    // viernes 08:00: aún no
  });

  it('cae a miércoles y viernes si no hay días configurados', () => {
    const cfg = scrum({ schedule: {} });
    expect(ocurrenciaPendiente(cfg, utc('2026-08-05T13:00:00Z'))).not.toBeNull();
  });
});

describe('ocurrenciaPendiente — mensual', () => {
  it('dispara el primer lunes del mes', () => {
    expect(ocurrenciaPendiente(monthly(), LUNES_08_COL)).not.toBeNull(); // día 3
  });

  it('no dispara un lunes fuera de la semana configurada', () => {
    expect(ocurrenciaPendiente(monthly(), utc('2026-08-10T13:00:00Z'))).toBeNull(); // día 10
  });

  it('convive con el semanal a la misma hora sin pisarse', () => {
    // El primer lunes del mes ambos "tocan": el presupuesto del cron hará que
    // uno se difiera, y la ventana garantiza que salga en un tick posterior.
    expect(ocurrenciaPendiente(weekly(), LUNES_08_COL)).not.toBeNull();
    expect(ocurrenciaPendiente(monthly(), LUNES_08_COL)).not.toBeNull();
  });
});

describe('ocurrenciaPendiente — entradas raras', () => {
  it('un tipo desconocido nunca dispara', () => {
    expect(ocurrenciaPendiente({ report_type: 'inventado', schedule: {} }, LUNES_08_COL)).toBeNull();
  });

  it('sin schedule usa los valores por defecto', () => {
    expect(ocurrenciaPendiente({ report_type: 'weekly_po', last_sent: null }, LUNES_08_COL)).not.toBeNull();
  });
});
