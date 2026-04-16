import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function shouldSendToday(config) {
  const now = new Date();
  const currentHour = now.getUTCHours() - 5; // Colombia is UTC-5
  const configHour = config.send_hour ?? 8;

  // Only run at the configured hour (cron runs every hour)
  if (currentHour !== configHour) return false;

  const freq = config.frequency || "weekly";
  const lastSent = config.last_sent ? new Date(config.last_sent) : null;
  const daysSinceLast = lastSent ? (now - lastSent) / (1000 * 60 * 60 * 24) : Infinity;

  if (freq === "daily") return daysSinceLast >= 0.8;

  if (freq === "weekly" || freq === "biweekly") {
    const todayDay = now.getDay();
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

  let start;
  if (daysBack === 0) {
    start = "2020-01-01";
  } else {
    const s = new Date(now);
    s.setDate(now.getDate() - daysBack);
    start = fmt(s);
  }
  const e = new Date(now);
  e.setDate(now.getDate() + daysForward);
  const end = fmt(e);

  return { weekStart: start, weekEnd: end };
}

export default async function handler(req, res) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Read email config
    const { data: config, error: cfgErr } = await supabase
      .from("email_config").select("*").eq("id", 1).single();
    if (cfgErr || !config) return res.status(200).json({ skipped: true, reason: "No config found" });
    if (!config.emails || config.emails.length === 0) return res.status(200).json({ skipped: true, reason: "No emails configured" });

    // 2. Check if we should send today
    if (!shouldSendToday(config)) {
      return res.status(200).json({ skipped: true, reason: "Not scheduled for now" });
    }

    // 3. Read tasks from Supabase
    const { data: tasksRaw, error: taskErr } = await supabase.from("tasks").select("*");
    if (taskErr) return res.status(500).json({ error: "Error reading tasks: " + taskErr.message });

    const tasks = (tasksRaw || []).map(r => ({
      id: r.id, title: r.title || "", status: r.status || "Sin iniciar",
      responsible: r.responsible || "", indicator: r.indicator || "",
      indicators: r.indicators || [],
      progressPercent: r.progress_percent ?? 0, progress_percent: r.progress_percent ?? 0,
      aporteSnapshot: r.aporte_snapshot ?? 0, aporte_snapshot: r.aporte_snapshot ?? 0,
      comments: r.comments || "", subtasks: r.subtasks || [],
      startDate: r.start_date || "", start_date: r.start_date || "",
      endDate: r.end_date || "", end_date: r.end_date || "",
      expectedDelivery: r.expected_delivery || "", expected_delivery: r.expected_delivery || "",
      type: r.type || "", difficulty: r.difficulty ?? 5,
      strategicValue: r.strategic_value ?? 5, strategic_value: r.strategic_value ?? 5,
    }));

    // 4. Read participants and indicators
    const [{ data: participants }, { data: indicators }] = await Promise.all([
      supabase.from("participants").select("*"),
      supabase.from("indicators").select("*"),
    ]);

    // 5. Compute date range from config
    const { weekStart, weekEnd } = computeDateRange(config);

    // 6. Call generate-report (our own edge function)
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://w-planner.vercel.app";

    const genRes = await fetch(`${baseUrl}/api/generate-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks, participants, indicators, weekStart, weekEnd }),
    });

    if (!genRes.ok) {
      const errText = await genRes.text();
      return res.status(500).json({ error: `Generate failed (${genRes.status}): ${errText.substring(0, 200)}` });
    }

    const html = await genRes.text();

    // 7. Send emails via Resend
    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.REPORT_FROM_EMAIL || "onboarding@resend.dev",
        to: config.emails,
        subject: `Reporte Banco W · ${weekStart} al ${weekEnd}`,
        html,
      }),
    });

    const sendData = await sendRes.json();
    if (sendData.error) {
      return res.status(500).json({ error: "Send failed: " + JSON.stringify(sendData.error) });
    }

    // 8. Update last_sent
    await supabase.from("email_config")
      .update({ last_sent: new Date().toISOString() })
      .eq("id", 1);

    return res.status(200).json({
      ok: true,
      sent_to: config.emails.length,
      range: `${weekStart} → ${weekEnd}`,
    });
  } catch (err) {
    console.error("[cron] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
