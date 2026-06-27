// ── _supabase.js ──────────────────────────────────────────────────────────────
// Clientes Supabase (anon + admin) y getters de variables de entorno.
//
// DECISIONES DE DISEÑO:
//   - supabaseFetch y SUPABASE_FETCH_TIMEOUT_MS son privados: el caller nunca
//     necesita inyectar su propio fetch para Supabase; el timeout es fijo por
//     diseño (H-025). Si en el futuro se necesita configurabilidad, se expone.
//   - createAdminClient devuelve null si faltan variables (en lugar de lanzar)
//     para que el caller decida cómo degradar (503, omitir persistencia…).
//     createSupabase sí lanza porque un cliente anon sin credenciales no tiene
//     sentido de uso.
//   - Los env getters se exportan para que _auth.js (getAuthenticatedUser) y
//     otros módulos puedan leer SUPABASE_URL sin importar createClient.
//
// IMPORTADO POR: api/_auth.js (barrel) → todos los endpoints vía re-export.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

// ── Getters de variables de entorno ──────────────────────────────────────────
// Soportan tanto el prefijo VITE_ (frontend) como sin él (backend/serverless).

export const getSupabaseUrl = () =>
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

export const getSupabaseAnonKey = () =>
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export const getSupabaseServiceKey = () =>
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// ── fetch con timeout para el cliente Supabase (H-025) ───────────────────────
// Las queries de Supabase usan el fetch global por defecto, sin tope: una
// conexión colgada retiene la invocación serverless hasta agotar maxDuration.
// Inyectamos un AbortSignal más holgado que el de APIs externas (10s vs 15s)
// porque cubre lecturas potencialmente grandes. Si el caller ya pasa su propio
// signal, se respeta.
const SUPABASE_FETCH_TIMEOUT_MS = 10000;
const supabaseFetch = (url, options = {}) =>
  fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS) });

// ── Clientes ──────────────────────────────────────────────────────────────────

// Cliente anon o autenticado (según token) con timeout inyectado.
// admin=true usa la service_role key — solo para operaciones server-side
// que necesitan saltar RLS.
export const createSupabase = (token, { admin = false } = {}) => {
  const url = getSupabaseUrl();
  const key = admin ? getSupabaseServiceKey() : getSupabaseAnonKey();
  if (!url || !key) throw new Error("Supabase environment variables are missing");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: supabaseFetch,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    },
  });
};

// Cliente admin (service_role) con el mismo timeout. Devuelve null si faltan
// las variables, para que el caller decida cómo degradar (503, omitir persistencia…).
export const createAdminClient = () => {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: supabaseFetch },
  });
};
