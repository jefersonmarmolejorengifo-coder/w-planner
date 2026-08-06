// Regresión del flujo "unirse por código de invitación".
//
// Contexto: durante meses TODA invitación falló con "Código inválido o proyecto
// no encontrado". La causa real era un 23502 dentro del RPC
// join_project_by_invite_code (participants.id no tenía DEFAULT), pero
// joinProjectByCode devolvía `null` para cualquier fallo, así que el error del
// servidor se mostraba como si el usuario hubiera tecleado mal el código.
//
// Estos tests fijan la regla que impide que vuelva a pasar: un error del
// servidor NUNCA se puede presentar como "código inválido", y siempre tiene que
// quedar registrado en consola con su SQLSTATE.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();

vi.mock('../supabaseClient', () => ({
  supabase: {
    rpc: (...args) => rpc(...args),
    from: (...args) => from(...args),
  },
}));

const { joinProjectByCode } = await import('./joinProject');

const PROJECT = { id: 36, name: 'Pruba soft', invite_code: 'abc-123' };
const USER = { id: 'u-1', email: 'invitado@example.com', user_metadata: {} };

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('joinProjectByCode', () => {
  it('devuelve el proyecto cuando el RPC responde bien', async () => {
    rpc.mockResolvedValue({ data: PROJECT, error: null });

    const res = await joinProjectByCode('  abc-123  ', USER);

    expect(res).toEqual({ project: PROJECT, error: null });
    // El código se envía recortado, sin los espacios que deja un copiar/pegar.
    expect(rpc).toHaveBeenCalledWith('join_project_by_invite_code', { invite_code_input: 'abc-123' });
  });

  it('no llama al servidor si el código viene vacío', async () => {
    const res = await joinProjectByCode('   ', USER);

    expect(res.project).toBeNull();
    expect(res.error).toMatch(/Ingresa el código/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('traduce P0002 (código que no existe) a un mensaje de código inválido', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'Invalid invite code' } });

    const res = await joinProjectByCode('no-existe', USER);

    expect(res.project).toBeNull();
    expect(res.error).toMatch(/inválido/i);
  });

  it('traduce 28000 (sin sesión) a un mensaje de sesión, no de código', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '28000', message: 'Authentication required' } });

    const res = await joinProjectByCode('abc-123', null);

    expect(res.project).toBeNull();
    expect(res.error).toMatch(/sesión/i);
    expect(res.error).not.toMatch(/inválido/i);
  });

  // ── El test que representa el bug real de producción ───────────────────────
  it('un error de servidor (23502) NO se presenta como código inválido y queda logueado', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '23502', message: 'null value in column "id" of relation "participants"' },
    });

    const res = await joinProjectByCode('abc-123', USER);

    expect(res.project).toBeNull();
    expect(res.error).not.toMatch(/inválido/i);
    expect(res.error).toContain('23502');
    expect(console.error).toHaveBeenCalled();
    // Y sobre todo: no intenta el fallback directo, que la RLS bloquearía
    // devolviendo un "no encontrado" engañoso.
    expect(from).not.toHaveBeenCalled();
  });

  it('solo cae al fallback directo si el RPC no existe (42883)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function ... does not exist' } });

    const maybeSingle = vi.fn().mockResolvedValue({ data: PROJECT, error: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    from.mockImplementation((table) => {
      if (table === 'projects') return { select: () => ({ eq: () => ({ maybeSingle }) }) };
      if (table === 'project_members') return { upsert };
      throw new Error(`tabla inesperada: ${table}`);
    });

    const res = await joinProjectByCode('abc-123', USER);

    expect(res).toEqual({ project: PROJECT, error: null });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 36, email: USER.email, user_id: USER.id }),
      { onConflict: 'project_id,email' }
    );
  });

  it('informa que falta la migración si el RPC no existe y el fallback tampoco resuelve', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function ... does not exist' } });
    from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    }));

    const res = await joinProjectByCode('abc-123', USER);

    expect(res.project).toBeNull();
    expect(res.error).toMatch(/migración/i);
  });
});
