import { createClient } from "@supabase/supabase-js";

const DEFAULT_APP_ORIGIN = "https://productivity-plus.vercel.app";

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

export const getBearerToken = (req) => {
  const auth =
    typeof req.headers?.get === "function"
      ? req.headers.get("authorization")
      : req.headers?.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
};

export const createSupabase = (token, { admin = false } = {}) => {
  const url = getSupabaseUrl();
  const key = admin ? getSupabaseServiceKey() : getSupabaseAnonKey();
  if (!url || !key) throw new Error("Supabase environment variables are missing");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
};

export const getAuthenticatedUser = async (token) => {
  if (!token) {
    const err = new Error("Authorization bearer token is required");
    err.status = 401;
    throw err;
  }

  const supabase = createSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error(error?.message || "Invalid or expired session");
    err.status = 401;
    throw err;
  }
  return data.user;
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

export const handleApiError = (err, res) => {
  const status = err.status || 500;
  return res.status(status).json({ error: err.message || "Error interno" });
};
