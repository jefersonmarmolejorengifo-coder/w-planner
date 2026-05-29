// Crea una suscripción recurrente en Mercado Pago para el tier elegido.
// Devuelve el init_point (URL a la que el frontend redirige al usuario
// para autorizar el pago).
//
// Body: { tier: 'pro_solo' | 'pro_team' | 'pro_power' }
// Returns: { init_point, preapproval_id }

import {
  applyCors,
  createSupabase,
  getAuthenticatedUser,
  getBearerToken,
  getSupabaseServiceKey,
  getSupabaseUrl,
  handleApiError,
} from "./_auth.js";
import { createClient } from "@supabase/supabase-js";

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
    if (!tier || !["pro_solo", "pro_team", "pro_power"].includes(tier)) {
      return res.status(400).json({ error: "tier inválido" });
    }

    const token = getBearerToken(req);
    const user = await getAuthenticatedUser(token);

    // Usa el cliente con el token del usuario para honrar RLS al leer tier_limits.
    const supabase = createSupabase(token);

    const { data: tierRow, error: tierErr } = await supabase
      .from("tier_limits")
      .select("tier, display_name, price_cop, mp_plan_id")
      .eq("tier", tier)
      .maybeSingle();
    if (tierErr || !tierRow) {
      return res.status(400).json({ error: "tier no encontrado en tier_limits" });
    }

    const mpToken = ensure(process.env.MP_ACCESS_TOKEN, "MP_ACCESS_TOKEN no esta configurado", 503);

    const baseUrl = getAppBaseUrl();
    const backUrl = `${baseUrl}/billing/return`;

    // Body para Preapproval. Si tier_limits.mp_plan_id existe, se usa.
    // Si no, se define auto_recurring inline.
    const preapprovalBody = {
      reason: `Productivity-Plus · ${tierRow.display_name}`,
      external_reference: `${user.id}:${tier}`,
      payer_email: user.email,
      back_url: backUrl,
      status: "pending",
    };
    if (tierRow.mp_plan_id) {
      preapprovalBody.preapproval_plan_id = tierRow.mp_plan_id;
    } else {
      preapprovalBody.auto_recurring = {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: tierRow.price_cop,
        currency_id: "COP",
      };
    }

    const mpRes = await fetch("https://api.mercadopago.com/preapproval", {
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
    // cuando llegue el webhook. Usa service_role para bypassar RLS.
    const adminUrl = getSupabaseUrl();
    const adminKey = getSupabaseServiceKey();
    if (adminUrl && adminKey) {
      const admin = createClient(adminUrl, adminKey, { auth: { persistSession: false } });
      await admin.from("users_premium").upsert({
        user_id: user.id,
        tier: "free",          // se promueve a 'pro_*' cuando llegue el webhook
        status: "pending",
        mp_preapproval_id: mpData.id,
        mp_payer_email: user.email,
        metadata: { target_tier: tier },
      }, { onConflict: "user_id" });
    }

    return res.status(200).json({
      init_point: mpData.init_point,
      preapproval_id: mpData.id,
      tier: tier,
      price_cop: tierRow.price_cop,
    });
  } catch (err) {
    return handleApiError(err, res);
  }
}
