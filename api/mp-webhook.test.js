import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { verifyMpSignature, mapStatus, parseExternalReference, calcularMontosHub, esEmailValidoParaHub } from './mp-webhook.js';

// Regex de validación de dataId (#4) — extraída del handler para testear la
// lógica sin levantar el servidor completo.
const isValidDataId = (id) => /^[A-Za-z0-9_-]+$/.test(String(id));

// Construye una cabecera x-signature válida para un manifest dado.
function signedHeaders(secret, dataId, requestId, ts) {
  const id = String(dataId ?? '').toLowerCase();
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

describe('verifyMpSignature', () => {
  const SECRET = 'test_secret_abc';
  let prev;
  beforeEach(() => { prev = process.env.MP_WEBHOOK_SECRET; });
  afterEach(() => { process.env.MP_WEBHOOK_SECRET = prev; });

  it('devuelve null cuando no hay secreto configurado (fail-open delegado al caller → H-013)', () => {
    delete process.env.MP_WEBHOOK_SECRET;
    expect(verifyMpSignature({ headers: {} }, '123')).toBeNull();
  });

  it('acepta una firma HMAC válida', () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    const headers = signedHeaders(SECRET, 'ABC123', 'req-1', '1700000000');
    expect(verifyMpSignature({ headers }, 'ABC123')).toBe(true);
  });

  it('rechaza firma con secreto incorrecto', () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    const headers = signedHeaders('otro_secreto', 'ABC123', 'req-1', '1700000000');
    expect(verifyMpSignature({ headers }, 'ABC123')).toBe(false);
  });

  it('rechaza si falta la cabecera x-signature', () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    expect(verifyMpSignature({ headers: {} }, 'ABC123')).toBe(false);
  });

  it('rechaza si el dataId no coincide con el firmado (anti-replay de otro evento)', () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    const headers = signedHeaders(SECRET, 'ABC123', 'req-1', '1700000000');
    expect(verifyMpSignature({ headers }, 'XYZ999')).toBe(false);
  });

  it('normaliza el dataId a minúsculas igual que MP', () => {
    process.env.MP_WEBHOOK_SECRET = SECRET;
    // firmado con el id ya en minúsculas; el caller pasa el id en mayúsculas
    const headers = signedHeaders(SECRET, 'abc123', 'req-1', '1700000000');
    expect(verifyMpSignature({ headers }, 'ABC123')).toBe(true);
  });
});

describe('mapStatus', () => {
  it('mapea los estados de MP a los internos', () => {
    expect(mapStatus('authorized')).toBe('active');
    expect(mapStatus('paused')).toBe('past_due');
    expect(mapStatus('cancelled')).toBe('cancelled');
    expect(mapStatus('pending')).toBe('pending');
  });

  it('es case-insensitive', () => {
    expect(mapStatus('AUTHORIZED')).toBe('active');
  });

  it('cae a pending ante un estado desconocido o vacío', () => {
    expect(mapStatus('quien_sabe')).toBe('pending');
    expect(mapStatus('')).toBe('pending');
    expect(mapStatus(null)).toBe('pending');
  });
});

// ── Validación de dataId (#4) ─────────────────────────────────────────────────
describe('isValidDataId (sanitización de data.id del webhook)', () => {
  it('acepta IDs alfanuméricos y con guiones/underscore', () => {
    expect(isValidDataId('123456789')).toBe(true);
    expect(isValidDataId('ABC-def_123')).toBe(true);
    expect(isValidDataId('preapproval-9a8b')).toBe(true);
  });

  it('rechaza IDs con path traversal o caracteres de escape (#4)', () => {
    expect(isValidDataId('../etc/passwd')).toBe(false);
    expect(isValidDataId('123/456')).toBe(false);
    expect(isValidDataId('123?foo=bar')).toBe(false);
    expect(isValidDataId('123%2F456')).toBe(false); // %2F = /
    expect(isValidDataId('123 456')).toBe(false);   // espacio
    expect(isValidDataId('')).toBe(false);
  });
});

// ── calcularMontosHub ─────────────────────────────────────────────────────────
// Cubre los tres fixes del PR anti-422:
//   (a) montos decimales de MP → se envían redondeados al hub
//   (b) monto bruto <= 0 → retorna null (guard M-2 de Jefer)
//   (c) monto neto <= 0 → retorna null (guard anti-422 de neto)
//   (d) pago sin email → responsabilidad del caller; calcularMontosHub no lo recibe
//       pero el test del handler (integración) verificaría el warn. Aquí testeamos
//       solo la lógica de montos que es la función pura exportada.
describe('calcularMontosHub (normalización de montos para el Hub)', () => {
  it('redondea monto bruto decimal y fee decimal → enteros; devuelve neto correcto', () => {
    // MP puede devolver p. ej. 29900.5 COP con fee 897.015 → Hub rechazaría 422
    const result = calcularMontosHub(29900.5, [{ amount: 897.015 }]);
    expect(result).not.toBeNull();
    expect(result.montoBase).toBe(29901);   // Math.round(29900.5)
    expect(result.feeMp).toBe(897);         // Math.round(897.015)
    expect(result.montoNeto).toBe(29004);   // 29901 - 897
    // Verificar que todos son enteros (Hub exige z.number().int())
    expect(Number.isInteger(result.montoBase)).toBe(true);
    expect(Number.isInteger(result.feeMp)).toBe(true);
    expect(Number.isInteger(result.montoNeto)).toBe(true);
  });

  it('redondea hacia arriba en .5 exacto (comportamiento de Math.round)', () => {
    const result = calcularMontosHub(29900.5, null);
    expect(result.montoBase).toBe(29901);
    expect(result.feeMp).toBe(0);
    expect(result.montoNeto).toBe(29901);
  });

  it('acepta fee_details ausente (null) → feeMp 0, neto igual al bruto', () => {
    const result = calcularMontosHub(15000, null);
    expect(result).toEqual({ montoBase: 15000, feeMp: 0, montoNeto: 15000 });
  });

  it('acepta fee_details vacío ([]) → feeMp 0', () => {
    const result = calcularMontosHub(15000, []);
    expect(result).toEqual({ montoBase: 15000, feeMp: 0, montoNeto: 15000 });
  });

  it('suma múltiples entradas de fee_details y redondea el total', () => {
    // 897.5 + 100.8 = 998.3 → Math.round = 998
    const result = calcularMontosHub(30000, [{ amount: 897.5 }, { amount: 100.8 }]);
    expect(result.feeMp).toBe(998);
    expect(result.montoNeto).toBe(29002);
  });

  it('guard M-2: retorna null cuando monto bruto es 0 (mantiene lógica de Jefer)', () => {
    expect(calcularMontosHub(0, null)).toBeNull();
    expect(calcularMontosHub(0.4, null)).toBeNull(); // Math.round(0.4) = 0 → null
  });

  it('guard M-2: retorna null cuando monto bruto es negativo', () => {
    expect(calcularMontosHub(-100, null)).toBeNull();
  });

  it('guard M-2: retorna null cuando transaction_amount es null o undefined', () => {
    expect(calcularMontosHub(null, null)).toBeNull();
    expect(calcularMontosHub(undefined, null)).toBeNull();
  });

  it('guard neto <= 0: retorna null cuando fee supera el monto bruto (caso extremo MP)', () => {
    // MP podría reportar un fee de ajuste mayor al monto en devoluciones parciales
    expect(calcularMontosHub(1000, [{ amount: 1000 }])).toBeNull(); // neto = 0
    expect(calcularMontosHub(1000, [{ amount: 1500 }])).toBeNull(); // neto = -500
  });

  it('acepta entradas ya enteras sin alterar los valores', () => {
    const result = calcularMontosHub(29900, [{ amount: 897 }]);
    expect(result).toEqual({ montoBase: 29900, feeMp: 897, montoNeto: 29003 });
  });

  it('ignora entradas de fee_details con amount ausente o 0', () => {
    const result = calcularMontosHub(10000, [{ amount: 0 }, { amount: null }, { amount: 500 }]);
    expect(result.feeMp).toBe(500);
    expect(result.montoNeto).toBe(9500);
  });
});

// ── esEmailValidoParaHub ──────────────────────────────────────────────────────
// Cubre el hallazgo F-01 del gate de security: emails malformados que pasaban
// el guard anterior (!payerEmail) pero el Hub rechazaba con 422 igual.
describe('esEmailValidoParaHub (validación de formato de email antes de encolar)', () => {
  it('acepta emails con formato válido', () => {
    expect(esEmailValidoParaHub('usuario@ejemplo.com')).toBe(true);
    expect(esEmailValidoParaHub('a@b.com')).toBe(true);
    expect(esEmailValidoParaHub('user+tag@sub.dominio.co')).toBe(true);
  });

  it('rechaza cadena vacía', () => {
    expect(esEmailValidoParaHub('')).toBe(false);
  });

  it('rechaza email sin @ (F-01: causaba 422 en el Hub)', () => {
    expect(esEmailValidoParaHub('invalido')).toBe(false);
    expect(esEmailValidoParaHub('sinArroba.com')).toBe(false);
  });

  it('rechaza email sin punto en el dominio (F-01: causaba 422 en el Hub)', () => {
    expect(esEmailValidoParaHub('a@b')).toBe(false);
    expect(esEmailValidoParaHub('usuario@dominio')).toBe(false);
  });

  it('rechaza null y undefined', () => {
    expect(esEmailValidoParaHub(null)).toBe(false);
    expect(esEmailValidoParaHub(undefined)).toBe(false);
  });

  it('rechaza tipos no-string (número, objeto)', () => {
    expect(esEmailValidoParaHub(123)).toBe(false);
    expect(esEmailValidoParaHub({})).toBe(false);
  });
});

describe('parseExternalReference', () => {
  it('parsea el formato legacy de 2 segmentos USERID:tier (backward-compatible)', () => {
    expect(parseExternalReference('user-uuid-123:pro_solo')).toEqual({
      userId: 'user-uuid-123', tier: 'pro_solo', referralCode: null,
    });
  });

  it('parsea el formato extendido de 3 segmentos USERID:tier:refCode', () => {
    expect(parseExternalReference('user-uuid-123:pro_solo:ABC123')).toEqual({
      userId: 'user-uuid-123', tier: 'pro_solo', referralCode: 'ABC123',
    });
  });

  it('parsea 3 segmentos con refCode vacío como referralCode null', () => {
    expect(parseExternalReference('user-uuid-123:pro_solo:')).toEqual({
      userId: 'user-uuid-123', tier: 'pro_solo', referralCode: null,
    });
  });

  it('retorna nulls ante referencia ausente o mal formada', () => {
    expect(parseExternalReference(null)).toEqual({ userId: null, tier: null, referralCode: null });
    expect(parseExternalReference('sin_separador')).toEqual({ userId: null, tier: null, referralCode: null });
    // Más de 3 segmentos: formato no reconocido
    expect(parseExternalReference('a:b:c:d')).toEqual({ userId: null, tier: null, referralCode: null });
  });
});
