import {
  applyCors,
  assertProjectAccess,
  createSupabase,
  enforceRateLimit,
  fetchWithTimeout,
  getAppBaseUrl,
  getAuthenticatedUser,
  getBearerToken,
  handleApiError,
} from "./_auth.js";
import { getResendConfig } from "./_email.js";
import { escapeHtml, layout, heading, paragraph, ctaButton, infoBox } from "./_email-brand.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Constructor puro: arma el HTML de la invitación con la misma identidad de
// marca que las plantillas de Supabase Auth (api/_email-brand.js). Recibe
// los valores CRUDOS (sin escapar) y escapa aquí mismo — así una prueba
// puede pasar un nombre de proyecto con `<script>` y comprobar que sale
// neutralizado en el HTML final, sin depender de que el llamador se acuerde
// de escapar antes.
export function buildInviteEmailHtml({ projectName, inviteCode, inviteUrl }) {
  const safeProjectName = escapeHtml(projectName || "Productivity-Plus");
  const safeInviteCode = escapeHtml(inviteCode);
  const safeInviteUrl = escapeHtml(inviteUrl);

  const contentHtml = `
      ${heading("Te han invitado a colaborar")}
      ${paragraph(`Has recibido una invitación para unirte al proyecto <strong style="color:#542c9c;">${safeProjectName}</strong> en Productivity-Plus, la herramienta de gestión de equipos de alto rendimiento.`)}
      ${ctaButton(safeInviteUrl, "Unirse al proyecto")}
      ${infoBox({ label: "O usa este código de invitación", value: safeInviteCode, mono: true })}
      ${paragraph("Si no esperabas esta invitación puedes ignorar este correo de manera segura.")}`;

  return layout({
    title: `Invitación a ${safeProjectName}`,
    preheader: `Te invitaron a colaborar en ${safeProjectName} en Productivity-Plus`,
    contentHtml,
    footerNote: "Recibes este correo porque alguien te invitó a un proyecto en Productivity-Plus.",
  });
}

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

    // Rate limit: 30 invitaciones/hora por usuario (H-010).
    await enforceRateLimit(supabase, { key: `invite:${user.id}`, max: 30, windowSeconds: 3600 });

    const inviteUrl = `${getAppBaseUrl()}/app?join=${encodeURIComponent(project.invite_code)}`;
    const projectNameText = project.name || "Productivity-Plus";
    const html = buildInviteEmailHtml({
      projectName: project.name,
      inviteCode: project.invite_code,
      inviteUrl,
    });

    const { apiKey, from } = getResendConfig();
    const resendRes = await fetchWithTimeout('https://api.resend.com/emails', {
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
