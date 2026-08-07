import { createSupabase, createAdminClient, fetchWithTimeout } from "./_auth.js";
import { getResendConfig, normalizeRecipients, sanitizeReportHtml } from "./_email.js";
import { notificarPagoAlHub } from "./_hub-client.js";
import { extractUsageMarker } from "../src/aiModels.js";

// ─── Helpers de tiempo en Colombia ─────────────────────────
const DAY_NAMES = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function getColombiaNow() {
  const now = new Date();
  const colombiaOffsetMin = -5 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + colombiaOffsetMin * 60000);
}

const fmt = (d) => d.toISOString().split("T")[0];

// ─── Programación: ¿toca enviar este informe AHORA? ────────────────────────
//
// Esta es la pieza con más aristas del cron —horarios, husos, duplicados,
// reintentos— así que se escribe como una FUNCIÓN PURA y se exporta: toda su
// casuística está cubierta en api/cron.schedule.test.js. Un error aquí no se
// nota hasta que un cliente no recibe su informe, o lo recibe dos veces.

// Colombia no aplica horario de verano, así que un offset fijo es exacto.
const COL_OFFSET_H = -5;

// Cuántas horas después de la hora pactada seguimos considerando que el informe
// toca.
//
// Antes la ventana era CERO: la hora tenía que coincidir clavada. Como el cron
// dispone de 60 s por invocación y un informe con IA puede tardar decenas de
// segundos, bastaba que dos informes cayeran a la misma hora para que el
// segundo no saliera nunca — sin reintento, sin correo y sin una fila que lo
// delatara. Con la ventana, el siguiente tick horario lo recoge.
//
// La ventana por sí sola no basta: sin la reserva atómica de más abajo,
// permitiría enviar el mismo informe una vez por hora durante toda la ventana.
// Las dos piezas se necesitan mutuamente.
export const TOLERANCIA_HORAS = 6;

// Partes de la hora de pared en Colombia. Solo aritmética UTC: no depende de la
// zona horaria de la máquina que ejecute esto (en local no es UTC).
export const partesColombia = (instante) => {
  const d = new Date(instante.getTime() + COL_OFFSET_H * 3600000);
  return {
    anio: d.getUTCFullYear(), mes: d.getUTCMonth(), dia: d.getUTCDate(),
    hora: d.getUTCHours(), diaSemana: d.getUTCDay(),
  };
};

// Instante real (UTC) que corresponde a una hora de pared colombiana.
const instanteColombia = (p, hora) =>
  new Date(Date.UTC(p.anio, p.mes, p.dia, hora - COL_OFFSET_H, 0, 0, 0));

const mismoDiaColombia = (a, b) => {
  const pa = partesColombia(a), pb = partesColombia(b);
  return pa.anio === pb.anio && pa.mes === pb.mes && pa.dia === pb.dia;
};

const horaValida = (h, pordefecto) => {
  const n = Number(h);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : pordefecto;
};

// Devuelve el INSTANTE de la ocurrencia pendiente de enviarse, o null si ahora
// no toca.
//
// La deduplicación NO se hace ya por "horas transcurridas desde el último
// envío" —una regla que, con una ventana de varias horas, permitiría
// duplicados— sino comparando last_sent contra el instante exacto de la
// ocurrencia. Si ya se envió para ESTA ocurrencia, last_sent >= ocurrencia y se
// salta. Es exacto por construcción: da igual cuántas veces corra el cron
// dentro de la ventana.
export function ocurrenciaPendiente(config, ahora = new Date()) {
  const p = partesColombia(ahora);
  const nombreDia = DAY_NAMES[p.diaSemana];
  const sched = config.schedule || {};
  let targetHour;

  if (config.report_type === "scrum") {
    // Tope de 2 días también en el servidor: report_configs es escribible por
    // el dueño, y una lista con los 7 días multiplicaba por 3,5 el gasto de IA
    // que paga el operador. La interfaz ya lo limitaba; el cron no.
    const diasCfg = Array.isArray(sched.days) && sched.days.length ? sched.days : ["wednesday", "friday"];
    const dias = diasCfg.slice(0, 2);
    if (!dias.includes(nombreDia)) return null;
    targetHour = horaValida(sched.hours?.[nombreDia] ?? sched.hour, 8);
  } else if (config.report_type === "weekly_po") {
    if (nombreDia !== (sched.send_day || "monday")) return null;
    targetHour = horaValida(sched.hour, 8);
  } else if (config.report_type === "monthly_team") {
    if (nombreDia !== (sched.send_day || "monday")) return null;
    const semana = Number(sched.week ?? 1);
    if (p.dia < (semana - 1) * 7 + 1 || p.dia > semana * 7) return null;
    targetHour = horaValida(sched.hour, 8);
  } else {
    return null;
  }

  const ocurrencia = instanteColombia(p, targetHour);
  if (ahora < ocurrencia) return null; // aún no es la hora

  // La ventana nunca cruza la medianoche colombiana: pasado ese punto el
  // predicado del día ya no se cumpliría y el estado quedaría incoherente.
  const horasVentana = Math.min(TOLERANCIA_HORAS, 24 - targetHour);
  if (ahora.getTime() >= ocurrencia.getTime() + horasVentana * 3600000) return null;

  if (config.last_sent) {
    const enviado = new Date(config.last_sent);
    if (!Number.isNaN(enviado.getTime())) {
      // Ya se cubrió esta ocurrencia…
      if (enviado >= ocurrencia) return null;
      // …o ya salió un informe de esta configuración hoy (por ejemplo, un envío
      // manual desde Configuración un rato antes). Un informe programado por
      // día y configuración: nadie quiere el mismo resumen dos veces.
      if (mismoDiaColombia(enviado, ocurrencia)) return null;
    }
  }

  return ocurrencia;
}

// Reserva la ocurrencia ANTES de generar nada, con un compare-and-set: escribe
// last_sent = <ocurrencia> solo si nadie la ha reservado ya. Devuelve true si
// somos los dueños de este envío.
//
// Sin esto, la ventana de 6 h sería un multiplicador de duplicados: cada tick
// horario volvería a considerar el informe pendiente hasta que el marcado final
// tuviera éxito. Con la reserva, el primero que llega gana y los demás ticks lo
// ven ya cubierto. Resuelve además el solapamiento de dos invocaciones del cron.
//
// Nota sobre email_config.last_sent, que es TEXT y no timestamptz: la
// comparación `lt` es lexicográfica, pero toISOString() siempre produce
// YYYY-MM-DDTHH:mm:ss.sssZ, formato en el que el orden lexicográfico coincide
// con el cronológico. Los valores heredados se escribieron igual.
async function reservarOcurrencia(supabase, config, ocurrencia) {
  const tabla = config._legacy ? "email_config" : "report_configs";
  const iso = ocurrencia.toISOString();
  const { data, error } = await supabase
    .from(tabla)
    .update({ last_sent: iso })
    .eq("id", config.id)
    .or(`last_sent.is.null,last_sent.lt.${iso}`)
    .select("id");

  if (error) return { reservada: false, error };
  return { reservada: Array.isArray(data) && data.length === 1, error: null };
}

// Devuelve la reserva si la generación o el envío fallan, para que el siguiente
// tick pueda reintentar dentro de la misma ventana. Solo suelta lo que seguimos
// teniendo reservado, por si otra corrida ya avanzó.
//
// Si esta liberación falla, la ocurrencia se pierde hasta el próximo periodo.
// Es el sentido correcto en el que equivocarse: mejor un informe que no sale
// —y que queda registrado como 'failed'— que uno duplicado al cliente.
async function liberarOcurrencia(supabase, config, ocurrencia) {
  const tabla = config._legacy ? "email_config" : "report_configs";
  const { error } = await supabase
    .from(tabla)
    .update({ last_sent: config.last_sent ?? null })
    .eq("id", config.id)
    .eq("last_sent", ocurrencia.toISOString());
  if (error) {
    console.error(`[cron] no se pudo liberar la reserva de ${config.report_type} (proyecto ${config.project_id}); no se reintentará hasta el próximo periodo:`, error.message);
  }
}

// Calcula la ventana de análisis según el tipo.
function computeRange(config) {
  const now = getColombiaNow();
  const windowCfg = config.window_cfg || {};

  if (config.report_type === "scrum") {
    // Ventana = hoy hacia atrás N días (default 3)
    const back = windowCfg.days_back ?? 3;
    const start = new Date(now); start.setDate(now.getDate() - back);
    return { weekStart: fmt(start), weekEnd: fmt(now) };
  }

  if (config.report_type === "weekly_po") {
    const back = windowCfg.days_back ?? 7;
    const forward = windowCfg.days_forward ?? 7;
    const start = new Date(now); start.setDate(now.getDate() - back);
    const end = new Date(now); end.setDate(now.getDate() + forward);
    return {
      weekStart: back === 0 ? "2020-01-01" : fmt(start),
      weekEnd: fmt(end),
    };
  }

  if (config.report_type === "monthly_team") {
    // Mes anterior completo.
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 86400000);
    const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
    return {
      weekStart: fmt(firstOfPrevMonth),
      weekEnd: fmt(lastOfPrevMonth),
    };
  }

  return { weekStart: fmt(now), weekEnd: fmt(now) };
}

const getBaseUrl = () =>
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.APP_BASE_URL || "https://productivity-plus.vercel.app";

// ─── Generación e invocación de endpoints ──────────────────
const ENDPOINT_BY_TYPE = {
  scrum: "/api/generate-scrum-report",
  weekly_po: "/api/generate-report",
  monthly_team: "/api/generate-monthly-report",
};

async function generateReport({ projectId, reportType, range }) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET no esta configurado");
  const endpoint = ENDPOINT_BY_TYPE[reportType];
  if (!endpoint) throw new Error(`Tipo de reporte desconocido: ${reportType}`);

  // El reporte mensual usa { monthStart, monthEnd }, los otros { weekStart, weekEnd }.
  const body = reportType === "monthly_team"
    ? { projectId, monthStart: range.weekStart, monthEnd: range.weekEnd }
    : { projectId, weekStart: range.weekStart, weekEnd: range.weekEnd };

  const genRes = await fetchWithTimeout(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cron-Secret": cronSecret,
    },
    body: JSON.stringify(body),
  }, 55000); // genera con LLM: timeout largo, acotado por maxDuration=60s

  if (!genRes.ok) {
    const errText = await genRes.text();
    throw new Error(`Generate failed (${genRes.status}): ${errText.substring(0, 200)}`);
  }

  // scrum devuelve JSON con metadata de costo ya incluida; weekly_po y
  // monthly_team devuelven text/html en streaming (Anthropic no entrega
  // output_tokens hasta el final, así que no pueden ir en un header). El
  // productor adjunta un comentario HTML con el uso real al cierre del
  // stream (embedUsageComment); acá se extrae ANTES de sanitizar/enviar el
  // email para que el HTML quede limpio y el costo no se pierda (H-cost).
  const contentType = genRes.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await genRes.json();
  }
  const raw = await genRes.text();
  try {
    const { usage, html } = extractUsageMarker(raw);
    return {
      html,
      model: usage?.model ?? null,
      tokens_input: usage?.tokens_input ?? null,
      tokens_output: usage?.tokens_output ?? null,
      cost_usd: usage?.cost_usd ?? null,
    };
  } catch (e) {
    // Best-effort: un fallo extrayendo el costo no debe tumbar el envío del
    // reporte. Se envía igual, solo sin metadata de costo.
    console.warn("[cron] No pude extraer métricas de uso del stream:", e?.message);
    return { html: raw };
  }
}

// ─── Envío + archivo histórico ─────────────────────────────
function htmlToPlainText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SUBJECT_BY_TYPE = {
  scrum: "Reporte Scrum",
  weekly_po: "Reporte Semanal",
  monthly_team: "Análisis Mensual del Equipo",
};

async function sendAndArchive({ supabase, projectId, reportType, generated, recipients, range }) {
  const recipientsNorm = normalizeRecipients(recipients);
  const safeHtml = sanitizeReportHtml(generated.html);
  const { apiKey, from } = getResendConfig();
  const subjectLabel = SUBJECT_BY_TYPE[reportType] || "Reporte";

  const sendRes = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: recipientsNorm,
      subject: `${subjectLabel} Productivity-Plus · ${range.weekStart} al ${range.weekEnd}`,
      html: safeHtml,
    }),
  });

  const sendData = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok || sendData.error) {
    throw new Error("Send failed: " + JSON.stringify(sendData.error || sendData));
  }

  // Archiva (sin bloquear si la tabla aún no existe). El correo ya salió, así
  // que un fallo aquí no debe tumbar el envío — pero sí tiene que verse: sin
  // esta fila el informe no existe para la comparativa del mensual ni para el
  // seguimiento de costes de IA.
  try {
    const { error: histErr } = await supabase.from("report_history").insert({
      project_id: projectId,
      report_type: reportType,
      period_start: range.weekStart,
      period_end: range.weekEnd,
      status: generated.truncated ? "truncated" : "sent",
      recipients: recipientsNorm,
      plain_text: generated.plain_text || htmlToPlainText(safeHtml),
      html: safeHtml,
      model_used: generated.model || null,
      tokens_input: generated.tokens_input || null,
      tokens_output: generated.tokens_output || null,
      cost_usd: generated.cost_usd || null,
    });
    if (histErr) console.error("[cron] el informe se envió pero no se pudo archivar:", histErr.message);
  } catch (archiveErr) {
    console.warn("[cron] No pude archivar el reporte:", archiveErr?.message);
  }
}

// ─── Backwards compat: lee email_config si report_configs no existe ────
async function loadConfigs(supabase) {
  // Intenta report_configs primero (sistema nuevo, migración 012).
  const { data: newConfigs, error: newErr } = await supabase
    .from("report_configs")
    .select("*")
    .eq("enabled", true);

  if (!newErr && Array.isArray(newConfigs)) return { source: "new", configs: newConfigs };

  // Solo se cae al sistema viejo si report_configs NO EXISTE (42P01). Antes se
  // caía ante CUALQUIER error: un timeout puntual bastaba para que el cron
  // evaluara las agendas de email_config, que conserva destinatarios y horarios
  // antiguos, y mandara datos actuales a listas de correo obsoletas.
  if (newErr && newErr.code !== "42P01") {
    console.error("[cron] error leyendo report_configs; NO se usa el sistema legacy:", newErr);
    throw new Error("No se pudieron leer las configuraciones de informes: " + newErr.message);
  }

  // Fallback al sistema viejo de email_config.
  const { data: oldConfigs, error: oldErr } = await supabase
    .from("email_config")
    .select("*")
    .not("project_id", "is", null);

  if (oldErr) throw new Error("Error reading configs: " + (newErr?.message || oldErr.message));

  // Adapta el shape viejo al nuevo para que el loop funcione igual.
  const adapted = (oldConfigs || []).map(e => ({
    id: e.id,
    project_id: e.project_id,
    report_type: "weekly_po",
    enabled: Array.isArray(e.emails) && e.emails.length > 0,
    recipients: e.emails || [],
    schedule: {
      send_day: e.send_day || "monday",
      hour: e.send_hour ?? 8,
      frequency: e.frequency || "weekly",
    },
    window_cfg: {
      days_back: e.days_back ?? 7,
      days_forward: e.days_forward ?? 7,
    },
    last_sent: e.last_sent,
    _legacy: true,
  }));
  return { source: "legacy", configs: adapted };
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(503).json({ error: "Cron is not configured" });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── H-048: Drain del outbox de notificaciones al hub ────────────────────
  // Se ejecuta ANTES de los jobs de reportes. Usa service_role (createAdminClient)
  // porque hub_outbox tiene RLS activado y revoca el acceso a todos los roles
  // excepto service_role. El bloque está envuelto en su propio try/catch para que
  // un fallo del drain NUNCA interrumpa los jobs de reportes que siguen.
  try {
    const adminHub = createAdminClient();
    if (!adminHub) {
      console.warn("[cron:hub_drain] createAdminClient devolvió null (faltan vars de entorno); drain omitido.");
    } else {
      // Recovery (#6, H-BATCH-02): filas en 'processing' que un worker reclamó y
      // dejó colgadas (murió antes del UPDATE de resultado) quedarían atascadas,
      // porque hub_outbox_claim solo toma 'pending'/'failed'. Tras 10 min se
      // revierten a 'failed' (con next_attempt_at=ahora) para que el claim las retome.
      await adminHub.from("hub_outbox")
        .update({ status: "failed", next_attempt_at: new Date().toISOString(), last_error: "worker timeout - recuperada" })
        .eq("status", "processing")
        .lt("updated_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

      // hub_outbox_claim bloquea las filas con FOR UPDATE SKIP LOCKED para que
      // dos invocaciones del cron solapadas no procesen el mismo registro.
      const { data: items, error: claimErr } = await adminHub.rpc("hub_outbox_claim", { p_limit: 5 });
      if (claimErr) {
        // 42883 = función no existe (migración 038 aún no aplicada): silencioso.
        if (claimErr.code !== "42883") {
          console.error("[cron:hub_drain] hub_outbox_claim error:", claimErr.message);
        }
      } else if (Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          // #6 — hub_outbox_claim (migración 040) ya incrementó attempts y puso
          // la fila en status='processing'. El cron NO vuelve a sumar attempts;
          // usa item.attempts tal como lo devolvió el claim (ya es el nuevo valor).
          // El guard de todos los UPDATEs es .eq("status","processing") para evitar
          // sobrescribir si el webhook procesó la misma fila en paralelo.
          const currentAttempts = item.attempts; // ya incrementado por el claim
          let r;
          try {
            r = await notificarPagoAlHub(item.payload);
          } catch {
            // notificarPagoAlHub ya captura todas las excepciones internamente y
            // devuelve { ok: false }. Este catch es defensa extra ante cambios futuros.
            r = { ok: false, error: "excepción no esperada en notificarPagoAlHub" };
          }

          if (r.ok || r.duplicado) {
            // Envío exitoso (o el hub ya lo tenía: duplicado idempotente).
            const label = r.duplicado ? "duplicado" : String(r.transaccion_id ?? "ok");
            const { error: sentErr } = await adminHub
              .from("hub_outbox")
              .update({
                status: "sent",
                sent_at: new Date().toISOString(),
                last_error: null,
              })
              .eq("id", item.id)
              .eq("status", "processing"); // guard: solo si aún nos pertenece
            if (sentErr) {
              console.warn("[cron:hub_drain] marcar sent falló mp_payment_id=" + item.mp_payment_id + ":", sentErr.message);
            } else {
              console.log("[cron:hub_drain] sent mp_payment_id=" + item.mp_payment_id + " txn=" + label);
            }
          } else {
            // Hub falló: aplicar backoff exponencial 2^currentAttempts minutos.
            const isDead = currentAttempts >= item.max_attempts;
            const lastErrStr = String(r.error ?? "hub !ok").slice(0, 500);

            if (isDead) {
              // Estado terminal: no se vuelve a intentar. OJO: NO incluir
              // next_attempt_at en el update (columna NOT NULL; null la rompe).
              // Queda con el valor previo, lo que es aceptable porque el filtro
              // de hub_outbox_claim exige status IN ('pending','failed','processing'
              // con next_attempt_at <= NOW()).
              const { error: deadErr } = await adminHub
                .from("hub_outbox")
                .update({
                  status: "dead",
                  last_error: lastErrStr,
                })
                .eq("id", item.id)
                .eq("status", "processing"); // guard
              if (deadErr) {
                console.warn("[cron:hub_drain] marcar dead falló mp_payment_id=" + item.mp_payment_id + ":", deadErr.message);
              } else {
                // Error prominente: debe activar alerta en Vercel / Datadog.
                console.error("[cron:hub_drain] DEAD mp_payment_id=" + item.mp_payment_id + " intentos=" + currentAttempts + "/" + item.max_attempts + " error=" + lastErrStr);
              }
            } else {
              // Reintento diferido: backoff 2^currentAttempts minutos.
              const backoffMs = Math.pow(2, currentAttempts) * 60 * 1000;
              const nextAt = new Date(Date.now() + backoffMs).toISOString();
              const { error: failErr } = await adminHub
                .from("hub_outbox")
                .update({
                  status: "failed",
                  last_error: lastErrStr,
                  next_attempt_at: nextAt,
                })
                .eq("id", item.id)
                .eq("status", "processing"); // guard
              if (failErr) {
                console.warn("[cron:hub_drain] marcar failed falló mp_payment_id=" + item.mp_payment_id + ":", failErr.message);
              } else {
                console.warn("[cron:hub_drain] failed mp_payment_id=" + item.mp_payment_id + " intento " + currentAttempts + "/" + item.max_attempts + " próximo=" + nextAt);
              }
            }
          }
        }
      }
    }
  } catch (drainErr) {
    // NUNCA propaga: el drain es auxiliar, no puede cortar los reportes.
    console.error("[cron:hub_drain] excepción no esperada (drain abortado):", drainErr?.message);
  }

  try {
    const supabase = createSupabase(null, { admin: true });

    // ── Keep-alive de Supabase Free (ping cada >=6 días) ──
    try {
      const { data: ka } = await supabase
        .from("_keepalive")
        .select("pinged_at")
        .eq("id", 1)
        .maybeSingle();
      const daysSince = ka?.pinged_at
        ? (Date.now() - new Date(ka.pinged_at).getTime()) / 86_400_000
        : 999;
      if (daysSince >= 6) {
        const chars = [".", ",", "*", "·", "~", ":"];
        const ch = chars[Math.floor(Math.random() * chars.length)];
        await supabase.from("_keepalive").update({ ch, pinged_at: new Date().toISOString() }).eq("id", 1);
        console.log("[cron] keepalive ping:", ch);
      }
    } catch (kaErr) {
      console.warn("[cron] keepalive skipped:", kaErr?.message);
    }

    // ── Abrir retros de sprints cerrados o con end_date+3d ──
    // Cada hora chequea sprints elegibles y dispara /api/open-retro.
    try {
      const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

      // Sprints elegibles: status='closed' OR end_date <= cutoff,
      // sin período de retro abierto todavía.
      const { data: candidates } = await supabase
        .from("sprints")
        .select("id, project_id, name, end_date, status")
        .or(`status.eq.closed,end_date.lte.${cutoff}`);

      for (const sp of candidates || []) {
        const { data: existing } = await supabase
          .from("sprint_retro_periods")
          .select("id")
          .eq("sprint_id", sp.id)
          .maybeSingle();
        if (existing) continue;

        // Solo si el proyecto tiene la feature 'team_pulse'.
        const { data: feat } = await supabase.rpc("project_has_feature", {
          p_project_id: sp.project_id, p_feature: "team_pulse",
        });
        if (feat !== true) continue;

        const trigger = sp.status === "closed" ? "sprint_closed" : "end_date_passed";
        try {
          await fetchWithTimeout(`${getBaseUrl()}/api/open-retro`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Cron-Secret": process.env.CRON_SECRET },
            body: JSON.stringify({ sprintId: sp.id, trigger }),
          }, 25000);
          console.log(`[cron] Retro abierta para sprint ${sp.id} (${trigger})`);
        } catch (e) {
          console.warn(`[cron] No pude abrir retro sprint ${sp.id}:`, e?.message);
        }
      }
    } catch (retroErr) {
      console.warn("[cron] retros skipped:", retroErr?.message);
    }

    const { source, configs } = await loadConfigs(supabase);
    if (!configs.length) {
      return res.status(200).json({ skipped: true, reason: "No report configs found", source });
    }

    const results = [];
    // La función tiene maxDuration 60 s (vercel.json) y un informe con IA puede
    // comerse casi todo. Si no queda margen NO se empieza otro: se deja para el
    // siguiente tick horario, que sigue dentro de la ventana de tolerancia.
    // Antes se intentaban todos en serie y Vercel mataba la función a mitad, sin
    // log y sin fila en report_history.
    const INICIO_MS = Date.now();
    const PRESUPUESTO_MS = 40_000;
    let diferidos = 0;

    for (const config of configs) {
      if (!Array.isArray(config.recipients) || !config.recipients.length) {
        results.push({ project_id: config.project_id, type: config.report_type, skipped: true, reason: "Sin destinatarios" });
        continue;
      }

      const ocurrencia = ocurrenciaPendiente(config);
      if (!ocurrencia) {
        results.push({ project_id: config.project_id, type: config.report_type, skipped: true, reason: "No toca ahora" });
        continue;
      }

      if (Date.now() - INICIO_MS > PRESUPUESTO_MS) {
        diferidos++;
        results.push({
          project_id: config.project_id, type: config.report_type,
          deferred: true, reason: `sin presupuesto en esta pasada; se reintenta dentro de la ventana de ${TOLERANCIA_HORAS} h`,
        });
        continue;
      }

      // Reserva antes de gastar un céntimo de IA.
      const { reservada, error: resErr } = await reservarOcurrencia(supabase, config, ocurrencia);
      if (resErr) {
        console.error(`[cron] no se pudo reservar ${config.report_type} (proyecto ${config.project_id}):`, resErr.message);
        results.push({ project_id: config.project_id, type: config.report_type, error: "reserva fallida: " + resErr.message });
        continue;
      }
      if (!reservada) {
        results.push({ project_id: config.project_id, type: config.report_type, skipped: true, reason: "ya cubierto por otra pasada" });
        continue;
      }

      const range = computeRange(config);
      // Distinguir en qué fase se rompe no es un lujo: si falla la GENERACIÓN,
      // no salió ningún correo y liberar la reserva es seguro. Si falla el
      // ENVÍO, el correo pudo haber salido igual (un timeout contra Resend no
      // dice si el mensaje se entregó), así que NO se libera. Ante la duda,
      // preferimos un informe que no se reintenta —y que queda como 'failed'—
      // antes que un cliente recibiendo el mismo correo dos veces.
      let faseEnvio = false;
      try {
        const generated = await generateReport({
          projectId: config.project_id,
          reportType: config.report_type,
          range,
        });
        faseEnvio = true;
        await sendAndArchive({
          supabase,
          projectId: config.project_id,
          reportType: config.report_type,
          generated,
          recipients: config.recipients,
          range,
        });

        // No hace falta marcar last_sent: la reserva de arriba ya lo dejó en el
        // instante de la ocurrencia. Marcarlo aquí era el punto débil del
        // diseño anterior — si esa escritura fallaba, el informe ya había
        // salido y podía volver a salir.

        results.push({
          project_id: config.project_id,
          type: config.report_type,
          ok: true,
          sent_to: config.recipients.length,
          range: `${range.weekStart} -> ${range.weekEnd}`,
        });
      } catch (err) {
        console.error(`[cron] ${config.report_type} fallo:`, err?.message);
        if (faseEnvio) {
          console.error(`[cron] ${config.report_type} falló durante el envío; NO se libera la reserva porque el correo pudo haber salido.`);
        } else {
          // Falló generando: no hay correo posible. Se suelta la reserva para
          // que el siguiente tick lo reintente dentro de la ventana, en vez de
          // perder el informe hasta el próximo periodo.
          await liberarOcurrencia(supabase, config, ocurrencia);
        }
        // Deja rastro EN LA BASE, no solo en logs efimeros. El check constraint
        // de report_history contempla status='failed' y hasta hoy nadie lo
        // escribia nunca: 16 informes generados y 0 fallidos registrados no
        // significaba que ninguno fallara, sino que no habia forma de saberlo.
        const { error: logErr } = await supabase.from("report_history").insert({
          project_id: config.project_id,
          report_type: config.report_type,
          period_start: range?.weekStart ?? null,
          period_end: range?.weekEnd ?? null,
          status: "failed",
          plain_text: String(err?.message || err).slice(0, 2000),
        });
        if (logErr) console.error("[cron] tampoco se pudo registrar el fallo:", logErr.message);
        results.push({
          project_id: config.project_id,
          type: config.report_type,
          error: err?.message,
        });
      }
    }

    if (diferidos) {
      console.warn(`[cron] ${diferidos} informe(s) diferidos por presupuesto; la ventana de ${TOLERANCIA_HORAS} h permite recogerlos en los siguientes ticks.`);
    }

    return res.status(200).json({ ok: true, source, results, deferred: diferidos });
  } catch (err) {
    console.error("[cron] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
