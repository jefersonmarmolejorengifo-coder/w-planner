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
import { getResendConfig, normalizeRecipients, sanitizeReportHtml } from "./_email.js";
import { createClient } from "@supabase/supabase-js";

const REPORT_TYPE_LABELS = {
  scrum: "Reporte Scrum",
  weekly_po: "Reporte Semanal",
  monthly_team: "Análisis Mensual del Equipo",
};

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
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      emails, html, weekStart, weekEnd, projectId,
      // Campos nuevos opcionales para el archivo histórico:
      reportType = "weekly_po",
      modelUsed,
      tokensInput,
      tokensOutput,
      costUsd,
      truncated = false,
    } = req.body || {};
    const token = getBearerToken(req);
    const user = await getAuthenticatedUser(token);
    const supabase = createSupabase(token);
    await assertProjectAccess(supabase, user, projectId, { ownerOnly: true });

    const recipients = normalizeRecipients(emails);
    const safeHtml = sanitizeReportHtml(html);
    const { apiKey, from } = getResendConfig();

    const label = REPORT_TYPE_LABELS[reportType] || "Reporte";
    const subject = `${label} Productivity-Plus · ${weekStart} al ${weekEnd}`;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html: safeHtml,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(JSON.stringify(data.error || data));

    // Persistir en report_history para que el reporte mensual pueda comparar
    // contra meses anteriores. Usamos service_role porque la tabla bloquea
    // INSERTs a roles authenticated por diseño.
    try {
      const url = getSupabaseUrl();
      const svc = getSupabaseServiceKey();
      if (url && svc) {
        const adminClient = createClient(url, svc, { auth: { persistSession: false } });
        await adminClient.from("report_history").insert({
          project_id: projectId,
          report_type: reportType,
          period_start: weekStart,
          period_end: weekEnd,
          status: truncated ? "truncated" : "sent",
          recipients,
          plain_text: htmlToPlainText(safeHtml),
          html: safeHtml,
          model_used: modelUsed || null,
          tokens_input: tokensInput || null,
          tokens_output: tokensOutput || null,
          cost_usd: costUsd || null,
        });
      }
    } catch (archiveErr) {
      // No bloquees el envío si el archivo falla; solo log.
      console.warn("[send-report] No pude archivar el reporte:", archiveErr?.message);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return handleApiError(err, res);
  }
}
