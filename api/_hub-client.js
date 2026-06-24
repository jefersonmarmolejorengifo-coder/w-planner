// hub-webhook-client v1 — adaptado para w-planner
//
// Notifica al hub financiero de Soft a tu Medida cuando un pago de MP
// es aprobado. Protocolo X-Hub-Version: 1 (HMAC-SHA-256).
//
// Mensaje firmado: appSlug + "." + timestamp + "." + rawBody
// Incluir appSlug en el mensaje previene que un atacante modifique el header
// X-App-Slug post-firma para atribuir el evento a otra app (ver guía hub).
//
// USO:
//   import { notificarPagoAlHub } from "./_hub-client.js";
//   const result = await notificarPagoAlHub({ ... });
//   if (!result.ok) console.warn("[hub] fallo no-crítico:", result.error);
//
// NUNCA propaga excepciones al caller. Todos los caminos de error devuelven
// { ok: false, error: string }. Si el hub está caído, el flujo de cobro
// de w-planner continúa sin interrupciones.

import crypto from "node:crypto";

// ── Configuración ────────────────────────────────────────────────────────────

/**
 * Lee y valida las tres variables de entorno requeridas para el hub.
 * Lanza Error con lista de claves faltantes para facilitar el diagnóstico.
 * @returns {{ url: string, secret: string, slug: string }}
 */
function getConfig() {
  const url    = process.env.HUB_WEBHOOK_URL;
  const secret = process.env.HUB_WEBHOOK_SECRET;
  const slug   = process.env.HUB_APP_SLUG;

  const missing = ["HUB_WEBHOOK_URL", "HUB_WEBHOOK_SECRET", "HUB_APP_SLUG"].filter(
    (k) => !process.env[k],
  );

  if (missing.length > 0) {
    throw new Error(
      `[hub-webhook-client] Faltan variables de entorno: ${missing.join(", ")}`,
    );
  }

  return { url, secret, slug };
}

// ── HMAC ─────────────────────────────────────────────────────────────────────

/**
 * Construye la firma HMAC-SHA-256.
 * Formato del mensaje: `"${appSlug}.${timestamp}.${rawBody}"`
 * @param {string} secret
 * @param {string} appSlug
 * @param {string} body     JSON serializado (exactamente el que se envía en el POST)
 * @param {string} timestamp  Unix ms como string
 * @returns {string} hex digest de 64 caracteres
 */
function firmar(secret, appSlug, body, timestamp) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${appSlug}.${timestamp}.${body}`)
    .digest("hex");
}

// ── Función principal ────────────────────────────────────────────────────────

/**
 * Notifica al hub financiero un pago aprobado de MercadoPago.
 *
 * Llamar esta función SOLO cuando el pago tiene status "approved" confirmado
 * por la API de MP. Si el hub está caído o responde con error, la función
 * devuelve { ok: false, error } sin lanzar excepciones — el flujo de cobro
 * de w-planner no se interrumpe.
 *
 * @param {object} payload
 * @param {string}  payload.mp_payment_id    ID del pago en MP (clave de idempotencia en el hub)
 * @param {string}  payload.cliente_email    Email del comprador (normalizado a lowercase en hub)
 * @param {string}  [payload.cliente_nombre] Nombre del comprador (puede ser null/undefined)
 * @param {string}  [payload.plan_o_producto] Etiqueta del plan, ej. "Productivity Plus · pro_solo"
 * @param {number}  payload.monto_bruto_cop  Total cobrado en COP (entero)
 * @param {number}  payload.fee_mp_cop       Fee de MP en COP (0 si no disponible)
 * @param {number}  payload.monto_neto_cop   monto_bruto_cop - fee_mp_cop
 * @param {string|null} [payload.ref_code]   Código de afiliado (null si llegó directo)
 * @param {string}  payload.fecha_pago       ISO 8601 del momento aprobado por MP
 * @param {number} [timeoutMs=8000]          Timeout en ms (AbortController)
 * @returns {Promise<{ ok: boolean, duplicado?: boolean, transaccion_id?: string, comision?: object|null, error?: string }>}
 */
export async function notificarPagoAlHub(payload, timeoutMs = 8_000) {
  let cfg;
  try {
    cfg = getConfig();
  } catch (e) {
    console.error("[hub-webhook-client] Configuración inválida:", e.message);
    return { ok: false, error: String(e.message) };
  }

  let body;
  try {
    body = JSON.stringify(payload);
  } catch (e) {
    console.error("[hub-webhook-client] No se pudo serializar el payload:", e.message);
    return { ok: false, error: "payload no serializable" };
  }

  const timestamp = Date.now().toString();
  const firma = firmar(cfg.secret, cfg.slug, body, timestamp);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Version": "1",
        "X-App-Slug":   cfg.slug,
        "X-Timestamp":  timestamp,
        "X-Signature":  firma,
      },
      body,
    });

    clearTimeout(timeoutId);

    let data;
    try {
      data = await res.json();
    } catch {
      // Hub respondió con body no-JSON (ej. error HTML de proxy/CDN)
      return {
        ok: false,
        error: `Hub respondió HTTP ${res.status} con body no-JSON`,
      };
    }

    if (!res.ok) {
      console.error(`[hub-webhook-client] HTTP ${res.status}:`, data?.error ?? data);
    }

    return data;
  } catch (e) {
    clearTimeout(timeoutId);

    if (e?.name === "AbortError") {
      return { ok: false, error: `Timeout después de ${timeoutMs}ms` };
    }

    console.error("[hub-webhook-client] Error de red:", e?.message ?? e);
    return { ok: false, error: "Error de red al llamar al Hub" };
  }
}
