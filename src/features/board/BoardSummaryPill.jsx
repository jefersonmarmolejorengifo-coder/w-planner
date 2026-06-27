import { useState, useEffect } from "react";
import { supabase } from '../../supabaseClient';
import { REPORT_TYPE_LABEL } from '../../constants';
import { useDialog } from '../../useDialog';

// ─── ReportViewerDialog ────────────────────────────────────────
// Modal accesible para ver un reporte IA archivado.
// Se monta solo cuando hay un reporte abierto, por eso useDialog
// funciona correctamente (foco inicial, trampa de foco, Escape).
function ReportViewerDialog({ report, onClose }) {
  const dialogRef = useDialog(onClose);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100003, background: "rgba(5,5,14,0.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Reporte"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{ background: "#14141f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, maxWidth: 760, width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 26, color: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{REPORT_TYPE_LABEL[report.report_type] || report.report_type}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{report.period_start} a {report.period_end}</div>
          </div>
          <button aria-label="Cerrar" onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>Cerrar</button>
        </div>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.85)", margin: 0 }}>{report.plain_text || "(Sin texto archivado)"}</pre>
      </div>
    </div>
  );
}

const TASK_DONE = "Finalizada", TASK_BLOCKED = "Bloqueada";

// ─── Resumen del tablero activo (pastilla + panel) ────────────
// Pastilla en el header que abre un panel con la info general del tablero
// puntual: KPIs, distribución por estado, top aportantes y los reportes de IA
// archivados de ESE tablero. Reusa el estilo del dashboard consolidado.
export default function BoardSummaryPill({ projectId, projectName }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [s, setS] = useState(null);
  const [reports, setReports] = useState([]);
  const [openReport, setOpenReport] = useState(null);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: tk }, { data: rh }] = await Promise.all([
        supabase.from("tasks").select("status, responsible, aporte_snapshot, end_date").eq("project_id", projectId),
        supabase.from("report_history").select("id, report_type, period_start, period_end, plain_text, model_used").eq("project_id", projectId).order("generated_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const ts = tk || [];
      const today = new Date().toISOString().slice(0, 10);
      const total = ts.length;
      const done = ts.filter(t => t.status === TASK_DONE).length;
      const blocked = ts.filter(t => t.status === TASK_BLOCKED).length;
      const notStarted = ts.filter(t => t.status === "Sin iniciar").length;
      const inProgress = total - done - blocked - notStarted;
      const overdue = ts.filter(t => t.status !== TASK_DONE && t.end_date && t.end_date < today).length;
      const aporteBy = {};
      ts.forEach(t => { if (t.responsible) aporteBy[t.responsible] = (aporteBy[t.responsible] || 0) + (Number(t.aporte_snapshot) || 0); });
      const top = Object.entries(aporteBy).sort((a, b) => b[1] - a[1]).slice(0, 3);
      setS({ total, done, blocked, notStarted, inProgress, overdue, people: new Set(ts.map(t => t.responsible).filter(Boolean)).size, donePct: total ? Math.round(done / total * 100) : 0, top });
      setReports(rh || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, projectId]);

  const card = { background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, padding: 16, color: "#fff" };
  const seg = [
    { n: "done", label: "Hechas", c: "#27ae60" },
    { n: "inProgress", label: "En proceso", c: "#3a86d6" },
    { n: "blocked", label: "Bloqueadas", c: "#e74c3c" },
    { n: "notStarted", label: "Sin iniciar", c: "#7a8aa0" },
  ];

  return (
    <>
      <button onClick={() => setOpen(true)} title="Resumen de este tablero"
        style={{ background: "rgba(20,156,172,0.18)", border: "1px solid rgba(20,156,172,0.45)", color: "#4dd8e8", borderRadius: 999, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap" }}>
        📊 Resumen
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 100002, background: "radial-gradient(900px 500px at 50% -10%, rgba(20,156,172,0.18), rgba(8,8,18,0.95) 60%)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "44px 18px" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 680, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>Resumen del tablero</div>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>{projectName || "Tablero"}</h2>
              </div>
              <button onClick={() => setOpen(false)} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 17, cursor: "pointer", flexShrink: 0 }}>✕</button>
            </div>

            {loading || !s ? (
              <div style={{ ...card, textAlign: "center", color: "rgba(255,255,255,0.6)", padding: 40 }}>Cargando resumen…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* KPIs */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 10 }}>
                  {[["Avance", `${s.donePct}%`, "#27ae60"], ["Tareas", s.total, "#fff"], ["Bloqueadas", s.blocked, s.blocked ? "#e74c3c" : "#fff"], ["Vencidas", s.overdue, s.overdue ? "#f5a623" : "#fff"], ["Personas", s.people, "#bb8fff"]].map(([l, v, c]) => (
                    <div key={l} style={{ ...card, textAlign: "center", padding: "13px 8px" }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: c, letterSpacing: -1 }}>{v}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 3 }}>{l}</div>
                    </div>
                  ))}
                </div>

                {/* Distribución por estado */}
                <div style={card}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Distribución por estado</div>
                  <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                    {seg.map(g => s[g.n] > 0 && <div key={g.n} title={`${g.label}: ${s[g.n]}`} style={{ width: `${s[g.n] / s.total * 100}%`, background: g.c }} />)}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
                    {seg.map(g => (
                      <span key={g.n} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: g.c }} />{g.label}: <b style={{ color: "#fff" }}>{s[g.n]}</b>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Top aportantes */}
                {s.top.length > 0 && (
                  <div style={card}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Top aportantes</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {s.top.map(([name, ap], i) => (
                        <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 13 }}>{["🥇", "🥈", "🥉"][i]}</span>
                          <span style={{ flex: 1, fontSize: 13, color: "#fff" }}>{name}</span>
                          <span style={{ fontSize: 12, color: "#7ee2a8", fontWeight: 700 }}>{ap.toFixed(1)} pts</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reportes IA del tablero */}
                <div style={card}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Reportes IA ({reports.length})</div>
                  {reports.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)" }}>Aún no hay reportes archivados de este tablero.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {reports.map(r => (
                        <button key={r.id} onClick={() => setOpenReport(r)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "9px 11px", cursor: "pointer", textAlign: "left", color: "#fff", fontFamily: "inherit" }}>
                          <span style={{ fontSize: 12.5 }}><b>{REPORT_TYPE_LABEL[r.report_type] || r.report_type}</b><span style={{ color: "rgba(255,255,255,0.45)" }}> · {r.period_start} a {r.period_end}</span></span>
                          <span style={{ fontSize: 11, color: "#4dd8e8" }}>Ver →</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {openReport && (
            <ReportViewerDialog report={openReport} onClose={() => setOpenReport(null)} />
          )}
        </div>
      )}
    </>
  );
}
