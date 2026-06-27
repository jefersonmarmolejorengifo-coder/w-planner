// Webhook de Mercado Pago. Recibe notificaciones de cambios en preapprovals
// y pagos autorizados; consulta la API de MP para obtener el estado real;
// actualiza users_premium en consecuencia.
//
// Configura en MP Dashboard: https://www.mercadopago.com.co/developers/panel
//   URL: https://w-planner.vercel.app/api/mp-webhook
//   Eventos: subscription_preapproval, subscription_authorized_payment

import { applyCors, createAdminClient, fetchWithTimeout } from "./_auth.js";
import { notificarPagoAlHub } from "./_hub-client.js";
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

// Parsea el external_reference que w-planner codifica en MP.
//
// Formatos soportados (backward-compatible):
//   2 segmentos (preapprovals antiguas): "userId:tier"
//   3 segmentos (nuevo formato):         "userId:tier:refCode"
//     → refCode puede ser vacío ("userId:tier:") si no hubo atribución.
//
// Devuelve { userId, tier, referralCode } donde referralCode es null si:
//   - formato de 2 segmentos (preapproval antigua)
//   - tercer segmento presente pero vacío
//
// Devuelve { userId: null, tier: null, referralCode: null } si el formato
// no es parseable (menos de 2 segmentos o más de 3).
export function parseExternalReference(ref) {
  if (!ref) return { userId: null, tier: null, referralCode: null };
  const parts = String(ref).split(":");
  if (parts.length === 2) {
    // Formato antiguo: backward-compatible, sin referral.
    return { userId: parts[0], tier: parts[1], referralCode: null };
  }
  if (parts.length === 3) {
    const referralCode = parts[2].trim() || null;
    return { userId: parts[0], tier: parts[1], referralCode };
  }
  // Más de 3 segmentos o 0-1: formato no reconocido.
  return { userId: null, tier: null, referralCode: null };
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  // MP envía GET para verificar URL y POST para eventos reales.
  if (req.method === "GET") return res.status(200).json({ ok: true, info: "MP webhook OK" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const mpToken = process.env.MP_ACCESS_TOKEN;
  if (!mpToken) return res.status(503).json({ error: "MP_ACCESS_TOKEN no esta configurado" });

  const admin = createAdminClient();
  if (!admin) {
    return res.status(503).json({ error: "Supabase no esta configurado" });
  }

  // El body de MP puede llegar como query params (?type=...&data.id=...) o
  // como JSON body. Soportamos ambos.
  const type = req.body?.type || req.query?.type;
  const dataId = req.body?.data?.id || req.query?.["data.id"] || req.body?.id;

  if (!type || !dataId) {
    // MP usa "ping" para test; no truenes con 4xx.
    return res.status(200).json({ ok: true, info: "missing type or id" });
  }

  // #4 — Sanitizar dataId antes de concatenarlo a URLs de MP.
  // Solo se permiten caracteres alfanuméricos, guion y guion bajo.
  // Un dataId con barras, puntos dobles u otros caracteres de escape
  // podría redirigir el fetch a una ruta distinta de la API de MP.
  // Respondemos 200 (no 4xx) para que MP no reintente indefinidamente.
  if (!/^[A-Za-z0-9_-]+$/.test(String(dataId))) {
    console.warn("[mp-webhook] dataId con caracteres inválidos, descartado:", dataId);
    return res.status(200).json({ ok: true, info: "invalid id format" });
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

  // ── Idempotencia con status (#1 — envenenamiento de idempotencia) ──
  // MP reintenta notificaciones ante cualquier respuesta que no sea 200.
  //
  // Problema anterior: el insert ocurría ANTES del procesamiento. Si el
  // procesamiento fallaba con 500, el reintento de MP chocaba contra el UNIQUE
  // (23505) y se devolvía "duplicate" → el pago nunca se procesaba.
  //
  // Solución: columna `status` en mp_webhook_events ('processing'|'processed').
  //   1. Insert con status='processing' (el evento quedó en vuelo).
  //   2. Si 23505: leer el status de la fila existente.
  //      - 'processed' → verdadero duplicado; 200 "duplicate ignored".
  //      - 'processing' → reintento legítimo de un intento anterior fallido;
  //        continuar procesando (NO devolver "duplicate").
  //   3. Al completar TODAS las escrituras críticas con éxito → marcar 'processed'.
  //   4. 42P01 (tabla ausente) → fail-open sin romper, igual que antes.
  //
  // Usa x-request-id (único por notificación) con fallback a "<type>:<dataId>".
  const eventId = String(req.headers["x-request-id"] || `${type}:${dataId}`);
  let dedupeTableExists = true; // asumimos que existe; 42P01 cambia esto
  try {
    const { error: dedupeErr } = await admin
      .from("mp_webhook_events")
      .insert({ event_id: eventId, event_type: type, data_id: String(dataId), status: "processing" });
    if (dedupeErr) {
      if (dedupeErr.code === "23505") {
        // Conflicto de clave única: puede ser duplicado real o reintento legítimo.
        // Leer el status de la fila existente para distinguir.
        const { data: existing, error: readErr } = await admin
          .from("mp_webhook_events")
          .select("status")
          .eq("event_id", eventId)
          .maybeSingle();
        if (readErr) {
          // No pudimos leer el status; asumir verdadero duplicado (safe default).
          console.warn("[mp-webhook] no se pudo leer status del evento duplicado:", readErr.message);
          return res.status(200).json({ ok: true, info: "duplicate event ignored (read error)" });
        }
        if (existing?.status === "processed") {
          // Verdadero duplicado: ya fue procesado exitosamente antes.
          return res.status(200).json({ ok: true, info: "duplicate event ignored" });
        }
        // status === 'processing' (o null por race condition): es un reintento
        // legítimo de un intento que no completó. Continuamos procesando.
        console.warn("[mp-webhook] evento en status 'processing'; reintento legítimo, continuando. event_id:", eventId);
      } else if (dedupeErr.code === "42P01") {
        // Tabla ausente (migración 040 no aplicada): fail-open, no bloqueamos el cobro.
        dedupeTableExists = false;
        console.warn("[mp-webhook] mp_webhook_events no existe (migración 040 pendiente); dedupe omitido.");
      } else {
        // Error inesperado: loguear pero continuar (fail-open).
        console.warn("[mp-webhook] dedupe insert falló:", dedupeErr.message);
      }
    }
  } catch (dedupeEx) {
    console.warn("[mp-webhook] dedupe excepción:", dedupeEx?.message);
  }

  // Helper para marcar el evento como procesado al final del flujo.
  // Solo actúa si la tabla existe y el insert/read no indicó saltar.
  const markProcessed = async () => {
    if (!dedupeTableExists) return;
    try {
      const { error: markErr } = await admin
        .from("mp_webhook_events")
        .update({ status: "processed" })
        .eq("event_id", eventId);
      if (markErr) console.warn("[mp-webhook] no se pudo marcar evento como processed:", markErr.message);
    } catch (markEx) {
      console.warn("[mp-webhook] excepción al marcar processed:", markEx?.message);
    }
  };

  try {
    if (type === "subscription_preapproval" || type === "preapproval") {
      const pa = await fetchPreapproval(dataId, mpToken);
      // referralCode del preapproval ya no se usa: la notificación al hub se
      // difirió al evento subscription_authorized_payment (ver comentario abajo).
      const { userId, tier } = parseExternalReference(pa.external_reference);
      if (!userId) {
        console.warn("[mp-webhook] preapproval sin external_reference parseable:", pa.external_reference);
        // Evento no procesable: marcamos 'processed' para no quedar en 'processing'.
        await markProcessed();
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

      // #2 — Chequear el error del upsert de users_premium.
      // Antes se ignoraba silenciosamente; si falla, el usuario pagó pero no
      // tiene premium. Devolver 500 para que MP reintente; NO marcar 'processed'
      // (el evento queda en 'processing' para el próximo intento).
      const { error: paUpsertErr } = await admin.from("users_premium").upsert(update, { onConflict: "user_id" });
      if (paUpsertErr) {
        console.error("[mp-webhook] upsert users_premium (preapproval) falló:", paUpsertErr.message);
        return res.status(500).json({ error: "internal error" });
      }

      // NO se notifica al hub aquí. El preapproval es la "autorización" del usuario
      // para el cobro, no un pago efectivo. Notificar aquí y también en
      // subscription_authorized_payment generaba comisión doble porque ambos eventos
      // usaban IDs distintos (pa_<preapprovalId> vs <payment.id>) que el UNIQUE del
      // hub no deduplica. La primera comisión se registra al llegar el evento
      // subscription_authorized_payment (primer cargo real confirmado por MP).

      await markProcessed();
      return res.status(200).json({ ok: true, processed: "preapproval", user: userId, new_status: status });
    }

    if (type === "subscription_authorized_payment" || type === "payment") {
      const payment = await fetchPayment(dataId, mpToken);
      // El payment puede venir asociado a un preapproval via payment.metadata.preapproval_id
      // o payment.preapproval_id según versión de la API.
      const preapprovalId = payment?.preapproval_id || payment?.metadata?.preapproval_id;
      const externalRef = payment?.external_reference;
      let userId = null;
      let tier = null;
      let referralCode = null;

      if (externalRef) {
        ({ userId, tier, referralCode } = parseExternalReference(externalRef));
      }

      // Para subscription_authorized_payment (cobro recurrente), MP frecuentemente
      // NO incluye external_reference en el payment. Hay que fetchear el preapproval
      // para obtenerlo. Este es el extra API call identificado por infra-scalability.
      let resolvedPa = null;
      if (preapprovalId && (!userId || !referralCode)) {
        resolvedPa = await fetchPreapproval(preapprovalId, mpToken);
        const parsed = parseExternalReference(resolvedPa.external_reference);
        if (!userId) userId = parsed.userId;
        if (!tier)   tier   = parsed.tier;
        // referralCode del preapproval solo se usa si el payment no traía ref propio
        if (!referralCode) referralCode = parsed.referralCode;
      }

      if (!userId) {
        console.warn("[mp-webhook] payment sin user resoluble:", dataId);
        // Evento no procesable (sin userId): marcamos 'processed' para que no
        // quede en 'processing' indefinidamente; no hay escritura crítica que
        // proteger y MP no puede hacer nada útil con un reintento.
        await markProcessed();
        return res.status(200).json({ ok: true, info: "no user resolvable" });
      }

      const update = {
        user_id: userId,
        last_payment_at: payment.date_approved || payment.date_created || new Date().toISOString(),
        status: payment.status === "approved" ? "active" : "past_due",
        metadata: { last_event: "payment", payment_id: payment.id, mp_status: payment.status },
      };
      // B-4: el cobro recurrente debe FIJAR el tier pagado. Antes este upsert solo
      // tocaba status, así que si el evento de payment llegaba antes (o sin) el de
      // preapproval-activo, el usuario pagaba y quedaba en 'free'. Solo promovemos
      // el tier en pagos aprobados y con tier resoluble del external_reference; en
      // past_due no tocamos el tier (el trigger de tableros ya limita por status,
      // y MP puede reintentar el cobro).
      if (payment.status === "approved" && tier) {
        update.tier = tier;
      }
      // #2 — Chequear el error del upsert de users_premium (rama payment).
      // Si falla: 500 para que MP reintente; NO marcar 'processed'.
      const { error: payUpsertErr } = await admin.from("users_premium").upsert(update, { onConflict: "user_id" });
      if (payUpsertErr) {
        console.error("[mp-webhook] upsert users_premium (payment) falló:", payUpsertErr.message);
        return res.status(500).json({ error: "internal error" });
      }

      // ── Notificación al hub (cobro recurrente) — H-048 outbox ───────────
      // Flujo de durabilidad de dos pasos:
      //   1. Encolar en hub_outbox (persistencia ANTES de llamar al hub).
      //   2. Intentar envío inmediato best-effort; actualizar el estado del registro.
      //
      // El hub deduplica por mp_payment_id (UNIQUE), por lo que reintentar es
      // idempotente. Si el hub está caído ahora, el cron drena los pendientes con
      // backoff exponencial. El cobro (users_premium) ya fue confirmado arriba;
      // este bloque NUNCA bloquea el return 200 a MP.
      if (payment.status === "approved") {
        const montoBase = payment.transaction_amount ?? 0;

        // M-2: no encolar al hub si el monto es COP$0 o null — evita registrar
        // comisiones de monto cero que podrían distorsionar el tablero de afiliados.
        if (!(montoBase > 0)) {
          console.warn("[mp-webhook] payment aprobado con monto <= 0; hub no notificado. payment_id:", payment.id);
        } else {
          // fee_mp_cop: algunos objetos payment incluyen fee_details.
          // Si no está disponible, se envía 0 y el hub puede calcularlo con su lógica.
          const feeMp = payment.fee_details
            ? payment.fee_details.reduce((sum, f) => sum + (f.amount || 0), 0)
            : 0;

          // Nombre del plan: si tenemos tier del external_reference lo usamos;
          // si no (preapproval muy antigua sin 3 segmentos), caemos a genérico.
          const planLabel = tier
            ? `Productivity Plus · ${tier}`
            : "Productivity Plus";

          const payerEmail =
            payment.payer?.email ||
            resolvedPa?.payer_email ||
            "";

          const mpPaymentId = String(payment.id);
          const hubPayload = {
            mp_payment_id:   mpPaymentId,
            cliente_email:   payerEmail.toLowerCase(),
            cliente_nombre:  payment.payer?.first_name
              ? `${payment.payer.first_name} ${payment.payer.last_name || ""}`.trim()
              : undefined,
            plan_o_producto: planLabel,
            monto_bruto_cop: montoBase,
            fee_mp_cop:      feeMp,
            monto_neto_cop:  montoBase - feeMp,
            ref_code:        referralCode ?? undefined,
            fecha_pago:      payment.date_approved || payment.date_created || new Date().toISOString(),
          };

          // Paso 1: encolar en hub_outbox (fail-open — no bloquea el cobro).
          // ignoreDuplicates: true → si MP reintenta el webhook y el registro ya
          // existe, no sobreescribe (idempotente). El admin client ya fue creado
          // al inicio del handler con createAdminClient() (service_role).
          let enqueued = false;
          try {
            const { error: upsertErr } = await admin
              .from("hub_outbox")
              .upsert(
                { mp_payment_id: mpPaymentId, payload: hubPayload, status: "pending" },
                { onConflict: "mp_payment_id", ignoreDuplicates: true },
              );
            if (upsertErr) {
              // No propagamos: el cobro ya fue registrado, la notificación al hub
              // es auxiliar. El cron no puede drenar lo que no se encoló, pero es
              // mejor eso que bloquear la respuesta a MP.
              console.error("[mp-webhook] hub_outbox upsert error:", upsertErr.message);
            } else {
              enqueued = true;
            }
          } catch (enqEx) {
            console.error("[mp-webhook] hub_outbox upsert excepción:", enqEx?.message);
          }

          // Paso 2: intentar envío inmediato best-effort (solo si el encolado fue ok).
          // Si falla, el registro queda en 'pending' para que el cron lo reintente.
          if (enqueued) {
            try {
              const r = await notificarPagoAlHub(hubPayload);
              if (r.ok || r.duplicado) {
                // Envío exitoso: marcar como sent. Guard .eq("status","pending") evita
                // sobrescribir si el cron ya lo procesó en paralelo (edge case).
                const { error: sentErr } = await admin
                  .from("hub_outbox")
                  .update({ status: "sent", sent_at: new Date().toISOString(), attempts: 1 })
                  .eq("mp_payment_id", mpPaymentId)
                  .eq("status", "pending");
                if (sentErr) {
                  console.warn("[mp-webhook] hub_outbox marcar sent falló:", sentErr.message);
                } else {
                  console.log("[mp-webhook] hub notificado y outbox marcado sent. mp_payment_id:", mpPaymentId, "txn:", r.transaccion_id);
                }
              } else {
                // Hub respondió con error: dejar en failed para reintento del cron.
                // next_attempt_at = ahora + 2 min (primer backoff).
                const nextAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
                const { error: failErr } = await admin
                  .from("hub_outbox")
                  .update({
                    status: "failed",
                    attempts: 1,
                    last_error: String(r.error ?? "hub respondió !ok").slice(0, 500),
                    next_attempt_at: nextAt,
                  })
                  .eq("mp_payment_id", mpPaymentId)
                  .eq("status", "pending");
                if (failErr) {
                  console.warn("[mp-webhook] hub_outbox marcar failed falló:", failErr.message);
                } else {
                  console.warn("[mp-webhook] hub no respondió ok; outbox en failed para reintento. mp_payment_id:", mpPaymentId, "error:", r.error);
                }
              }
            } catch {
              // Fail-open: la excepción de red/timeout del hub no propaga.
              // El registro sigue en 'pending' y el cron lo reintentará.
              // No logueamos el mensaje de la excepción (puede contener payload
              // con datos del pagador — A-2).
              console.error("[mp-webhook] hub envío inmediato excepción (omitida); outbox queda pending para cron.");
            }
          }
        }
      }

      await markProcessed();
      return res.status(200).json({ ok: true, processed: "payment", user: userId });
    }

    await markProcessed();
    return res.status(200).json({ ok: true, info: `evento ${type} ignorado` });
  } catch (err) {
    // Loguear el detalle real server-side (Vercel logs) sin exponerlo al caller.
    // err.message puede contener connection strings, tokens parciales u otros
    // datos internos; nunca debe llegar al body de respuesta que MP recibe
    // y potencialmente loguea en su dashboard.
    console.error("[mp-webhook] internal:", err);
    return res.status(500).json({ error: "internal error" });
  }
}
