// ── subscription-portal.js ────────────────────────────────────────────────────
// GET /api/subscription-portal
//
// Devuelve la URL FIRMADA del panel central del Hub (/mi-suscripcion) para el
// usuario autenticado, que el cliente usa para navegar y gestionar o cancelar su
// plan (flujo de retención: motivo → oferta → confirmar).
//
// El email se toma del JWT verificado server-side (getAuthenticatedUser), NUNCA
// del body/query. El HUB_WEBHOOK_SECRET no sale del servidor: acá solo se
// devuelve el link ya firmado.
//
// Sin rate-limit dedicado: el endpoint es autenticado y solo firma el email
// PROPIO del usuario; la protección de dinero (rate-limit por IP + app_slug)
// vive en los endpoints /api/suscripciones/gestion/* del Hub.
// ─────────────────────────────────────────────────────────────────────────────

import {
  applyCors,
  getAuthenticatedUser,
  getBearerToken,
  handleApiError,
} from "./_auth.js";
import { construirUrlPortalHub } from "./_hub-portal.js";

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getAuthenticatedUser(getBearerToken(req));
    if (!user.email) {
      return res.status(400).json({ error: "Tu cuenta no tiene un email asociado." });
    }

    const url = construirUrlPortalHub(user.email);
    if (!url) {
      return res.status(503).json({ error: "El panel de gestión no está disponible ahora." });
    }

    return res.status(200).json({ url });
  } catch (err) {
    return handleApiError(err, res);
  }
}
