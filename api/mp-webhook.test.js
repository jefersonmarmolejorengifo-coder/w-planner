import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { verifyMpSignature, mapStatus, parseExternalReference } from './mp-webhook.js';

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
