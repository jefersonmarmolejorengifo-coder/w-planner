// Persiste en user_evolutions el HTML generado por /api/generate-evolution.
// El frontend consume el stream y llama acá con el HTML completo + metadata.
import {
  applyCors,
  assertProjectAccess,
  createSupabase,
  getAuthenticatedUser,
  getBearerToken,
  getSupabaseServiceKey,
  getSupabaseUrl,
  handleApiError,
} from "./_auth.js";
import { createClient } from "@supabase/supabase-js";

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

const isDateOnly = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");

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

    if (!projectId || !isDateOnly(periodStart) || !isDateOnly(periodEnd) || !html) {
      return res.status(400).json({ error: "projectId, periodStart, periodEnd y html son requeridos" });
    }

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
    const adminUrl = getSupabaseUrl();
    const adminKey = getSupabaseServiceKey();
    if (!adminUrl || !adminKey) {
      return res.status(503).json({ error: "Supabase admin no configurado" });
    }
    const admin = createClient(adminUrl, adminKey, { auth: { persistSession: false } });

    const payload = {
      project_id: projectId,
      period_start: periodStart,
      period_end: periodEnd,
      status: truncated ? "truncated" : "stored",
      cards: [],            // Se podría parsear desde el HTML; por ahora vacío.
      cell_suggestions: [],
      plain_text: htmlToPlainText(html),
      html: html,
      model_used: modelUsed || "claude-opus-4-7",
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
