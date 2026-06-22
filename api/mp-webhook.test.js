import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { verifyMpSignature, mapStatus, parseExternalReference } from './mp-webhook.js';

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

describe('parseExternalReference', () => {
  it('parsea el formato USERID:tier', () => {
    expect(parseExternalReference('user-uuid-123:pro_solo')).toEqual({
      userId: 'user-uuid-123', tier: 'pro_solo',
    });
  });

  it('retorna nulls ante referencia ausente o mal formada', () => {
    expect(parseExternalReference(null)).toEqual({ userId: null, tier: null });
    expect(parseExternalReference('sin_separador')).toEqual({ userId: null, tier: null });
    expect(parseExternalReference('a:b:c')).toEqual({ userId: null, tier: null });
  });
});
