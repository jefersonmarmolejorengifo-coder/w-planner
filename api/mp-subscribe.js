// Crea una suscripción recurrente en Mercado Pago para el tier elegido.
// Devuelve el init_point (URL a la que el frontend redirige al usuario
// para autorizar el pago).
//
// Body: { tier: 'pro_solo' | 'pro_team' | 'pro_power' }
// Returns: { init_point, preapproval_id }

import {
  applyCors,
  createAdminClient,
  fetchWithTimeout,
  getAuthenticatedUser,
  getBearerToken,
  handleApiError,
} from "./_auth.js";
import { PLANS, PLAN_CURRENCY, PLAN_FREQUENCY } from "../src/plans.js";

export const config = { runtime: "nodejs", maxDuration: 30 };

// Helpers locales: _auth.js no exporta assertNonNull, así que la inlineo aquí
// de forma defensiva si no existiera.
function ensure(value, msg, status = 500) {
  if (!value) {
    const err = new Error(msg); err.status = status; throw err;
  }
  return value;
}

const getAppBaseUrl = () =>
  process.env.APP_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://w-planner.vercel.app");

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { tier } = req.body || {};
    // Catálogo de planes definido en código (src/plans.js): editar un precio
    // allí cambia lo que se cobra aquí, sin tocar la BD ni el panel de MP.
    const plan = PLANS[tier];
    if (!plan || !plan.purchasable) {
      return res.status(400).json({ error: "tier inválido" });
    }

    const token = getBearerToken(req);
    const user = await getAuthenticatedUser(token);

    const mpToken = ensure(process.env.MP_ACCESS_TOKEN, "MP_ACCESS_TOKEN no esta configurado", 503);

    // Validar el admin de Supabase ANTES de crear la preapproval (H-019): si
    // falta la service_role no podríamos registrar el pending y el usuario pagaría
    // quedando sin upgrade. Fail-closed: 503 antes de iniciar el cobro.
    const admin = ensure(createAdminClient(), "Supabase admin no esta configurado", 503);

    const baseUrl = getAppBaseUrl();
    // Vuelve a la raíz de la SPA con un flag que el frontend detecta para
    // mostrar la confirmación del pago (no hay router, /billing/return no existe
    // como ruta). MP añade sus propios params (?preapproval_id=...&...) con '&'.
    const backUrl = `${baseUrl}/?billing=return`;

    // Cobro recurrente inline (auto_recurring) con precio y frecuencia del
    // catálogo en código. No usamos preapproval_plan_id porque los planes no se
    // crean en el panel de MP — viven en src/plans.js.
    const preapprovalBody = {
      reason: `Productivity-Plus · ${plan.displayName}`,
      external_reference: `${user.id}:${tier}`,
      payer_email: user.email,
      back_url: backUrl,
      status: "pending",
      auto_recurring: {
        frequency: PLAN_FREQUENCY.frequency,
        frequency_type: PLAN_FREQUENCY.frequency_type,
        transaction_amount: plan.priceCop,
        currency_id: PLAN_CURRENCY,
      },
    };

    const mpRes = await fetchWithTimeout("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify(preapprovalBody),
    });
    const mpData = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok) {
      console.error("[mp-subscribe] MP error:", mpData);
      return res.status(502).json({ error: "Mercado Pago rechazó la suscripción", details: mpData });
    }

    // Guarda el preapproval_id como pending en users_premium para reconciliar
    // cuando llegue el webhook. El admin (service_role) ya quedó validado arriba.
    await admin.from("users_premium").upsert({
      user_id: user.id,
      tier: "free",          // se promueve a 'pro_*' cuando llegue el webhook
      status: "pending",
      mp_preapproval_id: mpData.id,
      mp_payer_email: user.email,
      metadata: { target_tier: tier },
    }, { onConflict: "user_id" });

    return res.status(200).json({
      init_point: mpData.init_point,
      preapproval_id: mpData.id,
      tier: tier,
      price_cop: plan.priceCop,
    });
  } catch (err) {
    return handleApiError(err, res);
  }
}
