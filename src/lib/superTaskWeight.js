// Peso de un enlace tarea → super-tarea: un número mayor que 0 y hasta 1,
// con máximo 2 decimales (0.25, 0.3, 0.5, 1). Puro, sin React.
//
// POR QUÉ EXISTE
// El campo original era <input type="number"> con `Number(w) || 1`: borrar
// el campo o escribir "0" devolvía `Number("0") || 1` = 1, así que el valor
// saltaba solo y era imposible teclear "0.5" (el intermedio "0." llega como
// "" y se pisa). Además, en locale español ese input muestra la coma como
// separador, que tampoco es lo que la base espera. Estos helpers separan el
// parseo/formato del control de UI (ver src/ui/WeightInput.jsx).
//
// Valores guardados fuera de este rango (datos viejos, hasta 1.5 en el
// tablero demo) NO se corrigen solos: parseWeight/isTypeableWeightText solo
// gobiernan lo que la persona teclea de aquí en adelante; formatWeight
// muestra cualquier número tal cual, esté o no en rango.

export const WEIGHT_MIN = 0; // exclusivo: 0 no es un peso válido
export const WEIGHT_MAX = 1; // inclusivo
export const WEIGHT_MAX_DECIMALS = 2;
export const WEIGHT_DEFAULT = 1;

// Un número completo con hasta 2 decimales, punto como separador (el texto
// ya llega normalizado: parseWeight reemplaza la coma antes de probar esto).
// Acepta "1", "0.5", ".5", "1." — el filtro de rango va después, por
// separado, para poder distinguir "no es un número" de "está fuera de rango".
const FULL_NUMBER_RE = /^(?:\d*\.\d+|\d+\.?)$/;

// Texto parcial que la persona puede estar tecleando: dígitos, y como mucho
// un separador (punto o coma) seguido de hasta 2 decimales. No exige que sea
// un número completo (permite "", ".", "0,") — de eso se encarga parseWeight
// al confirmar. Se usa para decidir si una tecla se acepta o se ignora.
const TYPEABLE_RE = /^\d*([.,]\d{0,2})?$/;

/** ¿El texto (parcial) es algo que tiene sentido dejar teclear? */
export function isTypeableWeightText(text) {
  if (typeof text !== "string") return false;
  return TYPEABLE_RE.test(text);
}

/**
 * Convierte texto (o número) en un peso válido: mayor que 0, hasta 1, máximo
 * 2 decimales. Acepta punto o coma como separador y espacios alrededor.
 * Devuelve `null` si no se puede interpretar como un peso válido (vacío,
 * ".", "0", > 1, letras, o más de 2 decimales) — nunca inventa un valor.
 */
export function parseWeight(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(",", ".");
  if (text === "" || text === ".") return null;
  if (!FULL_NUMBER_RE.test(text)) return null;

  const decimals = text.match(/\.(\d+)$/);
  if (decimals && decimals[1].length > WEIGHT_MAX_DECIMALS) return null;

  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (n <= WEIGHT_MIN || n > WEIGHT_MAX) return null;

  // Redondeo defensivo: FULL_NUMBER_RE + el chequeo de decimales ya
  // garantizan como mucho 2 decimales, pero esto evita arrastrar errores de
  // punto flotante si algún día se relaja el regex.
  return Math.round(n * 100) / 100;
}

/**
 * Formatea un peso para mostrar: string con punto, sin ceros sobrantes.
 * Acepta número o string numérico (PostgREST puede devolver `numeric` como
 * string). Si no es finito, cae al peso por defecto (1) en vez de mostrar
 * "NaN" o dejar el campo vacío.
 */
export function formatWeight(value) {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(WEIGHT_DEFAULT);
  return n.toFixed(WEIGHT_MAX_DECIMALS).replace(/\.?0+$/, "");
}
