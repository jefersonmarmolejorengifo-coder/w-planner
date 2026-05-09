import {
  applyCors,
  assertProjectAccess,
  createSupabase,
  getAuthenticatedUser,
  getBearerToken,
  handleApiError,
} from "./_auth.js";
import { getResendConfig, normalizeRecipients, sanitizeReportHtml } from "./_email.js";

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { emails, html, weekStart, weekEnd, projectId } = req.body || {};
    const token = getBearerToken(req);
    const user = await getAuthenticatedUser(token);
    const supabase = createSupabase(token);
    await assertProjectAccess(supabase, user, projectId, { ownerOnly: true });

    const recipients = normalizeRecipients(emails);
    const safeHtml = sanitizeReportHtml(html);
    const { apiKey, from } = getResendConfig();

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: `Reporte Semanal Productivity-Plus · ${weekStart} al ${weekEnd}`,
        html: safeHtml,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(JSON.stringify(data.error || data));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return handleApiError(err, res);
  }
}
