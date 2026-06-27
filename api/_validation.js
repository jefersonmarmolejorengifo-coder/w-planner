// ── _validation.js ────────────────────────────────────────────────────────────
// Helpers de validación de inputs: puros, sin dependencias externas.
//
// POR QUÉ aquí y no en un framework (Zod/Joi):
//   - Los endpoints corren en Vercel Edge/Serverless donde el tamaño del bundle
//     importa. Zod pesa ~13 kB min+gzip; estos helpers son triviales y cubren
//     los casos reales del proyecto.
//   - Lanzan BadRequestError con .status HTTP correcto (400 / 413) para que
//     handleApiError (en _http.js) los traduzca sin lógica extra.
//
// IMPORTADO POR: api/_auth.js (barrel) → todos los endpoints vía re-export.
// ─────────────────────────────────────────────────────────────────────────────

// 2000 chars: límite razonable para mensajes de chat. Antes era 8000, que es
// excesivo para un turno conversacional y amplía la superficie de payload abuse.
// Los endpoints que usaban 8000 no cambian de comportamiento visible para el
// usuario normal; solo bloquea payloads abusivos más temprano (H-021).
export const MAX_USER_MESSAGE_CHARS = 2000;

// Error con .status HTTP para que handleApiError lo traduzca al código correcto
// (400 inválido, 413 demasiado grande). Extiende Error para ser instanceof-able.
export class BadRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "BadRequestError";
    this.status = status;
  }
}

// Exige string no vacío y acotado.
//   min   → mínimo de caracteres (post-trim si trim=true). Default 1.
//   max   → máximo de caracteres. Excedido → 413 Payload Too Large. Default 10000.
//   trim  → recorta espacios antes de validar y devuelve el valor recortado.
export const requireString = (value, name, { min = 1, max = 10000, trim = true } = {}) => {
  if (typeof value !== "string") throw new BadRequestError(`${name} debe ser texto`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw new BadRequestError(`${name} es requerido`);
  if (v.length > max) throw new BadRequestError(`${name} excede el máximo de ${max} caracteres`, 413);
  return v;
};

// Exige entero positivo (ids de proyecto/sesión/etc.).
// Acepta strings numéricos ("27") porque los query params llegan como string.
export const requirePositiveInt = (value, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestError(`${name} inválido`);
  return n;
};

// Exige que value sea uno de los valores permitidos (enums tipo tier/role).
export const requireEnum = (value, name, allowed) => {
  if (!allowed.includes(value)) throw new BadRequestError(`${name} inválido`);
  return value;
};

// Valida que un string sea una fecha YYYY-MM-DD con formato correcto Y que
// la fecha sea calendáricamente real (rechaza 2026-13-45 o 2026-02-30).
//
// El regex verifica el formato; la construcción de Date verifica la realidad
// calendárica comparando los componentes parseados contra lo que Date devuelve
// (JS "desborda" fechas inválidas: new Date(2026,1,30) → 2 de marzo).
export const isDateOnly = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v ?? "")) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

// Exige dos fechas YYYY-MM-DD con start estrictamente anterior a end.
// Lanza BadRequestError 400 si:
//   - alguna tiene formato inválido (no YYYY-MM-DD)
//   - start === end  (rango de duración cero — siempre inválido para ventanas)
//   - start > end    (rango invertido)
//
// La comparación lexicográfica es suficiente para fechas ISO en formato fijo.
// Uso: requireDateRange(periodStart, periodEnd, { startName: 'periodStart', endName: 'periodEnd' })
export const requireDateRange = (start, end, { startName = "start", endName = "end" } = {}) => {
  if (!isDateOnly(start)) throw new BadRequestError(`${startName} debe ser una fecha YYYY-MM-DD`);
  if (!isDateOnly(end))   throw new BadRequestError(`${endName} debe ser una fecha YYYY-MM-DD`);
  if (start >= end) {
    throw new BadRequestError(`${startName} debe ser anterior a ${endName}`);
  }
  return { start, end };
};
