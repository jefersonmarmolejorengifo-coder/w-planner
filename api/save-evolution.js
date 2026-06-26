// Persiste en user_evolutions el HTML generado por /api/generate-evolution.
// El frontend consume el stream y llama acá con el HTML completo + metadata.
import {
  applyCors,
  assertProjectAccess,
  createAdminClient,
  createSupabase,
  getAuthenticatedUser,
  getBearerToken,
  handleApiError,
  requireDateRange,
} from "./_auth.js";
import { sanitizeRichHtml } from "./_email.js";
import { AI_MODELS } from "../src/aiModels.js";

export const config = { runtime: "nodejs", maxDuration: 30 };

function htmlToPlainText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      projectId, periodStart, periodEnd,
      html, modelUsed, tokensInput, tokensOutput, costUsd,
      truncated = false,
    } = req.body || {};

    if (!projectId || !html) {
      return res.status(400).json({ error: "projectId, periodStart, periodEnd y html son requeridos" });
    }
    // requireDateRange valida formato YYYY-MM-DD y que start < end (lexicográfico).
    // Rechaza periodos sin duración o invertidos: el upsert usa
    // (project_id, period_start, period_end) como clave de conflicto,
    // así que un periodo inválido podría sobrescribir un registro legítimo.
    requireDateRange(periodStart, periodEnd, { startName: "periodStart", endName: "periodEnd" });

    const token = getBearerToken(req);
    const user = await getAuthenticatedUser(token);
    const supabase = createSupabase(token);
    await assertProjectAccess(supabase, user, projectId, { ownerOnly: true });

    // Verificar feature
    const { data: canEvol } = await supabase.rpc("project_can_use_evolutivo", { p_project_id: Number(projectId) });
    if (canEvol !== true) {
      return res.status(402).json({ error: "Tu plan no incluye Evolutivo. Sube a Pro Power o Enterprise." });
    }

    // Insert via service_role (la tabla bloquea INSERT a authenticated por diseño).
    const admin = createAdminClient();
    if (!admin) {
      return res.status(503).json({ error: "Supabase admin no configurado" });
    }

    // Sanitiza el HTML generado por la IA antes de persistirlo (H-012). El
    // evolutivo se re-renderiza luego en un iframe; quitamos scripts/handlers/
    // CSS no permitido para no almacenar contenido potencialmente peligroso.
    const cleanHtml = sanitizeRichHtml(html);

    const payload = {
      project_id: projectId,
      period_start: periodStart,
      period_end: periodEnd,
      status: truncated ? "truncated" : "stored",
      cards: [],            // Se podría parsear desde el HTML; por ahora vacío.
      cell_suggestions: [],
      plain_text: htmlToPlainText(cleanHtml),
      html: cleanHtml,
      model_used: modelUsed || AI_MODELS.evolution.id,
      tokens_input: tokensInput || null,
      tokens_output: tokensOutput || null,
      cost_usd: costUsd || null,
      metadata: { generated_by: user.id },
    };

    const { data, error } = await admin
      .from("user_evolutions")
      .upsert(payload, { onConflict: "project_id,period_start,period_end" })
      .select("id, period_start, period_end")
      .single();
    if (error) throw new Error(error.message);

    return res.status(200).json({ ok: true, evolution: data });
  } catch (err) {
    return handleApiError(err, res);
  }
}
