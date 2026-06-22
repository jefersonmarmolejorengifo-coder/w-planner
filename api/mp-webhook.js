// Webhook de Mercado Pago. Recibe notificaciones de cambios en preapprovals
// y pagos autorizados; consulta la API de MP para obtener el estado real;
// actualiza users_premium en consecuencia.
//
// Configura en MP Dashboard: https://www.mercadopago.com.co/developers/panel
//   URL: https://w-planner.vercel.app/api/mp-webhook
//   Eventos: subscription_preapproval, subscription_authorized_payment

import { applyCors, fetchWithTimeout, getSupabaseServiceKey, getSupabaseUrl } from "./_auth.js";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const config = { runtime: "nodejs", maxDuration: 30 };

// Verifica la firma HMAC-SHA256 que Mercado Pago envía en la cabecera
// `x-signature` (formato: "ts=<unix>,v1=<hex>"). El manifest que MP firma es
//   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
// (data.id en minúsculas si es alfanumérico). Devuelve true sólo si la firma
// coincide. Si MP_WEBHOOK_SECRET no está configurado, devuelve null (modo
// retrocompatible: el caller decide, pero loguea una advertencia crítica).
export function verifyMpSignature(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return null; // no configurado todavía

  const sigHeader = req.headers["x-signature"] || "";
  const requestId = req.headers["x-request-id"] || "";
  if (!sigHeader) return false;

  // Parse "ts=...,v1=..."
  let ts = null, v1 = null;
  for (const part of String(sigHeader).split(",")) {
    const [k, v] = part.split("=").map((s) => (s || "").trim());
    if (k === "ts") ts = v;
    else if (k === "v1") v1 = v;
  }
  if (!ts || !v1) return false;

  const id = String(dataId ?? "").toLowerCase();
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  // Comparación en tiempo constante.
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(v1, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function fetchPreapproval(id, token) {
  const r = await fetchWithTimeout(`https://api.mercadopago.com/preapproval/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`MP preapproval fetch failed: ${r.status}`);
  return r.json();
}

async function fetchPayment(id, token) {
  const r = await fetchWithTimeout(`https://api.mercadopago.com/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`MP payment fetch failed: ${r.status}`);
  return r.json();
}

// Mapea el status de MP al status interno.
export function mapStatus(mpStatus) {
  switch ((mpStatus || "").toLowerCase()) {
    case "authorized": return "active";
    case "paused":     return "past_due";
    case "cancelled":  return "cancelled";
    case "pending":    return "pending";
    default:           return "pending";
  }
}

// Reverse: 'pro_solo:USERID' o 'USERID:pro_solo' (depende del orden que
// hayamos usado en mp-subscribe.js — usamos USER:tier).
export function parseExternalReference(ref) {
  if (!ref) return { userId: null, tier: null };
  const parts = String(ref).split(":");
  if (parts.length !== 2) return { userId: null, tier: null };
  return { userId: parts[0], tier: parts[1] };
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  // MP envía GET para verificar URL y POST para eventos reales.
  if (req.method === "GET") return res.status(200).json({ ok: true, info: "MP webhook OK" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const mpToken = process.env.MP_ACCESS_TOKEN;
  if (!mpToken) return res.status(503).json({ error: "MP_ACCESS_TOKEN no esta configurado" });

  const adminUrl = getSupabaseUrl();
  const adminKey = getSupabaseServiceKey();
  if (!adminUrl || !adminKey) {
    return res.status(503).json({ error: "Supabase no esta configurado" });
  }
  const admin = createClient(adminUrl, adminKey, { auth: { persistSession: false } });

  // El body de MP puede llegar como query params (?type=...&data.id=...) o
  // como JSON body. Soportamos ambos.
  const type = req.body?.type || req.query?.type;
  const dataId = req.body?.data?.id || req.query?.["data.id"] || req.body?.id;

  if (!type || !dataId) {
    // MP usa "ping" para test; no truenes con 4xx.
    return res.status(200).json({ ok: true, info: "missing type or id" });
  }

  // ── Verificación de firma (H-001 / H-013 fail-closed) ──
  // Exigimos firma HMAC válida para procesar cualquier evento. Dos rechazos:
  //   - firma inválida/ausente → 401.
  //   - MP_WEBHOOK_SECRET no configurado → 503 (fail-closed): NO concedemos
  //     premium sin poder verificar el origen. Solo se permite procesar sin
  //     secreto si ALLOW_MP_WEBHOOK_WITHOUT_SECRET=true (exclusivo para dev/test).
  const sigOk = verifyMpSignature(req, dataId);
  if (sigOk === false) {
    console.warn("[mp-webhook] firma inválida o ausente; evento rechazado");
    return res.status(401).json({ error: "invalid signature" });
  }
  if (sigOk === null) {
    if (process.env.ALLOW_MP_WEBHOOK_WITHOUT_SECRET === "true") {
      console.warn("[mp-webhook] DEV: MP_WEBHOOK_SECRET ausente y ALLOW_MP_WEBHOOK_WITHOUT_SECRET=true; firma NO verificada.");
    } else {
      console.error("[mp-webhook] CRÍTICO: MP_WEBHOOK_SECRET no configurado; evento rechazado (fail-closed). Configura el secreto en MP + Vercel.");
      return res.status(503).json({ error: "webhook signature secret not configured" });
    }
  }

  // ── Idempotencia (H-001) ──
  // MP reintenta notificaciones; registramos el id único del evento y, si ya
  // fue procesado, devolvemos 200 sin reprocesar. Usa x-request-id (único por
  // notificación) con fallback a "<type>:<dataId>".
  const eventId = String(req.headers["x-request-id"] || `${type}:${dataId}`);
  try {
    const { error: dedupeErr } = await admin
      .from("mp_webhook_events")
      .insert({ event_id: eventId, event_type: type, data_id: String(dataId) });
    if (dedupeErr) {
      if (dedupeErr.code === "23505") {
        // Clave duplicada → ya procesado.
        return res.status(200).json({ ok: true, info: "duplicate event ignored" });
      }
      // 42P01 (tabla inexistente) u otros: no bloqueamos el cobro, solo avisamos.
      if (dedupeErr.code !== "42P01") {
        console.warn("[mp-webhook] dedupe insert falló:", dedupeErr.message);
      }
    }
  } catch (dedupeEx) {
    console.warn("[mp-webhook] dedupe excepción:", dedupeEx?.message);
  }

  try {
    if (type === "subscription_preapproval" || type === "preapproval") {
      const pa = await fetchPreapproval(dataId, mpToken);
      const { userId, tier } = parseExternalReference(pa.external_reference);
      if (!userId) {
        console.warn("[mp-webhook] preapproval sin external_reference parseable:", pa.external_reference);
        return res.status(200).json({ ok: true, info: "no external_reference" });
      }
      const status = mapStatus(pa.status);
      const targetTier = tier && status === "active" ? tier : "free";

      const period = pa.auto_recurring || {};
      const update = {
        user_id: userId,
        tier: targetTier,
        status,
        mp_preapproval_id: String(pa.id),
        mp_payer_email: pa.payer_email || null,
        metadata: { last_event: "preapproval", mp_status: pa.status, mp_init_point: pa.init_point },
      };
      if (period?.last_charged_date) update.last_payment_at = period.last_charged_date;
      if (period?.next_charged_date) update.current_period_end = period.next_charged_date;
      if (pa.date_created)           update.current_period_start = pa.date_created;

      await admin.from("users_premium").upsert(update, { onConflict: "user_id" });
      return res.status(200).json({ ok: true, processed: "preapproval", user: userId, new_status: status });
    }

    if (type === "subscription_authorized_payment" || type === "payment") {
      const payment = await fetchPayment(dataId, mpToken);
      // El payment puede venir asociado a un preapproval via payment.metadata.preapproval_id
      // o payment.preapproval_id según versión de la API.
      const preapprovalId = payment?.preapproval_id || payment?.metadata?.preapproval_id;
      const externalRef = payment?.external_reference;
      let userId = null;
      if (externalRef) ({ userId } = parseExternalReference(externalRef));

      if (preapprovalId && !userId) {
        // Resolver el user via el preapproval
        const pa = await fetchPreapproval(preapprovalId, mpToken);
        ({ userId } = parseExternalReference(pa.external_reference));
      }
      if (!userId) {
        console.warn("[mp-webhook] payment sin user resoluble:", dataId);
        return res.status(200).json({ ok: true, info: "no user resolvable" });
      }

      const update = {
        user_id: userId,
        last_payment_at: payment.date_approved || payment.date_created || new Date().toISOString(),
        status: payment.status === "approved" ? "active" : "past_due",
        metadata: { last_event: "payment", payment_id: payment.id, mp_status: payment.status },
      };
      await admin.from("users_premium").upsert(update, { onConflict: "user_id" });
      return res.status(200).json({ ok: true, processed: "payment", user: userId });
    }

    return res.status(200).json({ ok: true, info: `evento ${type} ignorado` });
  } catch (err) {
    console.error("[mp-webhook] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
