/**
 * send-report.js
 * Envía el reporte semanal por correo a los destinatarios configurados en email_config.
 *
 * Proveedor de email: Resend (https://resend.com)
 * Variables de entorno requeridas:
 *   VITE_SUPABASE_URL          — URL del proyecto Supabase
 *   SUPABASE_SERVICE_ROLE_KEY  — Service role key (Settings > API en Supabase)
 *   RESEND_API_KEY             — API key de Resend
 *   REPORT_FROM_EMAIL          — Email remitente verificado en Resend (solo el email)
 *                                 Ejemplo: reportes@tu-dominio.com
 *
 * Llamada manual:  POST /api/send-report
 * Llamada forzada: POST /api/send-report  con body { "force": true }
 *   force=true omite la verificación del día de envío.
 *
 * Para ejecutarlo automáticamente cada semana configura vercel.json:
 * {
 *   "crons": [{ "path": "/api/send-report", "schedule": "0 8 * * 1" }]
 * }
 * (Envía los lunes a las 8 AM UTC; ajusta según send_day en email_config)
 */

const { createClient } = require("@supabase/supabase-js");
const { generateReport } = require("./generate-report.js");

const DAYS_ES = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];

function getTodayInColombia() {
  const now = new Date();
  const dayIndex = Number(
    new Intl.DateTimeFormat("es-CO", {
      timeZone: "America/Bogota",
      weekday: "long",
    })
      .formatToParts(now)
      .find((p) => p.type === "weekday")
      ?.value
      ? DAYS_ES.indexOf(
          new Intl.DateTimeFormat("es-CO", {
            timeZone: "America/Bogota",
            weekday: "long",
          }).format(now).toLowerCase()
        )
      : now.getDay()
  );
  return DAYS_ES[dayIndex] || DAYS_ES[now.getDay()];
}

async function sendViaResend({ to, subject, html, from }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Resend error ${res.status}`);
  return data;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // ── 1. Leer configuración de correos ──────────────────────
  const { data: configRows, error: configErr } = await supabase
    .from("email_config")
    .select("*")
    .limit(1);

  if (configErr) return res.status(500).json({ error: "No se pudo leer email_config: " + configErr.message });

  const config   = configRows?.[0];
  const emails   = config?.emails || [];
  const sendDay  = (config?.send_day || "lunes").toLowerCase();

  if (emails.length === 0) {
    return res.status(200).json({ skipped: true, reason: "No hay correos configurados" });
  }

  // ── 2. Verificar día de envío (salvo force=true) ──────────
  const force = req.body?.force === true || req.query?.force === "true";
  if (!force) {
    const today = getTodayInColombia();
    if (today !== sendDay) {
      return res.status(200).json({
        skipped: true,
        reason: `Hoy es ${today}, día de envío configurado: ${sendDay}`,
      });
    }
  }

  // ── 3. Obtener tareas de Supabase ─────────────────────────
  const { data: tasks, error: tasksErr } = await supabase
    .from("tasks")
    .select("*")
    .order("id");

  if (tasksErr) return res.status(500).json({ error: "No se pudo leer tareas: " + tasksErr.message });

  // ── 4. Generar reporte ────────────────────────────────────
  const { html, subject, summary } = generateReport(tasks || []);

  // ── 5. Enviar a cada destinatario ─────────────────────────
  const from    = `W Planner Banco W <${process.env.REPORT_FROM_EMAIL || "noreply@resend.dev"}>`;
  const results = [];
  const errors  = [];

  for (const email of emails) {
    try {
      const result = await sendViaResend({ to: email, subject, html, from });
      results.push({ email, id: result.id, ok: true });
    } catch (err) {
      errors.push({ email, error: err.message });
    }
  }

  // ── 6. Registrar envío en Supabase ────────────────────────
  await supabase.from("email_config").update({
    last_sent_at: new Date().toISOString(),
    last_sent_summary: summary,
  }).eq("id", config.id);

  return res.status(errors.length === emails.length ? 500 : 200).json({
    sent: results,
    errors,
    summary,
    subject,
  });
}
