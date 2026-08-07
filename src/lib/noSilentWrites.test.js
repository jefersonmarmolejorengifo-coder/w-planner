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
// si encuentra una escritura (`insert`/`update`/`delete`/`upsert`) cuyo fallo
// pueda pasar desapercibido. Es la regla escrita de forma ejecutable.
//
// Detecta las tres formas de tragarse un error, en orden de descaro:
//   1. la sentencia no captura nada          → `await supabase.from(x).insert(y);`
//   2. lo captura y lo tira                  → `.then(() => {})`
//   3. lo captura pero no mira `error`       → `const { data } = await ...`
// La tercera es la traicionera: parece código responsable. Fue la que mantuvo
// task_history vacía y 534 tareas sin autor durante tres meses.
//
// SI ESTE TEST FALLA: no lo debilites. O capturas el error
// (`const { error } = await …` y lo tratas), o si de verdad da igual, añade el
// la línea a EXCEPCIONES_JUSTIFICADAS explicando por qué.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const RAIZ = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DIRS = ['src', 'api'];

// Escrituras que pueden descartar su resultado con una razon de peso.
const EXCEPCIONES_JUSTIFICADAS = {
  "api/cron.js » await supabase.from(\"_keepalive\").update({ ch, pinged_at: new Date().toISOString() }).eq(\"id\", 1);":
    'ping de mantenimiento para que Supabase no duerma el proyecto; su fallo no afecta a ningun dato ni a ningun usuario',
};

// DEUDA CONOCIDA - escrituras mudas pendientes en zonas aun sin auditar.
// NO son excepciones justificadas: son trabajo por hacer. La lista existe para
// que el test bloquee desde ya cualquier escritura muda NUEVA en vez de
// quedarse en rojo permanente (un test que siempre falla deja de leerse).
//
// El 2026-08-06 arranco con 23 entradas y quedo VACIA el mismo dia. Si vuelve a
// crecer, algo se esta escapando: la lista solo debe encoger.
const DEUDA_CONOCIDA = {
};

const VERBOS_ESCRITURA = /\.(insert|upsert|update|delete)\s*\(/;
// Si la línea anterior termina así, la llamada es una expresión que alguien
// está capturando (una asignación, un argumento, el cuerpo de una flecha…),
// no una sentencia suelta cuyo resultado se pierde.
const CONTINUACION = /(=>|=|\(|,|\[|&&|\|\||\?|:|return)\s*$/;

// La clave identifica la escritura por su TEXTO, no por su número de línea:
// con números, cualquier edición ajena al archivo rompía el test y obligaba a
// renumerar la lista de deuda entera. Con el texto, la entrada sigue valiendo
// mientras la línea exista tal cual, y deja de valer en cuanto se corrige.
const claveDe = (rel, linea) => `${rel} » ${linea.trim()}`;

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
        hallazgos.push({ clave: claveDe(rel, linea), ubicacion: `${rel}:${i + 1}`, linea, motivo: 'el resultado de la escritura se descarta' });
      }
    }

    // Caso 3: el resultado SE captura, pero sin `error`. Es el punto ciego que
    // dejó el producto medio mudo tres meses: `const { data: created } = await
    // supabase...insert(...)` parece código responsable —hay una asignación—
    // pero si la escritura falla, `data` queda undefined y nadie se entera.
    const capturaSinError = /^const\s*\{([^}]*)\}\s*=\s*await\s+(supabase|admin|client)\b/.exec(linea);
    if (capturaSinError && !/\berror\b/.test(capturaSinError[1])) {
      const sentencia = sentenciaDesde(lineas, i);
      if (VERBOS_ESCRITURA.test(sentencia)) {
        hallazgos.push({
          clave: claveDe(rel, linea), ubicacion: `${rel}:${i + 1}`, linea,
          motivo: 'captura el resultado pero no comprueba `error`',
        });
      }
    }

    // Caso 2: el resultado se recibe y se tira explícitamente.
    if (/\.then\s*\(\s*\(\s*\)\s*=>\s*\{?\s*\}?\s*\)/.test(linea)
        && VERBOS_ESCRITURA.test(lineas.slice(Math.max(0, i - 11), i + 1).join(''))) {
      hallazgos.push({ clave: claveDe(rel, linea), ubicacion: `${rel}:${i + 1}`, linea, motivo: '.then(() => {}) descarta el error' });
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

    const informe = mudas.map(h => `  ${h.ubicacion} — ${h.motivo}\n    ${h.linea}`).join('\n');
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
