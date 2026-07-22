// Fuente única de verdad de los modelos de IA por feature (H-022).
//
// Cada entrada tiene el `id` real que se invoca y la `label` legible para
// metadata/UI. Antes el id llamado y la metadata reportada se desincronizaban
// (p.ej. el reporte semanal llamaba a Sonnet 4.6 pero el header X-Wplanner-Model
// decía Opus 4.7). Centralizarlo evita que vuelvan a divergir.
//
// NOTA: el modelo que realmente se cobra/llama es el de las funciones API; este
// módulo no cambia esa decisión, solo la nombra en un solo lugar.
export const AI_MODELS = {
  // Reporte semanal del PO (api/generate-report.js).
  weeklyReport:  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  // Análisis mensual del equipo (api/generate-monthly-report.js).
  monthlyReport: { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  // Evolutivo bimensual (api/generate-evolution.js) — profundidad de análisis.
  evolution:     { id: "claude-opus-4-8",   label: "Opus 4.8" },
  // Chat IA en vivo (api/chat-stream.js).
  chat:          { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  // Reporte Scrum (api/generate-scrum-report.js) — Gemini, override por GEMINI_MODEL.
  scrumReport:   { id: "gemini-2.5-flash",  label: "Gemini Flash" },
};

// ─────────────────────────────────────────────────────────────────────────
// Precios y cálculo de costo (USD por 1M tokens, verificado jul-2026).
//
// Única fuente de verdad de precios: antes `generate-scrum-report.js` traía
// un precio de Gemini hardcodeado y desactualizado ($1.50/$9.00, ~5x el real)
// que sobreestimaba el costo. Centralizarlo aquí evita que un endpoint aislado
// quede con un precio viejo cuando el proveedor los actualiza.
//
// Si GEMINI_MODEL apunta a un modelo fuera de esta tabla, computeCostUsd
// devuelve null (no inventa un precio): mejor "sin dato" que un costo falso.
export const AI_PRICING = {
  "gemini-2.5-flash":  { input: 0.30, output: 2.50 },
  "claude-sonnet-4-6": { input: 3,    output: 15 },
  "claude-opus-4-8":   { input: 5,    output: 25 },
};

// Calcula el costo en USD de una llamada a partir de los tokens reales que
// devuelve el SDK/API (usage de Anthropic o usageMetadata de Gemini).
// cacheWriteTokens/cacheReadTokens son específicos de Anthropic prompt-caching
// (cache write = 1.25x el precio de input, cache read = 0.1x), y son 0 para
// proveedores sin caching (Gemini). Best-effort: nunca lanza, devuelve null
// ante datos insuficientes o modelo desconocido para no romper la generación
// ni el guardado del reporte por un cálculo de costo fallido.
export function computeCostUsd(modelId, { inputTokens, outputTokens, cacheWriteTokens = 0, cacheReadTokens = 0 } = {}) {
  try {
    const price = AI_PRICING[modelId];
    if (!price || inputTokens == null || outputTokens == null) return null;
    const usd = (
      inputTokens * price.input +
      outputTokens * price.output +
      (cacheWriteTokens || 0) * price.input * 1.25 +
      (cacheReadTokens || 0) * price.input * 0.1
    ) / 1_000_000;
    return Number.isFinite(usd) ? usd : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Marcador de uso en streams HTML (edge functions con streaming SSE).
//
// Los endpoints de reportes (generate-report.js, generate-monthly-report.js,
// generate-evolution.js) devuelven el HTML como un ReadableStream de texto
// plano, no JSON: los tokens de salida solo se conocen cuando Anthropic
// termina de transmitir, momento en el que la respuesta HTTP ya se envió
// (no se pueden agregar headers después de iniciado el body). Para que el
// costo real viaje igual hasta report_history/user_evolutions, el productor
// agrega un comentario HTML al final del stream (mismo patrón que el
// marcador WPLANNER_TRUNCATED ya usado en este repo) y el consumidor
// (api/cron.js o el frontend) lo extrae ANTES de sanitizar/enviar el email,
// dejando el HTML limpio otra vez.
const USAGE_MARKER_TAG = "WPLANNER_USAGE";
const USAGE_MARKER_RE = new RegExp(`<!--\\s*${USAGE_MARKER_TAG}:([\\s\\S]*?)-->`);

// usage: { model, tokensInput, tokensOutput, costUsd }. Devuelve el string a
// enqueuear al final del stream, o "" si algo falla (no debe romper el cierre
// del stream por un error de serialización).
export function embedUsageComment(usage) {
  try {
    const safe = {
      model: usage?.model ?? null,
      tokens_input: usage?.tokensInput ?? null,
      tokens_output: usage?.tokensOutput ?? null,
      cost_usd: usage?.costUsd ?? null,
    };
    return `\n<!-- ${USAGE_MARKER_TAG}:${JSON.stringify(safe)} -->\n`;
  } catch {
    return "";
  }
}

// Extrae el marcador de un texto ya completo (post-stream) y devuelve el
// HTML sin el comentario. Best-effort: si no hay marcador o el JSON quedó
// truncado/corrupto, devuelve usage: null y el texto original intacto.
export function extractUsageMarker(text) {
  const value = String(text || "");
  const match = value.match(USAGE_MARKER_RE);
  if (!match) return { usage: null, html: value };
  let usage = null;
  try {
    usage = JSON.parse(match[1].trim());
  } catch {
    usage = null;
  }
  const html = (value.slice(0, match.index) + value.slice(match.index + match[0].length)).trim();
  return { usage, html };
}
