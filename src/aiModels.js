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
