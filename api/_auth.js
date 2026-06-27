import { createClient } from "@supabase/supabase-js";
import { jwtVerify, createRemoteJWKSet } from "jose";

const DEFAULT_APP_ORIGIN = "https://productivity-plus.vercel.app";

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

const splitOrigins = (value = "") =>
  value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

export const getSupabaseUrl = () =>
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

export const getSupabaseAnonKey = () =>
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export const getSupabaseServiceKey = () =>
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const getAllowedOrigins = () => {
  const origins = new Set([
    DEFAULT_APP_ORIGIN,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...splitOrigins(process.env.APP_BASE_URL),
    ...splitOrigins(process.env.ALLOWED_ORIGINS),
  ]);
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  return origins;
};

export const getAppBaseUrl = () => {
  const [configured] = splitOrigins(process.env.APP_BASE_URL);
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return DEFAULT_APP_ORIGIN;
};

export const getOrigin = (req) => {
  if (typeof req.headers?.get === "function") return req.headers.get("origin");
  return req.headers?.origin;
};

export const corsHeaders = (origin) => {
  const allowed = getAllowedOrigins();
  const allowOrigin = origin && allowed.has(origin) ? origin : DEFAULT_APP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Cron-Secret",
    "Vary": "Origin",
  };
};

export const applyCors = (req, res) => {
  const headers = corsHeaders(getOrigin(req));
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  return headers;
};

export const jsonResponse = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

// fetch con timeout duro (H-004). Evita que una API externa lenta cuelgue la
// función serverless hasta agotar su maxDuration. Si el caller ya pasa su
// propio AbortSignal, se respeta. Default 15s (suficiente para MP/Resend);
// para llamadas LLM en streaming usar un timeout mayor (~55s).
export const fetchWithTimeout = (url, options = {}, timeoutMs = 15000) =>
  fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(timeoutMs),
  });

// ── Validación ligera de inputs (H-021 tamaño / H-024 esquema) ──
// Helpers puros sin dependencias para no inflar los bundles ni el runtime edge
// con Zod/Joi. Lanzan un error con .status para que handleApiError/jsonError lo
// traduzcan al código correcto (400 inválido, 413 demasiado grande).
// 2000 chars: límite razonable para mensajes de chat. Antes era 8000, que es
// excesivo para un turno conversacional y amplía la superficie de payload abuse.
// Los endpoints que usaban 8000 no cambian de comportamiento visible para el
// usuario normal; solo bloquea payloads abusivos más temprano.
export const MAX_USER_MESSAGE_CHARS = 2000;

export class BadRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "BadRequestError";
    this.status = status;
  }
}

// Exige string no vacío y acotado. max excedido → 413 (payload too large).
export const requireString = (value, name, { min = 1, max = 10000, trim = true } = {}) => {
  if (typeof value !== "string") throw new BadRequestError(`${name} debe ser texto`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw new BadRequestError(`${name} es requerido`);
  if (v.length > max) throw new BadRequestError(`${name} excede el máximo de ${max} caracteres`, 413);
  return v;
};

// Exige entero positivo (ids de proyecto/sesión/etc.).
export const requirePositiveInt = (value, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestError(`${name} inválido`);
  return n;
};

// Exige que value sea uno de los permitidos (enums tipo tier/role).
export const requireEnum = (value, name, allowed) => {
  if (!allowed.includes(value)) throw new BadRequestError(`${name} inválido`);
  return value;
};

// Valida que un string sea una fecha YYYY-MM-DD con formato correcto Y que
// la fecha sea calendáricamente real (rechaza 2026-13-45 o 2026-02-30).
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

export const getBearerToken = (req) => {
  const auth =
    typeof req.headers?.get === "function"
      ? req.headers.get("authorization")
      : req.headers?.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
};

// fetch con timeout para el CLIENTE Supabase (H-025). Las queries de Supabase
// usan el fetch global por defecto, sin tope: una conexión colgada retiene la
// invocación serverless hasta agotar maxDuration. Inyectamos un AbortSignal.
// Más holgado que el de APIs externas (10s) porque cubre lecturas potencialmente
// grandes; si el caller ya pasa su propio signal, se respeta.
const SUPABASE_FETCH_TIMEOUT_MS = 10000;
const supabaseFetch = (url, options = {}) =>
  fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS) });

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

// Cliente admin (service_role) con el mismo timeout. Devuelve null si faltan las
// variables, para que el caller decida cómo degradar (503, omitir persistencia…).
export const createAdminClient = () => {
  const url = getSupabaseUrl();
  const key = getSupabaseServiceKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: supabaseFetch },
  });
};

// Verifica el JWT contra la JWKS pública de Supabase (firma criptográfica).
// No depende de auth.sessions; sobrevive logins múltiples y rotaciones de la
// tabla de sesiones que rompen `auth.getUser(token)` server-side.
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

// Rate limiting (H-010). Llama a la RPC check_rate_limit (migración 033) que
// incrementa un contador de ventana fija y devuelve si sigue dentro del límite.
// Lanza 429 si se excede. Fail-open ante errores de infraestructura (incluida la
// RPC ausente, 42883) para no romper la feature si la migración no está aplicada.
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

export const handleApiError = (err, res) => {
  const status = err.status || 500;
  return res.status(status).json({ error: err.message || "Error interno" });
};

// Verifica si el proyecto tiene IA habilitada Y su owner tiene premium activo.
// Lanza si no — los endpoints IA llaman esto antes de gastar tokens del LLM.
// Usa la RPC user_can_use_ia_on_project (migración 016).
//
// H-006: si la RPC no existe (42883) hacemos FAIL-CLOSED (bloqueamos) para no
// regalar IA de pago ante un deploy con migraciones incompletas. Solo se tolera
// la ausencia de la RPC si ALLOW_IA_WITHOUT_RPC="true" (uso en desarrollo).
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
