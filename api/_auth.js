// ── _auth.js ──────────────────────────────────────────────────────────────────
// Autenticación JWT, control de acceso a proyectos, rate limiting y billing.
//
// RESPONSABILIDAD: todo lo que requiere verificar identidad o permisos antes de
// ejecutar lógica de negocio. No gestiona HTTP ni validación de inputs; esas
// responsabilidades viven en _http.js y _validation.js respectivamente.
//
// BARREL AL FINAL: re-exporta _validation.js, _http.js y _supabase.js para que
// los ~15 endpoints que hacen `import { x } from "./_auth.js"` no necesiten
// cambiar sus imports. Cualquier símbolo que antes vivía en este archivo sigue
// disponible desde aquí.
//
// VERIFICACIÓN DE COLISIONES: los nombres exportados por cada módulo son disjuntos.
//   _validation.js → MAX_USER_MESSAGE_CHARS, BadRequestError, requireString,
//                    requirePositiveInt, requireEnum, isDateOnly, requireDateRange
//   _http.js       → getAppBaseUrl, getOrigin, corsHeaders, applyCors,
//                    jsonResponse, fetchWithTimeout, handleApiError
//   _supabase.js   → getSupabaseUrl, getSupabaseAnonKey, getSupabaseServiceKey,
//                    createSupabase, createAdminClient
//   _auth.js       → getBearerToken, getAuthenticatedUser, assertProjectAccess,
//                    enforceRateLimit, assertProjectCanUseIa
// ─────────────────────────────────────────────────────────────────────────────

import { jwtVerify, createRemoteJWKSet } from "jose";
import { getSupabaseUrl } from "./_supabase.js";

// ── JWKS (privado al módulo) ──────────────────────────────────────────────────
// Cachea el RemoteJWKSet para no reconstruir la URL en cada verificación.
// Se invalida si cambia SUPABASE_URL (útil en tests que alteran process.env).
let _jwksCache;
const getJwks = () => {
  const url = getSupabaseUrl();
  if (!url) throw new Error("Supabase URL is not configured");
  if (!_jwksCache || _jwksCache.url !== url) {
    _jwksCache = {
      url,
      jwks: createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`), {
        cacheMaxAge: 10 * 60 * 1000,
        cooldownDuration: 30 * 1000,
      }),
    };
  }
  return _jwksCache.jwks;
};

// ── Autenticación ─────────────────────────────────────────────────────────────

// Extrae el Bearer token del header Authorization. Devuelve null si no existe
// o si el header no sigue el formato "Bearer <token>".
export const getBearerToken = (req) => {
  const auth =
    typeof req.headers?.get === "function"
      ? req.headers.get("authorization")
      : req.headers?.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
};

// Verifica el JWT contra la JWKS pública de Supabase (firma criptográfica).
// No depende de auth.sessions; sobrevive logins múltiples y rotaciones de la
// tabla de sesiones que rompen `auth.getUser(token)` server-side.
// Lanza con .status 401 si el token es inválido o está expirado.
export const getAuthenticatedUser = async (token) => {
  if (!token) {
    const err = new Error("Authorization bearer token is required");
    err.status = 401;
    throw err;
  }

  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    const err = new Error("Supabase URL is not configured");
    err.status = 500;
    throw err;
  }

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `${supabaseUrl}/auth/v1`,
      audience: "authenticated",
      clockTolerance: 30,
    });
    if (!payload.sub) {
      const err = new Error("Token sin claim 'sub'");
      err.status = 401;
      throw err;
    }
    return {
      id: payload.sub,
      email: payload.email || null,
      role: payload.role || "authenticated",
      aud: payload.aud,
      app_metadata: payload.app_metadata || {},
      user_metadata: payload.user_metadata || {},
    };
  } catch (cause) {
    const err = new Error(cause?.message || "Sesión inválida o expirada");
    err.status = 401;
    throw err;
  }
};

// ── Control de acceso ─────────────────────────────────────────────────────────

// Verifica que el usuario tenga acceso al proyecto (owner o miembro).
// ownerOnly=true rechaza miembros con 403.
// Busca membresía por user_id y, si no encuentra, por email (invitados pendientes).
export const assertProjectAccess = async (supabase, user, projectId, { ownerOnly = false } = {}) => {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error("projectId inválido");
    err.status = 400;
    throw err;
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, invite_code, owner_id, config")
    .eq("id", id)
    .single();

  if (projectError || !project) {
    const err = new Error("Proyecto no encontrado");
    err.status = 404;
    throw err;
  }

  const isOwner = project.owner_id === user.id;
  if (isOwner) return { project, role: "owner" };

  if (ownerOnly) {
    const err = new Error("Solo el dueño del proyecto puede realizar esta acción");
    err.status = 403;
    throw err;
  }

  const { data: memberById } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  let member = memberById;
  if (!member && user.email) {
    const { data: memberByEmail } = await supabase
      .from("project_members")
      .select("id")
      .eq("project_id", id)
      .eq("email", user.email)
      .maybeSingle();
    member = memberByEmail;
  }

  if (!member) {
    const err = new Error("No tienes acceso a este proyecto");
    err.status = 403;
    throw err;
  }

  return { project, role: "member" };
};

// ── Rate limiting (H-010) ─────────────────────────────────────────────────────
// Llama a la RPC check_rate_limit (migración 033) que incrementa un contador de
// ventana fija y devuelve si sigue dentro del límite. Lanza 429 si se excede.
// Fail-open ante errores de infraestructura (incluida la RPC ausente, 42883)
// para no romper la feature si la migración no está aplicada.
//   key            identificador del bucket, p.ej. `invite:<userId>`
//   max            máximo de solicitudes por ventana
//   windowSeconds  tamaño de la ventana en segundos
export const enforceRateLimit = async (supabase, { key, max, windowSeconds }) => {
  try {
    const { data: allowed, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      if (error.code !== "42883") console.warn("[rateLimit] check falló:", error.message);
      return; // fail-open ante error de infra / RPC ausente
    }
    if (allowed === false) {
      const err = new Error("Demasiadas solicitudes. Espera un momento e intenta de nuevo.");
      err.status = 429;
      throw err;
    }
  } catch (e) {
    if (e?.status === 429) throw e;
    console.warn("[rateLimit] excepción:", e?.message);
  }
};

// ── Billing / IA (H-006) ──────────────────────────────────────────────────────
// Verifica si el proyecto tiene IA habilitada Y su owner tiene premium activo.
// Lanza si no — los endpoints IA llaman esto antes de gastar tokens del LLM.
// Usa la RPC user_can_use_ia_on_project (migración 016).
//
// Fail-CLOSED si la RPC no existe (42883): bloqueamos para no regalar IA de
// pago ante un deploy con migraciones incompletas. Solo se tolera la ausencia
// si ALLOW_IA_WITHOUT_RPC="true" (uso en desarrollo local).
export const assertProjectCanUseIa = async (supabase, projectId) => {
  const { data, error } = await supabase.rpc("user_can_use_ia_on_project", {
    p_project_id: Number(projectId),
  });
  if (error) {
    if (error.code === "42883") {
      // función no existe (migración 016 no aplicada).
      if (process.env.ALLOW_IA_WITHOUT_RPC === "true") {
        console.warn("[assertProjectCanUseIa] RPC ausente y ALLOW_IA_WITHOUT_RPC=true → se permite IA (modo dev).");
        return;
      }
      console.error("[assertProjectCanUseIa] RPC user_can_use_ia_on_project ausente; bloqueando IA (fail-closed). Aplica la migración 016.");
      const err = new Error("La verificación de plan no está disponible (migración pendiente). Contacta al administrador.");
      err.status = 503;
      throw err;
    }
    const err = new Error(`No pude verificar premium: ${error.message}`);
    err.status = 500;
    throw err;
  }
  if (data !== true) {
    const err = new Error("Este proyecto no tiene IA habilitada o la suscripción del owner no está activa. Activa el plan Pro o habilita IA en Configuración.");
    err.status = 402; // Payment Required
    throw err;
  }
};

// ── Barrel ────────────────────────────────────────────────────────────────────
// Re-exporta los módulos descompuestos para que todos los endpoints que hacen
// `import { x } from "./_auth.js"` sigan funcionando sin cambios.
// Los nombres son disjuntos entre los tres módulos y los de este archivo
// (verificado en el encabezado); no hay colisiones.
export * from "./_validation.js";
export * from "./_http.js";
export * from "./_supabase.js";
