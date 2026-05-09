import { createSupabase } from "./_auth.js";
import { getResendConfig, normalizeRecipients, sanitizeReportHtml } from "./_email.js";

const DAY_MAP = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function getColombiaNow() {
  const now = new Date();
  const colombiaOffset = -5 * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + colombiaOffset * 60000);
}

function shouldSendToday(config) {
  const colombia = getColombiaNow();
  const currentHour = colombia.getHours();
  const configHour = config.send_hour ?? 8;

  if (currentHour !== configHour) return false;

  const now = new Date();
  const freq = config.frequency || "weekly";
  const lastSent = config.last_sent ? new Date(config.last_sent) : null;
  const daysSinceLast = lastSent ? (now - lastSent) / (1000 * 60 * 60 * 24) : Infinity;

  if (freq === "daily") return daysSinceLast >= 0.8;

  if (freq === "weekly" || freq === "biweekly") {
    const todayDay = colombia.getDay();
    const targetDay = DAY_MAP[config.send_day || "monday"] ?? 1;
    if (todayDay !== targetDay) return false;
    return freq === "weekly" ? daysSinceLast >= 5 : daysSinceLast >= 12;
  }

  if (freq === "monthly") return daysSinceLast >= 28;
  if (freq === "bimonthly") return daysSinceLast >= 55;
  if (freq === "quarterly") return daysSinceLast >= 85;
  if (freq === "semiannual") return daysSinceLast >= 170;

  return false;
}

function computeDateRange(config) {
  const now = new Date();
  const fmt = (d) => d.toISOString().split("T")[0];
  const daysBack = config.days_back ?? 7;
  const daysForward = config.days_forward ?? 7;

  const startDate = new Date(now);
  startDate.setDate(now.getDate() - daysBack);

  const endDate = new Date(now);
  endDate.setDate(now.getDate() + daysForward);

  return {
    weekStart: daysBack === 0 ? "2020-01-01" : fmt(startDate),
    weekEnd: fmt(endDate),
  };
}

const getBaseUrl = () =>
  process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.APP_BASE_URL || "https://productivity-plus.vercel.app";

async function generateReport({ projectId, weekStart, weekEnd }) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET no esta configurado");

  const genRes = await fetch(`${getBaseUrl()}/api/generate-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cron-Secret": cronSecret,
    },
    body: JSON.stringify({ projectId, weekStart, weekEnd }),
  });

  if (!genRes.ok) {
    const errText = await genRes.text();
    throw new Error(`Generate failed (${genRes.status}): ${errText.substring(0, 200)}`);
  }

  return genRes.text();
}

async function sendReportEmail({ emails, html, weekStart, weekEnd }) {
  const recipients = normalizeRecipients(emails);
  const safeHtml = sanitizeReportHtml(html);
  const { apiKey, from } = getResendConfig();

  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: recipients,
      subject: `Reporte Productivity-Plus - ${weekStart} al ${weekEnd}`,
      html: safeHtml,
    }),
  });

  const sendData = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok || sendData.error) {
    throw new Error("Send failed: " + JSON.stringify(sendData.error || sendData));
  }
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
    const { data: configs, error } = await supabase
      .from("email_config")
      .select("*")
      .not("project_id", "is", null);

    if (error) return res.status(500).json({ error: "Error reading email config: " + error.message });
    if (!configs?.length) return res.status(200).json({ skipped: true, reason: "No project email configs found" });

    const results = [];
    for (const config of configs) {
      if (!config.emails?.length) {
        results.push({ project_id: config.project_id, skipped: true, reason: "No emails configured" });
        continue;
      }

      if (!shouldSendToday(config)) {
        results.push({ project_id: config.project_id, skipped: true, reason: "Not scheduled for now" });
        continue;
      }

      const { weekStart, weekEnd } = computeDateRange(config);
      const html = await generateReport({ projectId: config.project_id, weekStart, weekEnd });
      await sendReportEmail({ emails: config.emails, html, weekStart, weekEnd });

      await supabase
        .from("email_config")
        .update({ last_sent: new Date().toISOString() })
        .eq("id", config.id);

      results.push({
        project_id: config.project_id,
        ok: true,
        sent_to: config.emails.length,
        range: `${weekStart} -> ${weekEnd}`,
      });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error("[cron] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
