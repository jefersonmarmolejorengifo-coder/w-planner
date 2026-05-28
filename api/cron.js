import { createSupabase } from "./_auth.js";
import { getResendConfig, normalizeRecipients, sanitizeReportHtml } from "./_email.js";

// ─── Helpers de tiempo en Colombia ─────────────────────────
const DAY_MAP = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};
const DAY_NAMES = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function getColombiaNow() {
  const now = new Date();
  const colombiaOffsetMin = -5 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + colombiaOffsetMin * 60000);
}

const fmt = (d) => d.toISOString().split("T")[0];

// ─── Helpers de schedule por tipo ──────────────────────────
// Decide si AHORA toca enviar este reporte. Devuelve true sólo en la hora
// pactada y sólo si hace suficiente tiempo desde el último envío.
function shouldSendNow(config) {
  const colombia = getColombiaNow();
  const currentHour = colombia.getHours();
  const todayName = DAY_NAMES[colombia.getDay()];
  const lastSent = config.last_sent ? new Date(config.last_sent) : null;
  const sched = config.schedule || {};

  // Mínimo 4 horas entre envíos (evita re-disparos por bug en cron).
  const hoursSinceLast = lastSent
    ? (Date.now() - lastSent.getTime()) / 3_600_000
    : Infinity;
  if (hoursSinceLast < 4) return false;

  if (config.report_type === "scrum") {
    // schedule: { days: ["wednesday","friday"], hour: 8 } o por día:
    //           { days: [...], hours: { wednesday: 8, friday: 17 } }
    const days = Array.isArray(sched.days) && sched.days.length
      ? sched.days
      : ["wednesday", "friday"];
    const targetHour = (sched.hours && sched.hours[todayName])
      ?? sched.hour ?? 8;
    if (!days.includes(todayName)) return false;
    if (currentHour !== targetHour) return false;
    return true;
  }

  if (config.report_type === "weekly_po") {
    // schedule: { send_day: "monday", hour: 8 }
    const targetDay = sched.send_day || "monday";
    const targetHour = sched.hour ?? 8;
    if (todayName !== targetDay) return false;
    if (currentHour !== targetHour) return false;
    // Al menos 5 días desde el último envío (defensa contra duplicados).
    const days = hoursSinceLast / 24;
    return days >= 5;
  }

  if (config.report_type === "monthly_team") {
    // schedule: { send_day: "monday", week: 1, hour: 8 } → primer lunes del mes.
    const targetDay = sched.send_day || "monday";
    const targetWeek = sched.week ?? 1; // primera semana
    const targetHour = sched.hour ?? 8;
    if (todayName !== targetDay) return false;
    if (currentHour !== targetHour) return false;
    // ¿Estamos en la N-ésima semana del mes? Para "primera semana" → día 1-7.
    const dayOfMonth = colombia.getDate();
    const minDay = (targetWeek - 1) * 7 + 1;
    const maxDay = targetWeek * 7;
    if (dayOfMonth < minDay || dayOfMonth > maxDay) return false;
    // Al menos 25 días desde el último envío.
    const days = hoursSinceLast / 24;
    return days >= 25;
  }

  return false;
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

  const genRes = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cron-Secret": cronSecret,
    },
    body: JSON.stringify(body),
  });

  if (!genRes.ok) {
    const errText = await genRes.text();
    throw new Error(`Generate failed (${genRes.status}): ${errText.substring(0, 200)}`);
  }

  // weekly_po devuelve text/html stream; los otros JSON con metadata.
  const contentType = genRes.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await genRes.json();
  }
  const html = await genRes.text();
  return { html };
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

  const sendRes = await fetch("https://api.resend.com/emails", {
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

  // Archiva (sin bloquear si la tabla aún no existe).
  try {
    await supabase.from("report_history").insert({
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

    const { source, configs } = await loadConfigs(supabase);
    if (!configs.length) {
      return res.status(200).json({ skipped: true, reason: "No report configs found", source });
    }

    const results = [];
    for (const config of configs) {
      if (!Array.isArray(config.recipients) || !config.recipients.length) {
        results.push({ project_id: config.project_id, type: config.report_type, skipped: true, reason: "Sin destinatarios" });
        continue;
      }

      if (!shouldSendNow(config)) {
        results.push({ project_id: config.project_id, type: config.report_type, skipped: true, reason: "No toca ahora" });
        continue;
      }

      const range = computeRange(config);
      try {
        const generated = await generateReport({
          projectId: config.project_id,
          reportType: config.report_type,
          range,
        });
        await sendAndArchive({
          supabase,
          projectId: config.project_id,
          reportType: config.report_type,
          generated,
          recipients: config.recipients,
          range,
        });

        // Marca last_sent. Usa la tabla correcta según fuente.
        if (config._legacy) {
          await supabase.from("email_config")
            .update({ last_sent: new Date().toISOString() })
            .eq("id", config.id);
        } else {
          await supabase.from("report_configs")
            .update({ last_sent: new Date().toISOString() })
            .eq("id", config.id);
        }

        results.push({
          project_id: config.project_id,
          type: config.report_type,
          ok: true,
          sent_to: config.recipients.length,
          range: `${range.weekStart} -> ${range.weekEnd}`,
        });
      } catch (err) {
        console.error(`[cron] ${config.report_type} fallo:`, err?.message);
        results.push({
          project_id: config.project_id,
          type: config.report_type,
          error: err?.message,
        });
      }
    }

    return res.status(200).json({ ok: true, source, results });
  } catch (err) {
    console.error("[cron] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
