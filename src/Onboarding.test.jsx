// @vitest-environment jsdom
//
// Pruebas de COMPORTAMIENTO de Onboarding para el tour de PO en tableros
// recién creados (encargo: "quien crea un tablero como dueño arranca por el
// tour de PO, salvo que 'po' ya esté en completed_roles").
//
// supabase se recibe como PROP (no import de módulo), así que se pasa un
// doble simple que registra cada upsert() para poder inspeccionarlo, sin
// tocar red ni credenciales reales.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import Onboarding from './Onboarding.jsx';

const AUTH_USER = { id: 'user-1' };
const PROJECT_ID = 42;

// Doble de supabase: soporta el único patrón que usa Onboarding
//   .from("user_onboarding").select("*").eq(...).maybeSingle()
//   .from("user_onboarding").upsert(row, { onConflict })
//   .rpc("my_role_in_project", { p_project_id })
// upsertError(row) deja simular un fallo puntual (p.ej. 42703) según el
// payload que se intenta escribir, para probar la degradación.
function crearSupabaseFake({ onboardData = null, role = null, upsertError = null } = {}) {
  const upserts = [];
  return {
    upserts,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: onboardData, error: null }),
        }),
      }),
      upsert: async (row, opts) => {
        upserts.push({ row, opts });
        const err = typeof upsertError === 'function' ? upsertError(row) : null;
        return { error: err || null };
      },
    }),
    rpc: async (fn) => (fn === 'my_role_in_project' ? { data: role, error: null } : { data: null, error: null }),
  };
}

function noop() {}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Botón "Siguiente →" / "Terminar 🎉": único método robusto para llegar al
// final de un script real (evita hardcodear la longitud del array de pasos,
// que puede crecer). Tope de 30 clics como cinturón de seguridad.
async function avanzarHastaTerminar() {
  for (let i = 0; i < 30; i++) {
    const boton = screen.getByRole('button', { name: /Siguiente|Terminar/ });
    const esUltimo = /Terminar/.test(boton.textContent);
    fireEvent.click(boton);
    if (esUltimo) return;
  }
  throw new Error('No se alcanzó el botón "Terminar" tras 30 clics');
}

describe('Onboarding — tour de PO al crear el primer tablero como dueño', () => {
  it('arranca el tour de PO desde el paso 0 si "po" no está en completed_roles, aunque haya un tour de participante ya completado', async () => {
    const supabase = crearSupabaseFake({
      role: null,
      onboardData: {
        current_step: 6, completed_at: '2026-01-01T00:00:00Z', skipped: false,
        completed_roles: ['participant'],
      },
    });
    render(
      <Onboarding
        supabase={supabase} authUser={AUTH_USER} activeTab="board" setActiveTab={noop}
        forceOpen={false} enabled projectId={PROJECT_ID} isOwner
        justCreatedProjectId={PROJECT_ID} onJustCreatedHandled={noop}
      />
    );
    expect(await screen.findByText('Hola, Product Owner')).toBeTruthy();
    expect(screen.getByText(/Paso 1 de/)).toBeTruthy();

    // Se persiste el reinicio (current_step/completed_at/skipped), igual que
    // "Volver a ver tour" — sin tocar completed_roles (upsert parcial).
    await waitFor(() => expect(supabase.upserts.length).toBeGreaterThan(0));
    const escritura = supabase.upserts[0].row;
    expect(escritura.current_step).toBe(0);
    expect(escritura.completed_at).toBe(null);
    expect(escritura.skipped).toBe(false);
    expect('completed_roles' in escritura).toBe(false);
  });

  it('NO muestra ningún tour automático en un tablero recién creado si "po" ya está en completed_roles', async () => {
    const supabase = crearSupabaseFake({
      role: null,
      // completed_at/skipped deliberadamente "pendientes" (ambos falsy): si
      // el guard de completed_roles no existiera, el flujo genérico
      // igual mostraría el tour por esta combinación. Probamos que la
      // condición explícita es la que manda para un tablero justCreated.
      onboardData: { current_step: 0, completed_at: null, skipped: false, completed_roles: ['po'] },
    });
    render(
      <Onboarding
        supabase={supabase} authUser={AUTH_USER} activeTab="board" setActiveTab={noop}
        forceOpen={false} enabled projectId={PROJECT_ID} isOwner
        justCreatedProjectId={PROJECT_ID} onJustCreatedHandled={noop}
      />
    );
    // Deja correr el efecto asíncrono y confirma que nunca aparece diálogo.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBe(null);
    expect(supabase.upserts.length).toBe(0);
  });

  it('llama a onJustCreatedHandled una sola vez (señal de un solo uso) sin importar el resultado', async () => {
    const onJustCreatedHandled = vi.fn();
    const supabase = crearSupabaseFake({ role: null, onboardData: { completed_roles: ['po'] } });
    render(
      <Onboarding
        supabase={supabase} authUser={AUTH_USER} activeTab="board" setActiveTab={noop}
        forceOpen={false} enabled projectId={PROJECT_ID} isOwner
        justCreatedProjectId={PROJECT_ID} onJustCreatedHandled={onJustCreatedHandled}
      />
    );
    await waitFor(() => expect(onJustCreatedHandled).toHaveBeenCalledTimes(1));
  });
});

describe('Onboarding — entrar a un tablero EXISTENTE no dispara nada nuevo', () => {
  it('un dueño que reabre un tablero ya visto (no justCreated) no dispara ningún tour ni escritura si ya completó/saltó', async () => {
    const supabase = crearSupabaseFake({
      role: null,
      onboardData: { current_step: 3, completed_at: '2026-01-01T00:00:00Z', skipped: false, completed_roles: ['po'] },
    });
    render(
      <Onboarding
        supabase={supabase} authUser={AUTH_USER} activeTab="board" setActiveTab={noop}
        forceOpen={false} enabled projectId={PROJECT_ID} isOwner
        justCreatedProjectId={null} onJustCreatedHandled={noop}
      />
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBe(null);
    expect(supabase.upserts.length).toBe(0);
  });

  it('un participante invitado (no dueño, sin tour previo) sigue viendo su tour automático como hoy', async () => {
    const supabase = crearSupabaseFake({ role: 'participant', onboardData: null });
    render(
      <Onboarding
        supabase={supabase} authUser={AUTH_USER} activeTab="board" setActiveTab={noop}
        forceOpen={false} enabled projectId={PROJECT_ID} isOwner={false}
        justCreatedProjectId={null} onJustCreatedHandled={noop}
      />
    );
    expect(await screen.findByText('Hola, equipo')).toBeTruthy();
    // Nadie marcó este tablero como "recién creado": es el flujo genérico de
    // siempre (primer login sin fila en user_onboarding), no el nuevo atajo.
    expect(supabase.upserts.length).toBe(0);
  });

  it('justCreatedProjectId apuntando a OTRO proyecto no dispara el tour de PO en este tablero', async () => {
    const supabase = crearSupabaseFake({
      role: null,
      onboardData: { current_step: 0, completed_at: '2026-01-01T00:00:00Z', skipped: false, completed_roles: ['po'] },
    });
    render(
      <Onboarding
        supabase={supabase} authUser={AUTH_USER} activeTab="board" setActiveTab={noop}
        forceOpen={false} enabled projectId={PROJECT_ID} isOwner
        justCreatedProjectId={PROJECT_ID + 1} onJustCreatedHandled={noop}
      />
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBe(null);
  });
});

describe('Onboarding — completed_roles se acumula al completar o saltar', () => {
  it('al terminar el tour, agrega viewRole a completed_roles preservando los roles previos', async () => {
    const supabase = crearSupabaseFake({
      role: 'participant',
      onboardData: { current_step: 0, completed_at: null, skipped: false, completed_roles: ['scrum_master'] },
    });
    render(
      <>
        {/* Stubs de los targets que el script de participante apunta (Mi Día,
            Tablero): sin ellos, TourOverlay reintenta con setTimeout(80ms) x10
            por paso y esos timers sobreviven al desmontaje del test. */}
        <div data-tour="tab-focus" />
        <div data-tour="tab-board" />
        <Onboarding
          supabase={supabase} authUser={AUTH_USER} activeTab="board" setActiveTab={noop}
          forceOpen={false} enabled projectId={PROJECT_ID} isOwner={false}
          justCreatedProjectId={null} onJustCreatedHandled={noop}
        />
      </>
    );
    await screen.findByText('Hola, equipo');
    // Sin act() envolviendo el bucle entero: fireEvent ya lo aplica por clic,
    // y anidarlo en un act() externo diferiría el repintado hasta el final
    // (los 30 clics se acumularían sin que el DOM avance entre ellos).
    await avanzarHastaTerminar();

    await waitFor(() => {
      const ultima = supabase.upserts.at(-1).row;
      expect(ultima.completed_roles).toEqual(['scrum_master', 'participant']);
      expect(ultima.skipped).toBe(false);
      expect(typeof ultima.completed_at).toBe('string');
    });
  });

  it('al saltar el tour, agrega viewRole a completed_roles SIN duplicar si ya estaba', async () => {
    const supabase = crearSupabaseFake({
      role: 'participant',
      onboardData: { current_step: 0, completed_at: null, skipped: false, completed_roles: ['participant'] },
    });
    render(
      <Onboarding
        supabase={supabase} authUser={AUTH_USER} activeTab="board" setActiveTab={noop}
        forceOpen={false} enabled projectId={PROJECT_ID} isOwner={false}
        justCreatedProjectId={null} onJustCreatedHandled={noop}
      />
    );
    await screen.findByText('Hola, equipo');
    await act(async () => {
      fireEvent.click(screen.getByText('Saltar tour'));
    });

    await waitFor(() => {
      const ultima = supabase.upserts.at(-1).row;
      expect(ultima.completed_roles).toEqual(['participant']); // sin duplicado
      expect(ultima.skipped).toBe(true);
    });
  });
});

describe('Onboarding — degradación si completed_roles no existe (42703)', () => {
  it('reintenta sin completed_roles y no pierde el avance del tour', async () => {
    const supabase = crearSupabaseFake({
      role: 'participant',
      onboardData: { current_step: 0, completed_at: null, skipped: false, completed_roles: ['participant'] },
      upsertError: (row) => ('completed_roles' in row
        ? { code: '42703', message: 'column "completed_roles" of relation "user_onboarding" does not exist' }
        : null),
    });
    render(
      <Onboarding
        supabase={supabase} authUser={AUTH_USER} activeTab="board" setActiveTab={noop}
        forceOpen={false} enabled projectId={PROJECT_ID} isOwner={false}
        justCreatedProjectId={null} onJustCreatedHandled={noop}
      />
    );
    await screen.findByText('Hola, equipo');
    await act(async () => {
      fireEvent.click(screen.getByText('Saltar tour'));
    });

    await waitFor(() => expect(supabase.upserts.length).toBe(2));
    expect('completed_roles' in supabase.upserts[0].row).toBe(true); // intento 1: falla con 42703
    expect('completed_roles' in supabase.upserts[1].row).toBe(false); // reintento: sin la columna
    expect(supabase.upserts[1].row.skipped).toBe(true); // el resto del avance no se perdió
  });
});
