import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { getAuthJsonHeaders } from "../../lib/authHeaders";
import { extractUsageMarker } from "../../aiModels";

// Configuración de los reportes IA por correo (Scrum / Semanal PO / Mensual).
// Extraído del monolito (H-002). REPORT_TYPES, DAY_NAMES_ES y ReportCard son
// internos de esta vista; ConfigTab importa ReportsConfigSection (default).

const REPORT_TYPES = [
  {
    key: "scrum",
    title: "Reporte Scrum bi-semanal",
    desc: "Tu copiloto operativo. Caza tareas atascadas, riesgos de entrega y lo que hay que destrabar hoy, sin que revises el tablero. Llega solo dos veces por semana.",
    icon: "🏃",
    color: "#542c9c",
    costPerMonth: "$0.33",
    endpoint: "/api/generate-scrum-report",
    defaultSchedule: { days: ["wednesday", "friday"], hour: 8 },
    defaultWindow: { days_back: 3, days_forward: 0 },
    badge: "PREMIUM",
  },
  {
    key: "weekly_po",
    title: "Reporte Semanal para el PO",
    desc: "Tu radar de decisión. Convierte la semana en un diagnóstico ejecutivo: qué avanzó, qué frenó, cómo rindió cada persona y dónde poner el foco. Listo para reenviar a tu jefe.",
    icon: "📊",
    color: "#0aa0ab",
    costPerMonth: "$0.85",
    endpoint: "/api/generate-report",
    defaultSchedule: { send_day: "monday", hour: 8, frequency: "weekly" },
    defaultWindow: { days_back: 7, days_forward: 7 },
    badge: "PREMIUM",
  },
  {
    key: "monthly_team",
    title: "Análisis Mensual del Equipo",
    desc: "Tu informe confidencial de gestión. Mide el aporte real de cada persona, separa a quien empuja de quien vende humo y compara contra los meses anteriores para mostrarte la tendencia.",
    icon: "🧠",
    color: "#ef7218",
    costPerMonth: "$0.13",
    endpoint: "/api/generate-monthly-report",
    defaultSchedule: { send_day: "monday", week: 1, hour: 8 },
    defaultWindow: {},
    badge: "PRIVADO · OWNER",
  },
];

const DAY_NAMES_ES = { monday: "Lunes", tuesday: "Martes", wednesday: "Miércoles", thursday: "Jueves", friday: "Viernes", saturday: "Sábado", sunday: "Domingo" };

export default function ReportsConfigSection({ projectId }) {
  const [configs, setConfigs] = useState({}); // map type → row
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState({});

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    supabase.from("report_configs")
      .select("*")
      .eq("project_id", projectId)
      .then(({ data, error }) => {
        if (error) {
          // Tabla puede no existir si la migración 012 no se aplicó
          setLoading(false);
          setConfigs({ __error: error.message });
          return;
        }
        const map = {};
        (data || []).forEach(r => { map[r.report_type] = r; });
        setConfigs(map);
        setLoading(false);
      });
  }, [projectId]);

  const updateLocal = (type, patch) => {
    setConfigs(prev => ({
      ...prev,
      [type]: { ...(prev[type] || {}), ...patch },
    }));
  };

  const persistConfig = async (type) => {
    const def = REPORT_TYPES.find(t => t.key === type);
    const row = configs[type] || {};
    const payload = {
      project_id: projectId,
      report_type: type,
      enabled: row.enabled ?? true,
      recipients: row.recipients || [],
      schedule: row.schedule || def.defaultSchedule,
      window_cfg: row.window_cfg || def.defaultWindow,
    };
    // Upsert por (project_id, report_type)
    const { data, error } = await supabase.from("report_configs")
      .upsert(payload, { onConflict: "project_id,report_type" })
      .select()
      .single();
    if (error) {
      setMsg(m => ({ ...m, [type]: "Error: " + error.message }));
    } else {
      updateLocal(type, data);
      setMsg(m => ({ ...m, [type]: "✓ Guardado" }));
    }
    setTimeout(() => setMsg(m => ({ ...m, [type]: "" })), 2500);
  };

  const triggerSend = async (type) => {
    const def = REPORT_TYPES.find(t => t.key === type);
    const row = configs[type] || {};
    if (!row.recipients?.length) {
      setMsg(m => ({ ...m, [type]: "Error: agrega al menos un correo" }));
      setTimeout(() => setMsg(m => ({ ...m, [type]: "" })), 4000);
      return;
    }
    setMsg(m => ({ ...m, [type]: "⏳ Generando..." }));
    try {
      const headers = await getAuthJsonHeaders();
      // Calcular ventana similar a lo que hace el cron
      const now = new Date();
      const fmt = (d) => d.toISOString().split("T")[0];
      let range;
      if (type === "monthly_team") {
        const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastPrev = new Date(firstThis.getTime() - 86400000);
        const firstPrev = new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1);
        range = { monthStart: fmt(firstPrev), monthEnd: fmt(lastPrev) };
      } else if (type === "scrum") {
        const back = row.window_cfg?.days_back ?? 3;
        const start = new Date(now); start.setDate(now.getDate() - back);
        range = { weekStart: fmt(start), weekEnd: fmt(now) };
      } else {
        const back = row.window_cfg?.days_back ?? 7;
        const forward = row.window_cfg?.days_forward ?? 7;
        const start = new Date(now); start.setDate(now.getDate() - back);
        const end = new Date(now); end.setDate(now.getDate() + forward);
        range = { weekStart: back === 0 ? "2020-01-01" : fmt(start), weekEnd: fmt(end) };
      }

      const genRes = await fetch(def.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ projectId, ...range }),
      });

      // weekly_po/monthly_team devuelven text/html (streaming); scrum devuelve
      // JSON con la metadata de costo ya incluida.
      const contentType = genRes.headers.get("content-type") || "";
      let payload;
      if (!genRes.ok) {
        const txt = await genRes.text();
        throw new Error(`Generación falló (${genRes.status}): ${txt.slice(0, 300)}`);
      }
      if (contentType.includes("application/json")) {
        payload = await genRes.json();
      } else {
        // Los endpoints en streaming adjuntan el costo real como un comentario
        // HTML al final (no pueden ir en headers: los tokens de salida solo se
        // conocen cuando Anthropic termina). Se extrae acá, best-effort: si
        // falla, se sigue con el HTML crudo y sin metadata de costo.
        const raw = await genRes.text();
        try {
          const { usage, html } = extractUsageMarker(raw);
          payload = {
            html,
            model: usage?.model,
            tokens_input: usage?.tokens_input,
            tokens_output: usage?.tokens_output,
            cost_usd: usage?.cost_usd,
          };
        } catch {
          payload = { html: raw };
        }
      }

      setMsg(m => ({ ...m, [type]: "📨 Enviando correo..." }));

      // Re-usa /api/send-report con metadata para archivo histórico.
      const sendRange = type === "monthly_team"
        ? { weekStart: range.monthStart, weekEnd: range.monthEnd }
        : range;
      const sendRes = await fetch("/api/send-report", {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectId,
          emails: row.recipients,
          html: payload.html,
          weekStart: sendRange.weekStart,
          weekEnd: sendRange.weekEnd,
          reportType: type,
          modelUsed: payload.model,
          tokensInput: payload.tokens_input,
          tokensOutput: payload.tokens_output,
          costUsd: payload.cost_usd,
          truncated: !!payload.truncated,
        }),
      });
      const sendData = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok || sendData.error) throw new Error(sendData.error || `Send falló (${sendRes.status})`);

      await supabase.from("report_configs")
        .update({ last_sent: new Date().toISOString() })
        .eq("project_id", projectId)
        .eq("report_type", type);

      setMsg(m => ({ ...m, [type]: `✓ Enviado a ${row.recipients.length} correo${row.recipients.length === 1 ? "" : "s"}${payload.truncated ? " (truncado por tokens)" : ""}` }));
    } catch (err) {
      setMsg(m => ({ ...m, [type]: "Error: " + err.message }));
    }
  };

  if (loading) {
    return <div style={{ padding: 20, color: "#888", fontSize: 13 }}>Cargando configuración de reportes…</div>;
  }

  if (configs.__error) {
    return (
      <div style={{ background: "#fff8e0", border: "1px solid #f0c060", padding: 16, borderRadius: 10, fontSize: 13 }}>
        ⚠️ La tabla <code>report_configs</code> aún no existe. Aplica la migración{" "}
        <code>012_reports_system.sql</code> en Supabase SQL Editor para usar el nuevo sistema de 3 reportes.
        Mientras tanto, la configuración antigua sigue funcionando para el reporte semanal.
      </div>
    );
  }

  return (
    <div data-tour="config-reports" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: "#333", display: "flex", alignItems: "center", gap: 8 }}>
        📬 Reportes IA por correo
      </div>
      {REPORT_TYPES.map(def => {
        const row = configs[def.key] || {};
        return (
          <ReportCard
            key={def.key}
            def={def}
            row={row}
            onUpdateLocal={(patch) => updateLocal(def.key, patch)}
            onSave={() => persistConfig(def.key)}
            onSend={() => triggerSend(def.key)}
            msg={msg[def.key]}
          />
        );
      })}
    </div>
  );
}

function ReportCard({ def, row, onUpdateLocal, onSave, msg }) {
  const recipients = row.recipients || [];
  const schedule = row.schedule || def.defaultSchedule;
  const [newEmail, setNewEmail] = useState("");
  const enabled = row.enabled ?? true;

  const addRecipient = () => {
    const email = newEmail.trim();
    if (!email.includes("@") || recipients.includes(email)) return;
    onUpdateLocal({ recipients: [...recipients, email] });
    setNewEmail("");
  };

  const removeRecipient = (e) => {
    onUpdateLocal({ recipients: recipients.filter(x => x !== e) });
  };

  const updateSchedule = (patch) => {
    onUpdateLocal({ schedule: { ...schedule, ...patch } });
  };

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 2px 16px rgba(0,0,0,0.06)", border: `1px solid ${def.color}33`, opacity: enabled ? 1 : 0.7 }}>
      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ fontSize: 22 }}>{def.icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: def.color, display: "flex", alignItems: "center", gap: 8 }}>
            {def.title}
            <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: `${def.color}22`, color: def.color, letterSpacing: "0.05em" }}>{def.badge}</span>
          </div>
          <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>{def.desc}</div>
          <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
            Costo aprox: <b>{def.costPerMonth}/proy/mes</b>
            {row.last_sent && <> · Último envío: {new Date(row.last_sent).toLocaleString("es-CO")}</>}
          </div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => onUpdateLocal({ enabled: e.target.checked })} />
          {enabled ? "Activo" : "Inactivo"}
        </label>
      </div>

      {/* Schedule por tipo */}
      <div style={{ background: "#fafafa", padding: 12, borderRadius: 8, marginTop: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
          Cuándo se envía
        </div>
        {def.key === "scrum" && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", fontSize: 13 }}>
              <span>Días:</span>
              {["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].map(d => {
                const selected = (schedule.days || []).includes(d);
                const atMax = (schedule.days || []).length >= 2 && !selected;
                return (
                  <label key={d} style={{ display: "flex", alignItems: "center", gap: 4, opacity: atMax ? 0.4 : 1, cursor: atMax ? "not-allowed" : "pointer" }} title={atMax ? "Máximo 2 días por semana" : ""}>
                    <input type="checkbox"
                      checked={selected}
                      disabled={atMax}
                      onChange={(e) => {
                        const days = new Set(schedule.days || []);
                        if (e.target.checked) {
                          if (days.size >= 2) return;  // bloqueo defensivo
                          days.add(d);
                        } else {
                          days.delete(d);
                        }
                        updateSchedule({ days: [...days] });
                      }}
                    />
                    {DAY_NAMES_ES[d].slice(0, 3)}
                  </label>
                );
              })}
              <span style={{ marginLeft: 12 }}>Hora:</span>
              <select value={schedule.hour ?? 8} onChange={(e) => updateSchedule({ hour: Number(e.target.value) })}
                style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 6, fontStyle: "italic" }}>
              Máximo 2 días por semana. Si ya tienes 2, desmarca uno para cambiar.
            </div>
          </>
        )}
        {def.key === "weekly_po" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", fontSize: 13 }}>
            <span>Día:</span>
            <select value={schedule.send_day || "monday"} onChange={(e) => updateSchedule({ send_day: e.target.value })}
              style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
              {Object.entries(DAY_NAMES_ES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <span>Hora:</span>
            <select value={schedule.hour ?? 8} onChange={(e) => updateSchedule({ hour: Number(e.target.value) })}
              style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
            </select>
          </div>
        )}
        {def.key === "monthly_team" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", fontSize: 13 }}>
            <span>Primer</span>
            <select value={schedule.send_day || "monday"} onChange={(e) => updateSchedule({ send_day: e.target.value })}
              style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
              {Object.entries(DAY_NAMES_ES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <span>del mes</span>
            <span style={{ marginLeft: 12 }}>Hora:</span>
            <select value={schedule.hour ?? 8} onChange={(e) => updateSchedule({ hour: Number(e.target.value) })}
              style={{ padding: "4px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Destinatarios */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
          Destinatarios ({recipients.length}/10)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
          {recipients.map(e => (
            <div key={e} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 6 }}>
              <span style={{ fontSize: 12, color: "#333", flex: 1 }}>📬 {e}</span>
              <button onClick={() => removeRecipient(e)} style={{ background: "#fde8e8", border: "1px solid #f5c6c6", color: "#c0392b", borderRadius: 5, padding: "2px 7px", cursor: "pointer", fontSize: 11 }}>✕</button>
            </div>
          ))}
        </div>
        {recipients.length < 10 && (
          <div style={{ display: "flex", gap: 6 }}>
            <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRecipient(); } }}
              placeholder="correo@ejemplo.com"
              style={{ flex: 1, padding: "7px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }} />
            <button onClick={addRecipient} style={{ background: def.color, color: "#fff", border: "none", borderRadius: 6, padding: "7px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
              Agregar
            </button>
          </div>
        )}
      </div>

      {/* Botones — los reportes solo salen en las fechas configuradas; no
          hay envío manual. Esto evita disparos accidentales y mantiene la
          regularidad que el equipo espera. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={onSave}
          style={{ background: "linear-gradient(135deg,#542c9c,#6e3ebf)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
          Guardar configuración
        </button>
        <span style={{ fontSize: 11, color: "#999", fontStyle: "italic" }}>
          🗓 Solo se envía automáticamente en las fechas configuradas
        </span>
        {msg && (
          <span style={{ fontSize: 12, color: msg.startsWith("Error") ? "#c0392b" : "#27ae60", marginLeft: 8 }}>{msg}</span>
        )}
      </div>
    </div>
  );
}
