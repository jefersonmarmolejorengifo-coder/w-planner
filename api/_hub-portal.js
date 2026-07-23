// ── _hub-portal.js ────────────────────────────────────────────────────────────
// Construye el "link firmado" hacia el panel central de gestión de suscripción
// del Hub (Soft a Tu Medida): {HUB}/mi-suscripcion?app&email&ts&sig
//
// Gemelo de firma de _hub-client.js (firmar), pero el "body" firmado es el EMAIL
// normalizado, que es exactamente lo que el Hub verifica en su
// lib/suscripciones/link-firmado.ts:
//
//   sig = HMAC-SHA256(webhook_secret, `${slug}.${ts}.${emailNorm}`)
//
// El Hub normaliza el email igual (trim + lowercase) antes de verificar, así que
// ambos lados firman el MISMO string. La ventana del Hub es de 30 min.
//
// SEGURIDAD: vive en api/ (serverless), NUNCA en el bundle del SPA — el
// HUB_WEBHOOK_SECRET jamás llega al cliente. El link firmado se devuelve por
// fetch autenticado y el navegador navega a él.
//
// Env (ya existentes, mismas que _hub-client.js): HUB_WEBHOOK_URL (de su origin
// se deriva la base del Hub), HUB_APP_SLUG, HUB_WEBHOOK_SECRET.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";

/**
 * Devuelve la URL absoluta y firmada del panel /mi-suscripcion del Hub para
 * este email, o null si faltan las variables de entorno del Hub.
 * @param {string} email
 * @returns {string | null}
 */
export function construirUrlPortalHub(email) {
  const secret = process.env.HUB_WEBHOOK_SECRET;
  const slug = process.env.HUB_APP_SLUG;
  const webhookUrl = process.env.HUB_WEBHOOK_URL;

  if (!secret || !slug || !webhookUrl) {
    console.warn(
      "[hub-portal] Faltan variables del Hub (HUB_WEBHOOK_URL, HUB_APP_SLUG, " +
        "HUB_WEBHOOK_SECRET). No se puede construir el link.",
    );
    return null;
  }

  // La base del Hub es el origin del webhook (mismo dominio, sin el path).
  let baseUrl;
  try {
    baseUrl = new URL(webhookUrl).origin;
  } catch {
    console.warn("[hub-portal] HUB_WEBHOOK_URL no es una URL válida.");
    return null;
  }

  const emailNorm = String(email ?? "").trim().toLowerCase();
  if (!emailNorm) return null;

  const ts = Date.now().toString();
  // Mismo formato que el Hub verifica: `${slug}.${ts}.${email}` (email = body).
  const sig = crypto
    .createHmac("sha256", secret)
    .update(`${slug}.${ts}.${emailNorm}`)
    .digest("hex");

  const qs = new URLSearchParams({ app: slug, email: emailNorm, ts, sig });
  return `${baseUrl}/mi-suscripcion?${qs.toString()}`;
}
