// Guard de regresión: ninguna escritura a Supabase puede descartar su resultado.
//
// POR QUÉ EXISTE ESTE TEST
// El bug de las invitaciones (2026-08-06) no sobrevivió meses porque fuera
// difícil, sino porque nadie miraba el error: el servidor fallaba con 23502 y
// el código seguía como si nada. Un test normal no protege de eso, porque el
// problema no está en una función concreta sino en un HÁBITO repartido por
// todo el proyecto.
//
// Así que este test no prueba comportamiento: recorre el código fuente y falla
// si encuentra una escritura (`insert`/`update`/`delete`/`upsert`) cuyo
// resultado no se captura. Es la regla escrita de forma ejecutable.
//
// SI ESTE TEST FALLA: no lo debilites. O capturas el error
// (`const { error } = await …` y lo tratas), o si de verdad da igual, añade el
// archivo:línea a EXCEPCIONES_JUSTIFICADAS explicando por qué.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIRS = ['src', 'api'];

// Escrituras que pueden descartar su resultado con una razón de peso.
const EXCEPCIONES_JUSTIFICADAS = {
  // 'src/ejemplo.js:42': 'motivo concreto por el que aquí da igual',
};

// DEUDA CONOCIDA — escrituras mudas que este escáner encontró el 2026-08-06 en
// zonas todavía sin auditar. NO están justificadas: están pendientes. Se listan
// para que el test bloquee desde hoy cualquier escritura muda NUEVA en vez de
// quedarse en rojo permanente (un test que siempre falla deja de leerse).
//
// Al corregir una, BÓRRALA de esta lista. La lista debe encoger, nunca crecer.
const DEUDA_CONOCIDA = {
  'src/features/okrs/OKRsTab.jsx:34':  'pendiente — auditoría de features de análisis',
  'src/features/okrs/OKRsTab.jsx:45':  'pendiente — auditoría de features de análisis',
  'src/features/okrs/OKRsTab.jsx:52':  'pendiente — auditoría de features de análisis',
  'src/features/okrs/OKRsTab.jsx:66':  'pendiente — auditoría de features de análisis',
  'src/features/okrs/OKRsTab.jsx:71':  'pendiente — auditoría de features de análisis',
  'src/features/sprints/SprintsTab.jsx:121': 'pendiente — auditoría de features de análisis',
  'src/features/sprints/SprintsTab.jsx:126': 'pendiente — auditoría de features de análisis',
  'src/features/sprints/SprintsTab.jsx:132': 'pendiente — auditoría de features de análisis',
  'api/chat-stream.js:259': 'pendiente — auditoría de endpoints de negocio',
  'api/chat-stream.js:379': 'pendiente — auditoría de endpoints de negocio',
  'api/cron.js:235':        'pendiente — auditoría de endpoints de negocio',
  'api/cron.js:435':        'pendiente — auditoría de endpoints de negocio',
  'api/cron.js:520':        'pendiente — auditoría de endpoints de negocio',
  'api/cron.js:524':        'pendiente — auditoría de endpoints de negocio',
  'api/mp-subscribe.js:100': 'pendiente — auditoría de pagos y webhooks',
  'api/open-retro.js:153':  'pendiente — auditoría de endpoints de negocio',
};

const VERBOS_ESCRITURA = /\.(insert|upsert|update|delete)\s*\(/;
// Si la línea anterior termina así, la llamada es una expresión que alguien
// está capturando (una asignación, un argumento, el cuerpo de una flecha…),
// no una sentencia suelta cuyo resultado se pierde.
const CONTINUACION = /(=>|=|\(|,|\[|&&|\|\||\?|:|return)\s*$/;

const listarArchivos = (dir) => {
  const salida = [];
  const recorrer = (d) => {
    for (const entrada of readdirSync(d)) {
      const ruta = join(d, entrada);
      if (statSync(ruta).isDirectory()) {
        if (entrada !== 'node_modules') recorrer(ruta);
      } else if (/\.(js|jsx)$/.test(entrada) && !/\.test\.jsx?$/.test(entrada)) {
        salida.push(ruta);
      }
    }
  };
  recorrer(dir);
  return salida;
};

// Devuelve la sentencia completa que empieza en `i` (hasta el `;` que la cierra
// o un máximo prudente de líneas, para no leer el archivo entero).
const sentenciaDesde = (lineas, i) => {
  let texto = '';
  for (let j = i; j < Math.min(i + 12, lineas.length); j++) {
    texto += lineas[j];
    if (/;\s*$/.test(lineas[j].trim())) break;
  }
  return texto;
};

const buscarEscriturasMudas = (rutaAbs) => {
  const rel = relative(RAIZ, rutaAbs).split(sep).join('/');
  const lineas = readFileSync(rutaAbs, 'utf8').split(/\r?\n/);
  const hallazgos = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();

    // Caso 1: la sentencia arranca con la llamada, así que su valor se pierde.
    const arrancaSentencia = /^(await\s+)?(supabase|admin|client)\s*$/.test(linea)
      || /^(await\s+)?(supabase|admin|client)\s*\.\s*from\s*\(/.test(linea);
    if (arrancaSentencia) {
      const anterior = lineas.slice(0, i).reverse().find(l => l.trim() !== '')?.trim() || '';
      const sentencia = sentenciaDesde(lineas, i);
      // `.then(({ error }) => …)` sí recoge el resultado: no es una escritura muda.
      const loRecogeUnThen = /\.then\s*\(\s*(async\s*)?\(?\s*\{[^}]*\berror\b/.test(sentencia);
      if (!CONTINUACION.test(anterior) && !loRecogeUnThen && VERBOS_ESCRITURA.test(sentencia)) {
        hallazgos.push({ clave: `${rel}:${i + 1}`, linea, motivo: 'el resultado de la escritura se descarta' });
      }
    }

    // Caso 2: el resultado se recibe y se tira explícitamente.
    if (/\.then\s*\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)/.test(linea)
        && VERBOS_ESCRITURA.test(lineas.slice(Math.max(0, i - 11), i + 1).join(''))) {
      hallazgos.push({ clave: `${rel}:${i + 1}`, linea, motivo: '.then(() => {}) descarta el error' });
    }
  }
  return hallazgos;
};

describe('ninguna escritura a Supabase puede quedarse muda', () => {
  it('captura el resultado de todo insert/update/delete/upsert', () => {
    const todos = DIRS.flatMap(d => listarArchivos(join(RAIZ, d)));
    expect(todos.length).toBeGreaterThan(20); // el escáner encontró código de verdad

    const mudas = todos
      .flatMap(buscarEscriturasMudas)
      .filter(h => !(h.clave in EXCEPCIONES_JUSTIFICADAS) && !(h.clave in DEUDA_CONOCIDA));

    const informe = mudas.map(h => `  ${h.clave} — ${h.motivo}\n    ${h.linea}`).join('\n');
    expect(mudas, `Escrituras nuevas que ignoran su error:\n${informe}\n\n` +
      'Captura el error y trátalo. No la añadas a DEUDA_CONOCIDA: esa lista solo encoge.').toEqual([]);
  });

  // Sin esto la lista de deuda se pudre: al arreglar una escritura, su entrada
  // se queda ahí para siempre y acaba tapando un caso nuevo que caiga encima.
  it('la lista de deuda conocida no contiene entradas ya resueltas', () => {
    const todos = DIRS.flatMap(d => listarArchivos(join(RAIZ, d)));
    const detectadas = new Set(todos.flatMap(buscarEscriturasMudas).map(h => h.clave));
    const obsoletas = Object.keys(DEUDA_CONOCIDA).filter(k => !detectadas.has(k));

    expect(obsoletas, `Estas entradas de DEUDA_CONOCIDA ya no corresponden a ninguna ` +
      `escritura muda (arregladas o desplazadas de línea). Bórralas o actualízalas:\n  ` +
      obsoletas.join('\n  ')).toEqual([]);
  });
});
