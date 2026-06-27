// ── _http.js ──────────────────────────────────────────────────────────────────
// CORS, respuestas JSON, fetch con timeout y handler de errores.
//
// DECISIONES DE DISEÑO:
//   - DEFAULT_APP_ORIGIN, splitOrigins y getAllowedOrigins son privados al módulo:
//     no forman parte de la API pública pero son necesarios para corsHeaders y
//     getAppBaseUrl, por eso viven aquí y no se exportan.
//   - fetchWithTimeout usa AbortSignal.timeout (disponible en Node 17+ y todos
//     los runtimes de Vercel actuales). Default 15s; para LLM streaming el caller
//     debe pasar un timeout mayor (~55s).
//   - handleApiError sigue la firma (err, res) compatible con Express/Connect para
//     los endpoints que usan el adaptador de Vercel.
//
// IMPORTADO POR: api/_auth.js (barrel) → todos los endpoints vía re-export.
// ─────────────────────────────────────────────────────────────────────────────

// Origen de producción por defecto. Se usa como fallback cuando el caller no
// provee un origin reconocido, y como valor base de APP_BASE_URL.
const DEFAULT_APP_ORIGIN = "https://productivity-plus.vercel.app";

// Divide una variable de entorno tipo "url1,url2" en un array limpio.
const splitOrigins = (value = "") =>
  value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

// Construye el Set de orígenes permitidos a partir de las variables de entorno.
// Se recalcula en cada llamada para reflejar cambios en env (relevante en tests).
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

// Devuelve la URL base canónica de la app (para links en emails, redirects, etc.).
// Prioridad: APP_BASE_URL → VERCEL_URL → DEFAULT_APP_ORIGIN.
export const getAppBaseUrl = () => {
  const [configured] = splitOrigins(process.env.APP_BASE_URL);
  if (configured) return configured.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return DEFAULT_APP_ORIGIN;
};

// Extrae el header "origin" de una Request (Fetch API) o de un IncomingMessage
// (Express). Abstrae la diferencia entre .get() y acceso directo a .headers.
export const getOrigin = (req) => {
  if (typeof req.headers?.get === "function") return req.headers.get("origin");
  return req.headers?.origin;
};

// Genera los headers CORS apropiados para el origin dado.
// Si el origin no está en la lista permitida, responde con DEFAULT_APP_ORIGIN
// (no bloquea, pero el browser rechazará la respuesta — comportamiento correcto).
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

// Aplica los headers CORS a una respuesta Express/Connect (res.setHeader).
// Devuelve el objeto de headers para que el caller pueda inspeccionarlos si lo necesita.
export const applyCors = (req, res) => {
  const headers = corsHeaders(getOrigin(req));
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  return headers;
};

// Construye una Response (Fetch API) con body JSON y Content-Type correcto.
// Acepta headers adicionales para que el caller pueda añadir CORS u otros.
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

// Handler de error compatible con Express/Connect: traduce err.status al código
// HTTP y devuelve { error: mensaje } como JSON.
// Los endpoints que usan la Fetch API (jsonResponse) manejan errores inline;
// este handler es para los que usan res.json() de Express.
export const handleApiError = (err, res) => {
  const status = err.status || 500;
  return res.status(status).json({ error: err.message || "Error interno" });
};
