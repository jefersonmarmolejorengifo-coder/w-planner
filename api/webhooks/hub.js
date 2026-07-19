// api/webhooks/hub.js — Receptor del cable saliente Hub→w-planner
//
// QUÉ hace:
//   Recibe los eventos que el Hub (panel.softatumedida.com) emite sobre Wompi:
//   - `suscripcion.cobrada`: confirma el cobro de un ciclo recurrente. Escribe/
//     actualiza `public.users_premium` EXACTAMENTE como lo haría
//     `api/mp-webhook.js` en el camino feliz de un `subscription_authorized_payment`
//     aprobado.
//   - `pago.reembolsado`: un admin del Hub anuló un cobro por reembolso. Revoca
//     el acceso premium que ese cobro había otorgado (ver handlePagoReembolsado
//     para el razonamiento completo — w-planner no tiene ledger de pagos, así
//     que la revocación se basa en `users_premium.metadata.hub_evento_id`).
//
// POR QUÉ no necesita hub_outbox ni notificarPagoAlHub:
//   El Hub ya atribuyó la comisión al afiliado correspondiente antes de notificar.
//   Si este handler encolara en hub_outbox causaría una comisión DOBLE. La
//   responsabilidad de este endpoint es solo: recibir → verificar → escribir premium.
//
// SEGURIDAD — tres capas (protocolo X-Hub-Version: 1):
//   1. X-Hub-Version: "1" — versión del protocolo; rechaza payloads de versiones
//      futuras con semántica desconocida.
//   2. Ventana temporal ±5 min sobre X-Timestamp (en SEGUNDOS, no milisegundos,
//      porque _hub-client.js usa Date.now().toString() que son ms, pero la SPEC
//      del cable dice "unix segundos"). Ver nota en el paso de validación.
//   3. HMAC-SHA256 timingSafeEqual fail-closed: sin secreto → 503 (nunca conceder
//      premium sin verificar el origen).
//
// NOTA IMPORTANTE — unidad de X-Timestamp:
//   _hub-client.js (el EMISOR de w-planner→Hub) usa Date.now() (milisegundos).
//   La SPEC del cable Hub→app dice "unix segundos". El Hub es el emisor aquí;
//   el contrato a seguir es el de la SPEC. Este receptor acepta AMBAS unidades:
//   detecta si el valor es > 1e10 (umbral conservador para ms; ver parseTimestamp)
//   y convierte a segundos. Así no rompe si el Hub usa ms (al igual que
//   _hub-client.js), pero sí respeta la SPEC.
//
// CANDADO DE IDEMPOTENCIA — máquina de estados con self-healing:
//   Se usa la RPC hub_reclamar_evento (migración 041) en lugar de INSERT directo.
//   La RPC devuelve 'claimed' / 'duplicate' / 'in_flight' según el estado actual.
//   Si un worker muere entre reclamo y marcación, el evento queda en 'procesando';
//   a los 15 min la RPC lo auto-reclama (self-healing). Ver migración 041 para
//   el razonamiento completo del umbral y la máquina de estados.
//
// CONVENCIONES del repo (copiadas de api/mp-webhook.js):
//   - createAdminClient() de _supabase.js (service_role, bypasa RLS).
//   - `export const config = { runtime: "nodejs", maxDuration: 30 }` (Vercel).
//   - Logueo con prefijo `[hub-webhook]`.
//   - No se exponen detalles de error al caller (solo códigos HTTP + mensaje genérico).
//   - Nunca se loguea el secreto, la firma completa, ni PII cruda.

import { createAdminClient } from "../_supabase.js";
import crypto from "node:crypto";

export const config = { runtime: "nodejs", maxDuration: 30 };

// ── Constantes ────────────────────────────────────────────────────────────────

/** Ventana anti-replay: ±5 minutos en segundos. */
const TIMESTAMP_WINDOW_S = 5 * 60;

/**
 * Mapa de plan_codigo del Hub → tier interno de w-planner.
 *
 * El Hub envía el código canónico del plan (definido en su catálogo).
 * w-planner usa códigos propios que deben coincidir con `public.tier_limits.tier`.
 *
 * Trade-off: este mapa vive en código, no en BD, para evitar un round-trip extra
 * en cada webhook. Si se añade un plan nuevo al Hub, hay que actualizar aquí Y
 * en `public.tier_limits`. Ese acoplamiento es aceptable dado que los planes
 * cambian raramente. Si en el futuro hubiera +5 planes, se puede migrar a una
 * tabla de configuración.
 */
const PLAN_HUB_A_INTERNO = {
  pro:       "pro_solo",
  proteam:   "pro_team",
  propower:  "pro_power",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Enmascara un email para logging: expone los primeros 2 caracteres + dominio.
 * Ejemplo: "jeferson.marmolejo@gmail.com" → "je***@gmail.com"
 * Nunca revela la parte local completa (puede contener nombre real — PII).
 *
 * @param {string} email
 * @returns {string}
 */
function maskEmail(email) {
  if (!email || typeof email !== "string") return "[email inválido]";
  const at = email.indexOf("@");
  if (at < 0) return "[email sin @]";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * Normaliza el timestamp del header X-Timestamp a segundos.
 *
 * La SPEC del protocolo dice "unix segundos". Pero por compatibilidad también
 * se acepta el formato de milisegundos (como el que usa _hub-client.js con
 * Date.now()). El umbral de detección es 1e10:
 *
 *   - Timestamps Unix en SEGUNDOS (2026): ~1.75e9 → menores a 1e10 → se usan tal cual.
 *   - Timestamps Unix en MILISEGUNDOS (2026): ~1.75e12 → mayores a 1e10 → se dividen por 1000.
 *
 * El umbral 1e10 (año ~2286 en segundos) es conservador: ningún timestamp válido
 * en segundos de fechas razonables llegará a ese valor, pero cualquier timestamp
 * en ms de fechas actuales lo supera ampliamente.
 *
 * @param {string} raw  Valor del header X-Timestamp
 * @returns {number|null}  Segundos, o null si el valor no es un número válido
 */
function parseTimestamp(raw) {
  const n = parseInt(raw, 10);
  if (isNaN(n) || n <= 0) return null;
  // Timestamps en ms de fechas actuales (~1.75e12) superan 1e10;
  // timestamps en segundos (~1.75e9) son menores a 1e10 → se usan directamente.
  return n > 1e10 ? Math.floor(n / 1000) : n;
}

/**
 * Verifica la firma HMAC-SHA256 del Hub.
 *
 * Mensaje firmado: `${appSlug}.${timestampHeader}.${rawBody}`
 * Incluir appSlug en el mensaje cierra el vector de reatribución:
 * si alguien captura un webhook de otra app y cambia solo el header
 * X-App-Slug, la firma no coincide porque el slug ya está dentro del mensaje.
 *
 * Se compara sobre los strings hex (no buffers de bytes del hash) para que
 * la longitud sea siempre igual (64 caracteres) y timingSafeEqual no falle
 * por diferencia de tamaño cuando la firma recibida tiene longitud incorrecta.
 * Si la firma recibida no tiene 64 caracteres devuelve false sin lanzar.
 *
 * @param {string} secret
 * @param {string} appSlug         Valor del header X-App-Slug
 * @param {string} timestampHeader Valor RAW del header X-Timestamp (para HMAC)
 * @param {string} rawBody         Body exacto recibido (sin parsear)
 * @param {string} receivedSig     Valor del header X-Signature
 * @returns {boolean}
 */
function verifyHubSignature(secret, appSlug, timestampHeader, rawBody, receivedSig) {
  const mensaje = `${appSlug}.${timestampHeader}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(mensaje)
    .digest("hex");

  // timingSafeEqual requiere buffers de igual longitud. Usamos strings hex
  // (siempre 64 chars del HMAC) para comparar. Si receivedSig no es hex de
  // 64 chars, la longitud difiere → devolvemos false sin lanzar.
  try {
    const expBuf = Buffer.from(expected, "utf8");
    const recBuf = Buffer.from(receivedSig, "utf8");
    if (expBuf.byteLength !== recBuf.byteLength) return false;
    return crypto.timingSafeEqual(expBuf, recBuf);
  } catch {
    return false;
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/hub
 *
 * Receptor del cable saliente Hub→w-planner (protocolo X-Hub-Version: 1).
 * Maneja `suscripcion.cobrada` y `pago.reembolsado`; otros eventos se aceptan
 * con 200+skipped para forward-compat (no romper con 4xx cuando el Hub añada
 * eventos nuevos).
 *
 * Flujo (fail-closed en autenticación, continuidad en fallos transitorios):
 *   1. Solo POST.
 *   2. Verificar X-Hub-Version === '1'.
 *   3. Verificar presencia de X-App-Slug, X-Timestamp, X-Signature.
 *   4. Ventana temporal ±5 min (anti-replay).
 *   5. Verificar secreto y HMAC (fail-closed: sin secreto → 503).
 *   6. Parsear JSON. Validar payload.app_slug === 'w-planner'.
 *   7. Dispatch por evento. No manejado → 200 skipped (forward-compat).
 *   8. Para 'suscripcion.cobrada' (ver handleSuscripcionCobrada):
 *      a. Reclamo atómico vía RPC hub_reclamar_evento.
 *         - 'duplicate' → 200 (idempotente, ya procesado).
 *         - 'in_flight' → 200 (otra corrida activa; self-healing a los 15 min).
 *         - 'claimed'   → continuar.
 *      b. Resolver usuario por email (RPC). Sin usuario → parquear → 200.
 *      c. Mapear plan_codigo. Plan desconocido → parquear → 200.
 *      d. Upsert users_premium.
 *      e. En éxito: marcar evento procesado → 200.
 *      f. En fallo: revertir evento → 500 (reintentable; self-heal si falla).
 *   9. Para 'pago.reembolsado' (ver handlePagoReembolsado): mismo candado de
 *      idempotencia y resolución por email; revoca tier/status en users_premium
 *      SOLO si el cobro reembolsado es el que otorgó el acceso vigente.
 */
export default async function handler(req, res) {
  // ── 1. Solo POST ────────────────────────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Leer RAW body ───────────────────────────────────────────────────────────
  // La firma HMAC se verifica sobre los bytes exactos que llegaron.
  // Si parseáramos primero (req.body de Vercel) y re-serializáramos, cualquier
  // diferencia de formato JSON (orden de keys, espacios, unicode escapes)
  // rompería la verificación. EXACTAMENTE el mismo patrón que mp-webhook.js.
  //
  // Vercel inyecta req.body parseado por defecto. Para acceder al raw body
  // debemos leer el stream directamente, igual que lo hace VoxLab en Next.js
  // con request.text(). En Vercel Functions (Node.js runtime) el body llega
  // pre-parseado en req.body, pero el raw string se puede reconstruir desde
  // el stream si no se ha consumido, o desde req.body si es un objeto.
  //
  // DECISIÓN: usamos la técnica probada en el repo: leer el stream con chunks.
  // Si el body ya fue consumido (req.body existe), serialize req.body como
  // fallback. Esto es consistente con el patrón de VoxLab (request.text()).
  // Cubrimos TODAS las formas en que @vercel/node puede entregar el cuerpo,
  // en orden de fidelidad (de más a menos crudo):
  //   1. Stream sin consumir (req.readable) → bytes exactos. Ideal.
  //   2. req.body ya parseado por Vercel (Content-Type: application/json).
  //      Reconstruimos con JSON.stringify(req.body). VERIFICADO byte-a-byte
  //      para el payload de este cable (scratchpad/probar-rawbody-hmac.mjs,
  //      2026-07-02): el emisor firma JSON.stringify(payload_jsonb) sin espacios,
  //      con claves NO enteras y valores string/int/null → la identidad
  //      JSON.stringify(JSON.parse(x)) === x se cumple aun con tildes, ñ, emoji,
  //      comillas, slashes y orden de claves arbitrario. Por eso el HMAC calza.
  //   3. Buffer o string crudos → se usan tal cual.
  let rawBody;
  try {
    if (req.readable) {
      rawBody = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
      });
    } else if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString("utf8");
    } else if (typeof req.body === "string") {
      rawBody = req.body;
    } else if (req.body && typeof req.body === "object") {
      rawBody = JSON.stringify(req.body);
    } else {
      // Ni stream ni body → nada que verificar. Fail-closed.
      console.warn("[hub-webhook] request sin cuerpo legible");
      return res.status(400).json({ error: "empty_body" });
    }
  } catch (err) {
    console.error("[hub-webhook] error leyendo body:", err?.message);
    return res.status(400).json({ error: "body read error" });
  }

  // ── 2. Verificar versión del protocolo ─────────────────────────────────────
  // Solo entendemos la versión "1". Si el Hub sube a "2" con breaking changes,
  // rechazamos con 400 hasta actualizar el receptor — mejor error claro que
  // procesar un payload con semántica incorrecta.
  const version = req.headers["x-hub-version"];
  if (version !== "1") {
    console.warn("[hub-webhook] versión de protocolo no soportada:", version);
    return res.status(400).json({ error: "unsupported_protocol_version" });
  }

  // ── 3. Verificar presencia de headers requeridos ───────────────────────────
  const appSlugHeader   = req.headers["x-app-slug"];
  const timestampHeader = req.headers["x-timestamp"];
  const signatureHeader = req.headers["x-signature"];

  if (!appSlugHeader || !timestampHeader || !signatureHeader) {
    console.warn("[hub-webhook] headers requeridos ausentes");
    return res.status(401).json({ error: "missing_required_headers" });
  }

  // ── 4. Ventana temporal (anti-replay) ──────────────────────────────────────
  // Un atacante que capture un request válido no puede re-enviarlo ±5 min
  // después: el HMAC incluye el timestamp y la firma ya no coincide con
  // el body sin modificar el timestamp.
  const tsSeconds = parseTimestamp(timestampHeader);
  if (tsSeconds === null) {
    console.warn("[hub-webhook] X-Timestamp inválido:", timestampHeader);
    return res.status(401).json({ error: "invalid_timestamp" });
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - tsSeconds) > TIMESTAMP_WINDOW_S) {
    console.warn("[hub-webhook] timestamp fuera de ventana:", {
      ts: tsSeconds,
      now: nowSeconds,
      delta: nowSeconds - tsSeconds,
    });
    return res.status(401).json({ error: "timestamp_out_of_window" });
  }

  // ── 5. Verificar HMAC (fail-closed) ────────────────────────────────────────
  // Sin secreto → 503 (no concedemos premium sin poder verificar el origen).
  // Con secreto → timingSafeEqual fail-closed. Ver verifyHubSignature().
  const secret = process.env.HUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[hub-webhook] CRÍTICO: HUB_WEBHOOK_SECRET no configurado; evento rechazado (fail-closed)");
    return res.status(503).json({ error: "webhook_secret_not_configured" });
  }

  const signatureOk = verifyHubSignature(secret, appSlugHeader, timestampHeader, rawBody, signatureHeader);
  if (!signatureOk) {
    // No revelar por qué falló la verificación al caller (no ayudar al atacante).
    console.warn("[hub-webhook] firma HMAC inválida; evento rechazado");
    return res.status(401).json({ error: "invalid_signature" });
  }

  // ── 6. Parsear JSON y validar app_slug del payload ─────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  // Doble validación del app_slug:
  //   - El header X-App-Slug ya está incluido en el HMAC (paso 5).
  //   - El payload.app_slug debe coincidir con el valor esperado.
  // Si difieren, alguien envió un payload de otra app con el header correcto,
  // o hay un error de configuración en el Hub. Rechazar explícitamente evita
  // procesar cobros destinados a otra app.
  // IMPORTANTE: esta validación va ANTES de tocar la BD para no insertar
  // candados de idempotencia por payloads inválidos.
  if (payload.app_slug !== "w-planner") {
    console.warn("[hub-webhook] app_slug inesperado en payload:", {
      esperado: "w-planner",
      recibido: payload.app_slug,
    });
    return res.status(401).json({ error: "unauthorized" });
  }

  // Validar evento_id requerido (clave de idempotencia).
  if (!payload.evento_id || typeof payload.evento_id !== "string") {
    return res.status(400).json({ error: "missing_evento_id" });
  }

  // ── 7. Dispatch por tipo de evento ─────────────────────────────────────────
  // Manejamos 'suscripcion.cobrada' y 'pago.reembolsado'. Otros eventos se
  // aceptan con 200 + skipped para forward-compat: cuando el Hub añada eventos
  // nuevos (ej. 'suscripcion.cancelada'), no rompemos con 4xx/5xx que causarían
  // reintentos infinitos sin posibilidad de éxito.
  if (!payload.evento) {
    return res.status(400).json({ error: "missing_evento" });
  }

  if (payload.evento === "suscripcion.cobrada") {
    return handleSuscripcionCobrada(req, res, payload);
  }

  if (payload.evento === "pago.reembolsado") {
    return handlePagoReembolsado(req, res, payload);
  }

  console.log("[hub-webhook] evento no manejado (forward-compat):", payload.evento);
  return res.status(200).json({ ok: true, skipped: "evento_no_manejado" });
}

// ── handleSuscripcionCobrada ──────────────────────────────────────────────────

/**
 * Traduce un cobro exitoso de Wompi (vía Hub) al estado nativo de w-planner.
 *
 * Espeja exactamente lo que haría mp-webhook.js en el camino feliz de un
 * subscription_authorized_payment aprobado:
 *   - Upserta users_premium con tier, status='active', current_period_end,
 *     last_payment_at, y metadata con proveedor y evento_id del Hub.
 *   - NO toca mp_preapproval_id (columna de MercadoPago; dejarla como esté).
 *   - NO encola hub_outbox (el Hub ya atribuyó la comisión; encolar causaría doble).
 *
 * Pasos:
 *   1. Reclamo atómico vía RPC hub_reclamar_evento.
 *      - error     → 500 (reintentar).
 *      - 'duplicate' → 200 (ya procesado, idempotente).
 *      - 'in_flight' → 200 (otra corrida activa; self-heal si murió).
 *      - 'claimed' → continuar.
 *   2. Resolver usuario por email (RPC get_user_id_by_email). Sin usuario → parquear.
 *   3. Mapear plan_codigo → tier interno. Plan desconocido → parquear.
 *   4. Upsert users_premium.
 *   5. En éxito: marcar evento procesado (hub_marcar_evento_procesado) → 200.
 *   6. En fallo: revertir evento (hub_revertir_evento) → 500.
 *      PROPIEDAD SELF-HEALING: si hub_revertir_evento falla (BD caída, timeout),
 *      el evento queda en 'procesando' con timestamp viejo. A los 15 min, la RPC
 *      hub_reclamar_evento lo reclamará automáticamente en el próximo reintento
 *      del Hub → el plan se activa aunque la reversión haya fallado. Esta propiedad
 *      hace que el candado sea incapaz de quedar permanentemente bloqueado.
 *
 * @param {object} req   Request de Vercel
 * @param {object} res   Response de Vercel
 * @param {object} payload  Payload ya parseado y validado del Hub
 */
async function handleSuscripcionCobrada(req, res, payload) {
  const eventoId = payload.evento_id;

  // Inicializar cliente admin (service_role, bypasa RLS).
  // Igual que mp-webhook.js: devuelve null si faltan env vars → 503.
  const admin = createAdminClient();
  if (!admin) {
    console.error("[hub-webhook] Supabase no configurado (createAdminClient devolvió null)");
    return res.status(503).json({ error: "supabase_not_configured" });
  }

  // ── Paso 1: Reclamo atómico del candado de idempotencia ───────────────────
  // La RPC hub_reclamar_evento encapsula en una sola transacción atómica la
  // lógica de "¿puedo procesar este evento?". Devuelve un string discriminado
  // en lugar de un booleano para que el caller pueda tomar decisiones informadas.
  //
  // POR QUÉ RPC en lugar de INSERT directo:
  //   El INSERT ON CONFLICT DO NOTHING anterior no distinguía entre:
  //   a) ya procesado (terminal, no reintentar nunca)
  //   b) en vuelo por otra corrida (esperar, no duplicar)
  //   c) revertido / vencido (ok retomar)
  //   Con la RPC, esa lógica vive en la BD (atómica) y JS solo actúa según el resultado.
  const { data: claimResult, error: claimError } = await admin
    .rpc("hub_reclamar_evento", {
      p_evento_id:   eventoId,
      p_evento_tipo: payload.evento,
    });

  if (claimError) {
    // Error de BD (conexión, función no existe, permisos).
    // 500 → el Hub reintenta. No hemos modificado ningún estado en BD.
    console.error("[hub-webhook] error al reclamar evento:", claimError.message, { evento_id: eventoId });
    return res.status(500).json({ error: "db_error" });
  }

  if (claimResult === "duplicate") {
    // El evento ya fue procesado exitosamente en una corrida anterior (estado='procesado').
    // Responder 200 es correcto: el Hub puede marcar el outbox como entregado.
    console.log("[hub-webhook] evento ya procesado (idempotente):", eventoId);
    return res.status(200).json({ ok: true, duplicate: true });
  }

  if (claimResult === "in_flight") {
    // Otra corrida activa (estado='procesando', timestamp reciente <15 min) tiene el evento.
    // No re-procesamos para evitar escrituras duplicadas en users_premium.
    // Si esa corrida muere sin revertir, el auto-sanado la tomará a los 15 min.
    console.log("[hub-webhook] evento en vuelo (otra corrida activa):", eventoId);
    return res.status(200).json({ ok: true, in_flight: true });
  }

  // claimResult === 'claimed': somos el procesador designado.
  // Cualquier fallo de BD debe llamar hub_revertir_evento para liberar el candado.
  // NOTA SELF-HEALING: si hub_revertir_evento falla, el evento queda en 'procesando'
  // con timestamp viejo → a los 15 min la RPC de reclamo lo retoma automáticamente
  // → el plan se activa en el próximo reintento del Hub. El candado NO puede quedar
  // permanentemente bloqueado bajo ninguna secuencia de fallos.
  try {
    // ── Paso 2: Resolver usuario por email ──────────────────────────────────
    // La RPC get_user_id_by_email (migración 041) hace SELECT en auth.users
    // con índice de email; un solo round-trip, O(log n), sin paginación.
    // POR QUÉ no usamos admin.auth.admin.listUsers():
    //   listUsers({page:1, perPage:50}) ignoraría usuarios fuera de la primera
    //   página → cobro exitoso pero plan nunca activado (dinero sin servicio).
    const emailNorm = (payload.cliente_email || "").trim().toLowerCase();
    const emailMask = maskEmail(emailNorm);

    const { data: userId, error: uidError } = await admin
      .rpc("get_user_id_by_email", { p_email: emailNorm });

    if (uidError) {
      // Error real de BD (conexión, función no existe, permisos).
      // Revertimos candado para que el Hub pueda reintentar.
      console.error("[hub-webhook] error en RPC get_user_id_by_email:", uidError.message);
      await revertirEvento(admin, eventoId);
      return res.status(500).json({ error: "db_error" });
    }

    if (!userId) {
      // Email no encontrado en auth.users: parquear el evento.
      // POR QUÉ 200 y no 4xx/5xx:
      //   - 5xx causaría reintentos infinitos del Hub sin posibilidad de éxito.
      //   - Marcamos el candado como 'procesado' (terminal): reintentos reciben
      //     200 duplicate sin volver a intentar el upsert.
      //   - El parqueo permite reconciliación manual (usuario que nunca se registró,
      //     error tipográfico de email, etc.).
      console.warn("[hub-webhook] email no encontrado en auth.users:", {
        email: emailMask,
        evento_id: eventoId,
      });
      await parquearEvento(admin, payload, "user_not_found");
      await marcarEventoProcesado(admin, eventoId);
      return res.status(200).json({ ok: true, parked: "user_not_found" });
    }

    // ── Paso 3: Mapear plan_codigo → tier interno ──────────────────────────
    const planCodigo = (payload.plan_codigo || "").trim();
    const tierInterno = PLAN_HUB_A_INTERNO[planCodigo];

    if (!tierInterno) {
      // Plan desconocido: parquear para reconciliación.
      // Marcamos 'procesado' (terminal): este evento no es reintentable con éxito
      // hasta que se añada el plan al mapa. El parqueo lo registra para investigación.
      console.warn("[hub-webhook] plan_codigo desconocido o ausente:", {
        plan_codigo: planCodigo,
        evento_id: eventoId,
        email: emailMask,
      });
      await parquearEvento(admin, payload, "plan_desconocido");
      await marcarEventoProcesado(admin, eventoId);
      return res.status(200).json({ ok: true, parked: "plan_desconocido" });
    }

    // ── Paso 4: Upsert users_premium ────────────────────────────────────────
    // Columnas que se tocan (espeja mp-webhook.js en subscription_authorized_payment
    // con status approved):
    //   - user_id          : clave de conflicto
    //   - tier             : tier interno del plan cobrado
    //   - status           : 'active' (Wompi confirmó el cobro exitoso)
    //   - current_period_end: proximo_cobro del Hub (o null si no viene)
    //   - last_payment_at  : fecha del cobro (payload.fecha o ahora como fallback)
    //   - metadata         : merge con info del proveedor + evento del Hub
    //
    // Columnas que NO se tocan:
    //   - mp_preapproval_id : columna de MercadoPago; no tiene sentido en Wompi
    //   - mp_payer_email    : ídem
    //   - current_period_start: mp-webhook.js la toca solo en preapprovals; no aquí
    //   - created_at        : nunca se modifica en upsert
    //
    // POR QUÉ no hacer merge de metadata existente:
    //   Supabase no soporta merge parcial de JSONB en upsert directo. Hacer un
    //   SELECT previo para mergear añadiría un round-trip y una carrera de escritura.
    //   En su lugar, escribimos la metadata mínima necesaria para trazabilidad del
    //   proveedor Wompi; la metadata de MP anterior se preserva via la columna
    //   DEFAULT '{}'::jsonb (el upsert actualiza solo las columnas declaradas).
    //   Si en el futuro se necesita merge real, se puede hacer con una RPC PL/pgSQL.
    const premiumUpdate = {
      user_id:            userId,
      tier:               tierInterno,
      status:             "active",
      current_period_end: payload.proximo_cobro ?? null,
      last_payment_at:    payload.fecha ?? new Date().toISOString(),
      metadata: {
        provider:        "wompi-hub",
        hub_evento_id:   eventoId,
        hub_periodo:     payload.periodo ?? null,
        plan_nombre:     payload.plan_nombre ?? null,
        monto_cop:       payload.monto_cop  ?? null,
        last_event:      "suscripcion.cobrada",
      },
    };

    const { error: upsertError } = await admin
      .from("users_premium")
      .upsert(premiumUpdate, { onConflict: "user_id" });

    if (upsertError) {
      // Fallo transitorio de BD (conexión, constraint, etc.):
      //   - Revertimos el candado para que el Hub pueda reintentar.
      //   - Devolvemos 500: el outbox del Hub reintentará con backoff exponencial.
      //   - SELF-HEALING: si revertirEvento también falla, el evento queda en
      //     'procesando' con timestamp viejo → a los 15 min se auto-reclama.
      console.error("[hub-webhook] upsert users_premium falló:", upsertError.message, {
        evento_id: eventoId,
        email: emailMask,
      });
      await revertirEvento(admin, eventoId);
      return res.status(500).json({ error: "internal error" });
    }

    // ── Paso 5: Marcar evento como procesado (antes de responder 200) ────────
    // Se marca ANTES de responder para que si el proceso muere entre el UPDATE
    // y el 200, el próximo reintento del Hub reciba 'duplicate' en lugar de
    // 'claimed' (lo que causaría un re-upsert innecesario aunque idempotente).
    // Si este marcado falla: loguear pero responder 200 igual. El evento YA fue
    // aplicado (upsert exitoso); el candado quedará en 'procesando' y se
    // auto-sanará a los 15 min (el upsert idempotente no causará daño).
    const { error: markError } = await admin
      .rpc("hub_marcar_evento_procesado", { p_evento_id: eventoId });

    if (markError) {
      console.error(
        "[hub-webhook] no se pudo marcar evento procesado (self-heal en 15 min):",
        markError.message,
        { evento_id: eventoId },
      );
      // No revertir: el upsert ya ocurrió. El auto-sanado retomará a los 15 min
      // y el re-upsert es idempotente. Responder 200 para que el Hub no reintente
      // (el cobro ya se aplicó; un 5xx causaría trabajo innecesario).
    }

    console.log("[hub-webhook] suscripcion.cobrada aplicada:", {
      email:     emailMask,
      tier:      tierInterno,
      plan:      planCodigo,
      evento_id: eventoId,
    });
    return res.status(200).json({ ok: true });

  } catch (err) {
    // Excepción inesperada (no capturada por los if de error arriba).
    // Revertimos el candado para permitir reintento del Hub.
    // SELF-HEALING: si revertirEvento falla aquí también, el evento queda en
    // 'procesando' con timestamp viejo → se auto-reclama a los 15 min.
    console.error("[hub-webhook] excepción inesperada:", err?.message, { evento_id: eventoId });
    await revertirEvento(admin, eventoId);
    return res.status(500).json({ error: "internal error" });
  }
}

// ── handlePagoReembolsado ─────────────────────────────────────────────────────

/**
 * Procesa el evento `pago.reembolsado`: revoca el acceso premium que había
 * otorgado el cobro original.
 *
 * CONTRATO (docs/eventos-salientes.md del Hub, softatumedida-panel): el Hub
 * emite este evento cuando un admin anula un cobro por reembolso (por
 * `wompi_tx_id`). `evento_id_original` identifica el `suscripcion.cobrada`
 * que otorgó el acceso; `evento_id` de ESTE evento trae el prefijo "refund:"
 * (clave de idempotencia propia, no colisiona con el candado del cobro original).
 *
 * POR QUÉ w-planner NO reconstruye el ID `wompi_pay:`/`wompi_sub:` de la SPEC:
 *   La SPEC describe cómo reconstruir el identificador del pago original para
 *   apps que llevan un LEDGER de pagos (una fila por cobro — ej. betting-analyst
 *   con su tabla `payments`). w-planner NO tiene ledger: `users_premium` es UNA
 *   fila por usuario que se SOBRESCRIBE en cada cobro (ver handleSuscripcionCobrada,
 *   upsert onConflict:'user_id'). El equivalente de "qué evento otorgó el acceso
 *   actual" en w-planner es `users_premium.metadata.hub_evento_id`, que
 *   handleSuscripcionCobrada ya escribe en cada cobro exitoso. Por eso este
 *   handler compara ese campo contra `evento_id_original` en vez de reconstruir
 *   un ID con prefijo que w-planner nunca guarda.
 *
 * POR QUÉ verificar hub_evento_id antes de revocar (no solo "el usuario existe"):
 *   users_premium es una fila viva, no un historial. Si el Hub reembolsa un
 *   cobro VIEJO ya superado por un cobro más reciente y legítimo (ej. un admin
 *   reembolsa el cargo de un mes atrás cuando el usuario ya pagó el ciclo
 *   siguiente), revocar sin verificar mataría una suscripción activa y vigente
 *   que no tiene nada que ver con el reembolso. Comparar
 *   `metadata.hub_evento_id === evento_id_original` asegura que solo revocamos
 *   si el cobro reembolsado es EXACTAMENTE el que otorgó el estado actual. Si
 *   no coincide (o el usuario nunca tuvo acceso vía Hub — ej. paga por MP), se
 *   parquea para revisión manual en vez de tocar el estado — mismo patrón que
 *   user_not_found / plan_desconocido en handleSuscripcionCobrada.
 *
 * Tier/status de destino: 'free' / 'cancelled'. No existe un status 'refunded'
 * en el CHECK de users_premium (migración 016: 'active'|'pending'|'past_due'|
 * 'cancelled'). 'cancelled' es el valor que ya usa mp-webhook.js para el mismo
 * caso semántico (mapStatus('cancelled') + targetTier forzado a 'free' cuando
 * status !== 'active', línea ~289-290 de api/mp-webhook.js), y es lo que ya
 * interpretan los gates de acceso de la app (enforce_project_limit en la
 * migración 027, user_can_use_ia_on_project en la 016): cualquier status
 * distinto de 'active' se trata como sin premium. tier='free' además alinea
 * el dato con el saneamiento de la migración 037 (un tier de pago en un status
 * que no paga es información inconsistente que ahí se corrige de la misma forma).
 *
 * Idempotente: reprocesar el mismo evento_id (retry del Hub) no falla — el
 * candado hub_reclamar_evento corta duplicados; y si de todas formas llegara
 * a reejecutarse (self-heal tras un fallo de marcado), revocar dos veces es
 * un no-op detectado explícitamente (ver chequeo "ya estaba revocado" abajo).
 * Si no hay nada que revocar (usuario no encontrado, sin fila en users_premium,
 * o el cobro reembolsado no es el que otorgó el acceso vigente), responde 200
 * igual — patrón tolerante (ver handlePagoReembolsado de betting-analyst).
 *
 * @param {object} req
 * @param {object} res
 * @param {object} payload  Payload ya parseado y validado (evento/evento_id
 *   genéricos validados en el dispatcher; evento_id_original/periodicidad se
 *   validan aquí por ser propios de este tipo de evento).
 */
async function handlePagoReembolsado(req, res, payload) {
  const eventoId = payload.evento_id;

  // Validación de forma de los campos propios del reembolso. Un payload
  // malformado del Hub indica un bug de configuración, no una condición
  // transitoria — pero se responde 400 (no 200) siguiendo la misma convención
  // que el resto de validaciones de forma de este archivo (ej. missing_evento_id).
  if (!payload.evento_id_original || typeof payload.evento_id_original !== "string") {
    console.warn("[hub-webhook] pago.reembolsado sin evento_id_original:", eventoId);
    return res.status(400).json({ error: "missing_evento_id_original" });
  }
  if (payload.periodicidad !== "unico" && payload.periodicidad !== "mensual") {
    console.warn("[hub-webhook] pago.reembolsado con periodicidad inválida:", payload.periodicidad);
    return res.status(400).json({ error: "invalid_periodicidad" });
  }

  const admin = createAdminClient();
  if (!admin) {
    console.error("[hub-webhook] Supabase no configurado (createAdminClient devolvió null)");
    return res.status(503).json({ error: "supabase_not_configured" });
  }

  // ── Paso 1: Reclamo atómico del candado de idempotencia ───────────────────
  const { data: claimResult, error: claimError } = await admin
    .rpc("hub_reclamar_evento", {
      p_evento_id:   eventoId,
      p_evento_tipo: payload.evento,
    });

  if (claimError) {
    console.error("[hub-webhook] error al reclamar evento (pago.reembolsado):", claimError.message, { evento_id: eventoId });
    return res.status(500).json({ error: "db_error" });
  }

  if (claimResult === "duplicate") {
    console.log("[hub-webhook] pago.reembolsado ya procesado (idempotente):", eventoId);
    return res.status(200).json({ ok: true, duplicate: true });
  }

  if (claimResult === "in_flight") {
    console.log("[hub-webhook] pago.reembolsado en vuelo (otra corrida activa):", eventoId);
    return res.status(200).json({ ok: true, in_flight: true });
  }

  // claimResult === 'claimed': somos el procesador designado.
  try {
    // ── Paso 2: Resolver usuario por email ────────────────────────────────
    // cliente_email es nullable en la SPEC. w-planner resuelve identidad
    // exclusivamente por email (igual que handleSuscripcionCobrada; no usa
    // app_cliente_ref). Sin email no hay forma de ubicar al usuario: parquear.
    const emailRaw = payload.cliente_email;
    if (!emailRaw || typeof emailRaw !== "string") {
      console.warn("[hub-webhook] pago.reembolsado sin cliente_email:", { evento_id: eventoId });
      await parquearEvento(admin, payload, "cliente_email_ausente");
      await marcarEventoProcesado(admin, eventoId);
      return res.status(200).json({ ok: true, parked: "cliente_email_ausente" });
    }

    const emailNorm = emailRaw.trim().toLowerCase();
    const emailMask = maskEmail(emailNorm);

    const { data: userId, error: uidError } = await admin
      .rpc("get_user_id_by_email", { p_email: emailNorm });

    if (uidError) {
      console.error("[hub-webhook] error en RPC get_user_id_by_email (reembolso):", uidError.message);
      await revertirEvento(admin, eventoId);
      return res.status(500).json({ error: "db_error" });
    }

    if (!userId) {
      console.warn("[hub-webhook] pago.reembolsado: email no encontrado en auth.users:", {
        email: emailMask,
        evento_id: eventoId,
      });
      await parquearEvento(admin, payload, "user_not_found");
      await marcarEventoProcesado(admin, eventoId);
      return res.status(200).json({ ok: true, parked: "user_not_found" });
    }

    // ── Paso 3: Leer el estado premium actual del usuario ──────────────────
    // Necesitamos tier/status/metadata para (a) verificar que el cobro que se
    // reembolsa es el que otorgó el acceso VIGENTE, y (b) mergear metadata sin
    // una segunda consulta. A diferencia del upsert de handleSuscripcionCobrada
    // (que evita el round-trip a propósito), aquí SÍ compensa: ya lo necesitamos
    // para el chequeo (a).
    const { data: premiumRow, error: selectError } = await admin
      .from("users_premium")
      .select("tier, status, metadata")
      .eq("user_id", userId)
      .maybeSingle();

    if (selectError) {
      console.error("[hub-webhook] error leyendo users_premium para reembolso:", selectError.message, { evento_id: eventoId });
      await revertirEvento(admin, eventoId);
      return res.status(500).json({ error: "db_error" });
    }

    if (!premiumRow) {
      // El usuario existe en auth.users pero nunca tuvo fila en users_premium
      // (nunca pagó por ningún canal). Nada que revocar.
      console.log("[hub-webhook] pago.reembolsado: usuario sin fila en users_premium, nada que revocar:", {
        email: emailMask,
        evento_id: eventoId,
      });
      await marcarEventoProcesado(admin, eventoId);
      return res.status(200).json({ ok: true, nothing_to_revoke: true });
    }

    const grantingEventId = premiumRow.metadata?.hub_evento_id ?? null;

    if (grantingEventId !== payload.evento_id_original) {
      // El acceso vigente NO fue otorgado por el cobro que se está reembolsando
      // (nunca llegó vía Hub —p.ej. paga por MP—, o un cobro posterior ya lo
      // reemplazó). Revocar aquí mataría una suscripción legítima y distinta
      // de la que el admin quiso reembolsar. Se parquea para revisión manual
      // en vez de actuar a ciegas.
      console.warn("[hub-webhook] pago.reembolsado: el cobro reembolsado no otorgó el acceso vigente:", {
        email: emailMask,
        evento_id: eventoId,
        evento_id_original: payload.evento_id_original,
        acceso_vigente_otorgado_por: grantingEventId,
      });
      await parquearEvento(admin, payload, "evento_original_no_es_el_vigente");
      await marcarEventoProcesado(admin, eventoId);
      return res.status(200).json({ ok: true, parked: "evento_original_no_es_el_vigente" });
    }

    if (premiumRow.status === "cancelled" && premiumRow.tier === "free") {
      // Ya estaba revocado (reintento del Hub tras self-heal, o el candado se
      // reclamó dos veces). Idempotente: no repetir el UPDATE ni pisar
      // metadata.reembolsado_en con un timestamp nuevo.
      console.log("[hub-webhook] pago.reembolsado: ya estaba revocado (idempotente):", { evento_id: eventoId });
      await marcarEventoProcesado(admin, eventoId);
      return res.status(200).json({ ok: true, already_revoked: true });
    }

    // ── Paso 4: Revocar — tier='free', status='cancelled' ───────────────────
    // ATÓMICO (fix gate seguridad 2026-07-18): el UPDATE re-exige que el acceso
    // vigente siga otorgado por el MISMO evento que se reembolsa. Sin esto hay
    // una carrera TOCTOU: si una renovación legítima (suscripcion.cobrada)
    // actualiza la fila entre el SELECT del paso 3 y este UPDATE, revocaríamos
    // una suscripción recién pagada. Con el filtro JSON, esa carrera deja el
    // UPDATE en 0 filas y se parquea en vez de revocar.
    const { data: updatedRows, error: updateError } = await admin
      .from("users_premium")
      .update({
        tier:   "free",
        status: "cancelled",
        metadata: {
          ...(premiumRow.metadata ?? {}),
          last_event:           "pago.reembolsado",
          hub_refund_evento_id: eventoId,
          motivo_reembolso:     payload.motivo ?? null,
          reembolsado_en:       payload.fecha ?? new Date().toISOString(),
        },
      })
      .eq("user_id", userId)
      .eq("metadata->>hub_evento_id", payload.evento_id_original)
      .select("user_id");

    if (updateError) {
      console.error("[hub-webhook] update users_premium (reembolso) falló:", updateError.message, {
        evento_id: eventoId,
        email: emailMask,
      });
      await revertirEvento(admin, eventoId);
      return res.status(500).json({ error: "internal error" });
    }

    if (!updatedRows || updatedRows.length === 0) {
      // La condición dejó de cumplirse entre la lectura y la escritura: un
      // cobro nuevo reemplazó al evento original durante este handler. El
      // acceso vigente ya NO corresponde al cobro reembolsado → no revocar.
      console.warn("[hub-webhook] pago.reembolsado: el evento original cambió durante el reembolso (carrera con renovación), se parquea:", {
        email: emailMask,
        evento_id: eventoId,
        evento_id_original: payload.evento_id_original,
      });
      await parquearEvento(admin, payload, "evento_original_cambio_durante_reembolso");
      await marcarEventoProcesado(admin, eventoId);
      return res.status(200).json({ ok: true, parked: "evento_original_cambio_durante_reembolso" });
    }

    // ── Paso 5: Marcar evento como procesado (antes de responder 200) ───────
    const { error: markError } = await admin
      .rpc("hub_marcar_evento_procesado", { p_evento_id: eventoId });

    if (markError) {
      console.error(
        "[hub-webhook] no se pudo marcar evento procesado tras reembolso (self-heal en 15 min):",
        markError.message,
        { evento_id: eventoId },
      );
      // No revertir: el UPDATE ya ocurrió (acceso ya revocado). El auto-sanado
      // retomará a los 15 min y el chequeo "ya estaba revocado" del paso 3 lo
      // volverá un no-op. Responder 200: revocar dos veces no causa daño, pero
      // reintentar con 5xx aquí sería trabajo innecesario para un efecto que
      // ya se aplicó.
    }

    console.log("[hub-webhook] pago.reembolsado aplicado (acceso revocado):", {
      email:         emailMask,
      evento_id:     eventoId,
      tier_anterior: premiumRow.tier,
    });
    return res.status(200).json({ ok: true, revoked: true });

  } catch (err) {
    // Excepción inesperada: revertir el candado para permitir reintento del
    // Hub. Misma garantía self-healing que handleSuscripcionCobrada.
    console.error("[hub-webhook] excepción inesperada (pago.reembolsado):", err?.message, { evento_id: eventoId });
    await revertirEvento(admin, eventoId);
    return res.status(500).json({ error: "internal error" });
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────────

/**
 * Revierte el candado de idempotencia actualizando el estado a 'revertido'.
 *
 * Reemplaza el DELETE anterior. Con UPDATE a 'revertido', incluso si este UPDATE
 * falla (BD caída, timeout), el evento queda en 'procesando' con timestamp viejo
 * → la RPC hub_reclamar_evento lo auto-reclama a los 15 min (self-healing).
 * Con DELETE, si la eliminación fallaba, el candado quedaba permanentemente.
 *
 * PROPIEDAD SELF-HEALING (resumen de garantías):
 *   - Fallo del upsert + reversión exitosa → estado='revertido' → Hub reintenta
 *     → hub_reclamar_evento lo reclama → upsert se aplica. ✓
 *   - Fallo del upsert + reversión fallida → estado='procesando' (timestamp viejo)
 *     → a los 15 min hub_reclamar_evento lo auto-reclama → upsert se aplica. ✓
 *   - En ambos casos el plan se activa. El candado NO puede quedar permanente.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} eventoId
 */
async function revertirEvento(admin, eventoId) {
  try {
    const { error } = await admin
      .rpc("hub_revertir_evento", { p_evento_id: eventoId });
    if (error) {
      // CRÍTICO pero no fatal: el self-healing lo retomará a los 15 min.
      console.error(
        "[hub-webhook] CRÍTICO: no se pudo revertir evento (self-heal en 15 min):",
        error.message,
        { evento_id: eventoId },
      );
    }
  } catch (e) {
    // Misma garantía: el self-healing cubre este caso.
    console.error(
      "[hub-webhook] CRÍTICO: excepción al revertir evento (self-heal en 15 min):",
      e?.message,
      { evento_id: eventoId },
    );
  }
}

/**
 * Llama la RPC hub_marcar_evento_procesado como conveniencia.
 * Se usa en los caminos de parqueo (terminal: user_not_found, plan_desconocido)
 * para que reintentos futuros del Hub reciban 'duplicate' sin re-parquear.
 *
 * Best-effort: si falla, el auto-sanado de 15 min lo retomará. El re-parqueo
 * es idempotente (ON CONFLICT DO NOTHING en hub_eventos_sin_resolver).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {string} eventoId
 */
async function marcarEventoProcesado(admin, eventoId) {
  try {
    const { error } = await admin
      .rpc("hub_marcar_evento_procesado", { p_evento_id: eventoId });
    if (error) {
      console.error(
        "[hub-webhook] no se pudo marcar evento procesado en parqueo (self-heal en 15 min):",
        error.message,
        { evento_id: eventoId },
      );
    }
  } catch (e) {
    console.error(
      "[hub-webhook] excepción al marcar evento procesado en parqueo:",
      e?.message,
      { evento_id: eventoId },
    );
  }
}

/**
 * Inserta el evento en la tabla de parqueo hub_eventos_sin_resolver.
 *
 * Se llama en dos casos (el candado se marca 'procesado' después del parqueo):
 *   a) Email no encontrado → parked: 'user_not_found'
 *   b) Plan desconocido   → parked: 'plan_desconocido'
 *
 * DECISIÓN DE PII: el JSONB `payload` se almacena SIN la clave `cliente_email`
 * para no duplicar PII. El email vive UNA SOLA VEZ en la columna dedicada
 * `cliente_email` (necesaria para reconciliación manual). La tabla es
 * service_role-only (RLS + REVOKE). Ver comentario en migración 041.
 *
 * ON CONFLICT DO NOTHING vía ignoreDuplicates (upsert con ignoreDuplicates:true):
 *   Si el Hub reintenta y el parqueo ya existe, no duplicamos ni lanzamos 23505.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} admin
 * @param {object} payload  Payload completo del Hub
 * @param {string} motivo   Para logging únicamente
 */
async function parquearEvento(admin, payload, motivo) {
  // Clonar el payload y eliminar cliente_email para no duplicar PII en el JSONB.
  // El email vive en la columna dedicada `cliente_email` de la misma fila.
  const payloadSinEmail = { ...payload };
  delete payloadSinEmail.cliente_email;

  try {
    const { error } = await admin
      .from("hub_eventos_sin_resolver")
      .upsert(
        {
          evento_id:     payload.evento_id,
          evento_tipo:   payload.evento,
          cliente_email: payload.cliente_email ?? null,
          plan_codigo:   payload.plan_codigo  ?? null,
          // PII mínima: email SOLO en su columna; payload sin cliente_email.
          payload:       payloadSinEmail,
        },
        { onConflict: "evento_id", ignoreDuplicates: true },
      );
    if (error) {
      console.error("[hub-webhook] error al parquear evento:", error.message, {
        evento_id: payload.evento_id,
        motivo,
      });
    }
  } catch (e) {
    // Fail-open: el parqueo es best-effort. El candado quedará 'procesado'
    // (marcado después de esta llamada), así que el evento no causará reintentos.
    // Pero sí perdemos el registro en sin_resolver. Logueamos para diagnóstico.
    console.error("[hub-webhook] excepción al parquear evento:", e?.message, {
      evento_id: payload.evento_id,
      motivo,
    });
  }
}

// =============================================================================
// NOTA: body parser de Vercel (RESUELTO 2026-07-02, no es deuda)
// =============================================================================
// El Hub envía Content-Type: application/json, así que @vercel/node parsea el
// body y `req.readable` suele ser false al llegar aquí → tomamos la rama
// JSON.stringify(req.body). Se DEMOSTRÓ empíricamente que esa reconstrucción es
// byte-idéntica al rawBody que firma el cron drenador del Hub para el payload de
// este cable (ver scratchpad/probar-rawbody-hmac.mjs: tildes, ñ, emoji, comillas,
// slashes, enteros, nulls y orden de claves arbitrario → HMAC calza en 4/4).
//
// NO agregar `{ "functions": { ...: { "bodyParser": false } } }` a vercel.json:
// `bodyParser` NO es una propiedad válida del schema de `functions` en vercel.json
// (solo acepta runtime/memory/maxDuration/includeFiles/excludeFiles) → un deploy
// con esa clave sería rechazado. La rama de stream (req.readable) ya cubre el caso
// en que un runtime futuro NO parsee el body; no hace falta forzar nada.
// =============================================================================
