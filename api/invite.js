import {
  applyCors,
  assertProjectAccess,
  createSupabase,
  getAppBaseUrl,
  getAuthenticatedUser,
  getBearerToken,
  handleApiError,
} from "./_auth.js";
import { getResendConfig } from "./_email.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, projectId } = req.body || {};
    const to = String(email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return res.status(400).json({ error: 'Correo inválido' });

    const token = getBearerToken(req);
    const user = await getAuthenticatedUser(token);
    const supabase = createSupabase(token);
    const { project } = await assertProjectAccess(supabase, user, projectId, { ownerOnly: true });

    const inviteUrl = `${getAppBaseUrl()}?join=${encodeURIComponent(project.invite_code)}`;
    const safeInviteUrl = escapeHtml(inviteUrl);
    const projectNameText = project.name || "Productivity-Plus";
    const projectName = escapeHtml(projectNameText);
    const inviteCode = escapeHtml(project.invite_code);
    const year = new Date().getFullYear();

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#ec6c04 0%,#149cac 100%);padding:32px;text-align:center;">
      <div style="font-size:48px;font-weight:900;color:#ffffff;letter-spacing:-2px;line-height:1;">P+</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.8);letter-spacing:4px;text-transform:uppercase;margin-top:6px;">Productivity-Plus</div>
    </div>
    <div style="padding:36px 32px;">
      <h2 style="margin:0 0 14px;font-size:22px;color:#1a1a2e;font-weight:700;">Te han invitado a colaborar</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7;">
        Has recibido una invitación para unirte al proyecto
        <strong style="color:#542c9c;">${projectName}</strong> en Productivity-Plus,
        la herramienta de gestión de equipos de alto rendimiento.
      </p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${safeInviteUrl}"
           style="background:linear-gradient(135deg,#ec6c04,#f07d1e);color:#ffffff;text-decoration:none;padding:15px 36px;border-radius:10px;font-weight:700;font-size:15px;display:inline-block;box-shadow:0 4px 16px rgba(236,108,4,0.35);">
          Unirse al proyecto →
        </a>
      </div>
      <div style="background:#f9f8fd;border:1px solid #ede8f8;border-radius:10px;padding:16px;margin-top:8px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#542c9c;text-transform:uppercase;letter-spacing:0.06em;">
          O usa este código de invitación:
        </p>
        <p style="margin:0;font-size:16px;font-family:monospace;color:#2d2d2d;letter-spacing:3px;font-weight:700;">
          ${inviteCode}
        </p>
      </div>
      <p style="margin:24px 0 0;font-size:12px;color:#999;line-height:1.5;">
        Si no esperabas esta invitación puedes ignorar este correo de manera segura.
      </p>
    </div>
    <div style="background:#0aa0ab;padding:18px;text-align:center;font-size:12px;color:rgba(255,255,255,0.85);">
      Productivity-Plus · ${year}
    </div>
  </div>
</body></html>`;

    const { apiKey, from } = getResendConfig();
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: `Invitación a ${projectNameText} — Productivity-Plus`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.json().catch(() => ({}));
      return res.status(500).json({ error: err.message || 'Error enviando invitación' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return handleApiError(err, res);
  }
}
