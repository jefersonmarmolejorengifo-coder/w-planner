/**
 * generate-report.js
 * Genera el HTML del reporte semanal de tareas W Planner.
 * Se puede usar como endpoint GET o importar generateReport() en send-report.js.
 */

const STATUS_ORDER = [
  "En proceso",
  "Bloqueada",
  "En pausa",
  "Sin iniciar",
  "No programada",
  "Finalizada",
  "Cancelada",
];

const STATUS_COLOR = {
  "En proceso":    "#ec6c04",
  "Bloqueada":     "#c0392b",
  "En pausa":      "#149cac",
  "Sin iniciar":   "#542c9c",
  "No programada": "#969696",
  "Finalizada":    "#27ae60",
  "Cancelada":     "#969696",
};

function generateReport(tasks, generatedAt) {
  const date = generatedAt || new Date().toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const grouped = {};
  for (const s of STATUS_ORDER) grouped[s] = [];
  for (const t of tasks) {
    const s = t.status || "Sin iniciar";
    if (!grouped[s]) grouped[s] = [];
    grouped[s].push(t);
  }

  const total    = tasks.length;
  const done     = grouped["Finalizada"].length;
  const active   = grouped["En proceso"].length;
  const blocked  = grouped["Bloqueada"].length;
  const avgProg  = total > 0
    ? (tasks.reduce((a, t) => a + (Number(t.progress_percent) || 0), 0) / total).toFixed(1)
    : "0.0";

  const pill = (label, val, color) =>
    `<td style="padding:0 8px;text-align:center;">
      <div style="background:${color}18;border:1px solid ${color}44;border-radius:10px;padding:10px 16px;">
        <div style="font-size:24px;font-weight:800;color:${color};">${val}</div>
        <div style="font-size:11px;color:#666;margin-top:2px;">${label}</div>
      </div>
    </td>`;

  const taskRow = (t) => {
    const color = STATUS_COLOR[t.status] || "#969696";
    const prog  = Number(t.progress_percent || 0);
    const bar   = `<div style="height:6px;background:#f0f0f0;border-radius:3px;margin-top:4px;">
      <div style="width:${Math.min(100, prog)}%;height:100%;background:${prog >= 100 ? "#27ae60" : "#ec6c04"};border-radius:3px;"></div>
    </div>`;
    const subtasksDone = (t.subtasks || []).filter(s => s && s.done).length;
    const subtasksTotal = (t.subtasks || []).length;
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;vertical-align:top;">
          <div style="font-size:13px;font-weight:600;color:#1a1a2e;">${t.title || "(sin título)"}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;">
            ${t.indicator ? `📊 ${t.indicator} &nbsp;` : ""}
            ${t.responsible ? `👤 ${t.responsible} &nbsp;` : ""}
            ${subtasksTotal > 0 ? `☑ ${subtasksDone}/${subtasksTotal} &nbsp;` : ""}
          </div>
          ${prog > 0 ? bar : ""}
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;vertical-align:top;white-space:nowrap;">
          <span style="background:${color}18;color:${color};border:1px solid ${color}44;border-radius:8px;padding:3px 9px;font-size:11px;font-weight:600;">${t.status}</span>
        </td>
        <td style="padding:10px 14px;border-bottom:1px solid #f0f0f0;vertical-align:top;text-align:right;">
          <span style="font-size:12px;color:#666;">${prog.toFixed(0)}%</span>
        </td>
      </tr>`;
  };

  const sections = STATUS_ORDER
    .filter(s => grouped[s].length > 0)
    .map(s => {
      const color = STATUS_COLOR[s];
      const rows  = grouped[s].map(taskRow).join("");
      return `
        <div style="margin-bottom:28px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <div style="width:12px;height:12px;border-radius:50%;background:${color};"></div>
            <span style="font-size:13px;font-weight:700;color:${color};">${s}</span>
            <span style="font-size:12px;color:#999;">(${grouped[s].length})</span>
          </div>
          <table style="width:100%;border-collapse:collapse;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,0.06);">
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    }).join("");

  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reporte Semanal W Planner</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:system-ui,'Segoe UI',sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#2d1b5e 60%,#16213e 100%);border-radius:16px;padding:28px 28px 20px;margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div style="width:42px;height:42px;background:linear-gradient(135deg,#ec6c04,#f07d1e);border-radius:10px;display:flex;align-items:center;justify-content:center;">
          <span style="font-size:20px;">📋</span>
        </div>
        <div>
          <div style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">W Planner</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.6);margin-top:1px;">Reporte semanal de tareas</div>
        </div>
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,0.55);">Generado el ${date} · Colombia</div>
    </div>

    <!-- Resumen -->
    <div style="background:#ffffff;border-radius:14px;padding:18px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <div style="font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:14px;">Resumen general</div>
      <table style="width:100%;border-collapse:collapse;"><tr>
        ${pill("Total", total, "#542c9c")}
        ${pill("En proceso", active, "#ec6c04")}
        ${pill("Finalizadas", done, "#27ae60")}
        ${pill("Bloqueadas", blocked, "#c0392b")}
        ${pill("Avance prom.", avgProg + "%", "#149cac")}
      </tr></table>
    </div>

    <!-- Tareas por estado -->
    <div style="background:#ffffff;border-radius:14px;padding:20px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <div style="font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:18px;">Tareas por estado</div>
      ${sections}
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:12px 0;">
      <div style="font-size:11px;color:#aaa;">
        W Planner · Banco W S.A. &nbsp;·&nbsp; Jeferson Marmolejo Rengifo
      </div>
    </div>

  </div>
</body>
</html>`;

  return {
    html,
    subject: `📋 Reporte semanal W Planner — ${total} tareas · ${active} en proceso`,
    summary: { total, done, active, blocked, avgProg },
  };
}

// ── Vercel serverless handler ────────────────────────────────
const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: tasks, error } = await supabase.from("tasks").select("*").order("id");
  if (error) return res.status(500).json({ error: error.message });

  const report = generateReport(tasks || []);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(200).send(report.html);
};

module.exports.generateReport = generateReport;
