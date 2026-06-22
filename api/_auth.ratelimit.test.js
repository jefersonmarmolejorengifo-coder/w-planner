import { describe, it, expect } from 'vitest';
import { enforceRateLimit } from './_auth.js';

// Fake del cliente Supabase: solo necesita .rpc(name, params).
const fakeSupabase = (rpcImpl) => ({ rpc: (...args) => rpcImpl(...args) });

describe('enforceRateLimit (H-010)', () => {
  it('no lanza cuando la RPC permite (data=true)', async () => {
    const sb = fakeSupabase(async () => ({ data: true, error: null }));
    await expect(enforceRateLimit(sb, { key: 'k', max: 5, windowSeconds: 60 })).resolves.toBeUndefined();
  });

  it('lanza 429 cuando se excede (data=false)', async () => {
    const sb = fakeSupabase(async () => ({ data: false, error: null }));
    try {
      await enforceRateLimit(sb, { key: 'k', max: 1, windowSeconds: 60 });
      throw new Error('no lanzó');
    } catch (e) {
      expect(e.status).toBe(429);
    }
  });

  it('fail-open si la RPC no existe (42883)', async () => {
    const sb = fakeSupabase(async () => ({ data: null, error: { code: '42883', message: 'missing' } }));
    await expect(enforceRateLimit(sb, { key: 'k', max: 5, windowSeconds: 60 })).resolves.toBeUndefined();
  });

  it('fail-open ante excepción de infraestructura', async () => {
    const sb = fakeSupabase(async () => { throw new Error('network'); });
    await expect(enforceRateLimit(sb, { key: 'k', max: 5, windowSeconds: 60 })).resolves.toBeUndefined();
  });

  it('pasa los parámetros correctos a la RPC', async () => {
    let captured = null;
    const sb = fakeSupabase(async (name, params) => { captured = { name, params }; return { data: true, error: null }; });
    await enforceRateLimit(sb, { key: 'invite:u1', max: 30, windowSeconds: 3600 });
    expect(captured.name).toBe('check_rate_limit');
    expect(captured.params).toEqual({ p_key: 'invite:u1', p_max: 30, p_window_seconds: 3600 });
  });
});
