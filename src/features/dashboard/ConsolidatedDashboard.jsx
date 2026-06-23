import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { REPORT_TYPE_LABEL } from "../../constants";

// Visión consolidada del dueño: KPIs agregados de todos sus tableros + reportes
// de IA archivados. Extraído del monolito (H-002) y cargado con React.lazy.
// La agregación de KPIs ocurre en el servidor vía la RPC owner_boards_overview (H-015).

// Contenedor del diálogo a nivel de módulo (antes era un componente-en-render, que
// se recreaba en cada render y remontaba sus hijos). Declararlo fuera evita ese
// remontaje y satisface react-hooks/static-components.
function DashboardShell({ onClose, children }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Visión consolidada" style={{ position: "fixed", inset: 0, zIndex: 100002, background: "radial-gradient(1200px 600px at 50% -10%, rgba(20,156,172,0.18), rgba(8,8,18,0.97) 60%)", overflowY: "auto", padding: "40px 20px", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", position: "relative" }}>
        <button onClick={onClose} aria-label="Cerrar" style={{ position: "absolute", top: -10, right: 0, width: 38, height: 38, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 18, cursor: "pointer" }}>✕</button>
        {children}
      </div>
    </div>
  );
}

export default function ConsolidatedDashboard({ authUser, onClose, onOpenProject }) {
  const [loading, setLoading] = useState(true);
  const [capacity, setCapacity] = useState(null);
  const [boards, setBoards] = useState([]);     // [{ project, total, done, blocked, inProgress, notStarted, donePct, overdue, top, people }]
  const [reports, setReports] = useState([]);   // report_history rows
  const [distinctPeople, setDistinctPeople] = useState(0); // personas distintas (global, server-side)
  const [openReport, setOpenReport] = useState(null);
  const [section, setSection] = useState("overview"); // 'overview' | 'reports'

  useEffect(() => {
    if (!authUser?.id) return;
    let cancelled = false;
    (async () => {
      const { data: cap } = await supabase.rpc("user_ia_capacity").single();
      if (cancelled) return;
      setCapacity(cap || null);

      const { data: projs } = await supabase
        .from("projects").select("id, name, description, ia_enabled")
        .eq("owner_id", authUser.id).order("id");
      const projList = projs || [];
      const ids = projList.map(p => p.id);

      let reportRows = [], byBoard = [], distinctPeopleCount = 0;
      if (ids.length) {
        // H-015: los KPIs por tablero se agregan en el SERVIDOR (RPC) en vez de
        // traer todas las tareas al cliente. report_history se sigue cargando
        // (volumen bajo) para la pestaña de reportes y el conteo por tablero.
        const [{ data: overview }, { data: rh }] = await Promise.all([
          supabase.rpc("owner_boards_overview"),
          supabase.from("report_history").select("id, project_id, report_type, period_start, period_end, generated_at, plain_text, model_used").in("project_id", ids).order("generated_at", { ascending: false }),
        ]);
        reportRows = rh || [];
        const ov = overview || {};
        distinctPeopleCount = ov.distinct_people || 0;
        const projById = Object.fromEntries(projList.map(p => [p.id, p]));
        byBoard = (ov.boards || []).map(bd => {
          const p = projById[bd.project_id] || { id: bd.project_id, name: bd.name, description: bd.description, ia_enabled: bd.ia_enabled };
          const total = bd.total || 0, done = bd.done || 0;
          const top = Array.isArray(bd.top) ? bd.top : [];
          return {
            project: p, total, done,
            blocked: bd.blocked || 0, inProgress: bd.in_progress || 0,
            notStarted: bd.not_started || 0, overdue: bd.overdue || 0,
            donePct: total ? Math.round(done / total * 100) : 0,
            peopleCount: bd.people_count || 0,
            top: top[0]?.name || null,
            top2: top.map(x => ({ name: x.name, ap: Number(x.ap) || 0 })),
            activeSprint: bd.active_sprint || null,
            okrCount: bd.okr_count || 0,
            reportCount: reportRows.filter(r => r.project_id === bd.project_id).length,
          };
        });
      }
      if (cancelled) return;

      setBoards(byBoard);
      setReports(reportRows);
      setDistinctPeople(distinctPeopleCount);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authUser]);

  // Cierre con Escape (H-008). El Shell es un componente-en-render, así que el
  // manejo de teclado vive a nivel del diálogo.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPaid = capacity && capacity.tier !== "free" && capacity.status === "active";

  // Totales globales
  const g = boards.reduce((a, b) => ({
    tasks: a.tasks + b.total, done: a.done + b.done, blocked: a.blocked + b.blocked, overdue: a.overdue + b.overdue,
  }), { tasks: 0, done: 0, blocked: 0, overdue: 0 });
  const globalPct = g.tasks ? Math.round(g.done / g.tasks * 100) : 0;

  const health = (b) => {
    if (!b.total) return { c: "#7a8aa0", t: "Sin datos" };
    if (b.blocked / b.total > 0.2) return { c: "#e74c3c", t: "En riesgo" };
    if (b.donePct < 30) return { c: "#f5a623", t: "Arrancando" };
    return { c: "#27ae60", t: "Saludable" };
  };

  if (loading) return <DashboardShell onClose={onClose}><div style={{ color: "rgba(255,255,255,0.6)", textAlign: "center", padding: 80 }}>Cargando visión consolidada…</div></DashboardShell>;

  if (!isPaid) {
    return (
      <DashboardShell onClose={onClose}>
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#fff" }}>
          <div style={{ fontSize: 46, marginBottom: 14 }}>📊</div>
          <h2 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 10px" }}>Visión consolidada</h2>
          <p style={{ color: "rgba(255,255,255,0.6)", maxWidth: 460, margin: "0 auto 22px", lineHeight: 1.6 }}>
            Reúne el análisis de todos tus tableros en una sola pantalla: avance global, bloqueos, aportantes clave y los reportes de IA de cada equipo. Disponible en los planes de pago.
          </p>
          <button onClick={onClose} style={{ background: "linear-gradient(135deg, #ec6c04, #149cac)", color: "#fff", border: "none", borderRadius: 10, padding: "12px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Volver y ver planes (✨ en la barra superior)
          </button>
        </div>
      </DashboardShell>
    );
  }

  const card = { background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 16, padding: 18, color: "#fff" };
  const kpi = (label, value, accent) => (
    <div style={{ ...card, textAlign: "center", padding: "16px 12px" }}>
      <div style={{ fontSize: 30, fontWeight: 800, color: accent || "#fff", letterSpacing: -1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 }}>{label}</div>
    </div>
  );

  return (
    <DashboardShell onClose={onClose}>
      <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, letterSpacing: 4, textTransform: "uppercase", marginBottom: 10 }}>Plan {capacity.display_name} · Dueño</div>
      <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, margin: "0 0 4px", color: "#fff" }}>Visión consolidada</h2>
      <p style={{ color: "rgba(255,255,255,0.55)", margin: "0 0 22px", fontSize: 14 }}>El pulso de tus {boards.length} tableros en una sola pantalla.</p>

      {/* Tabs de sesión */}
      <div style={{ display: "inline-flex", gap: 0, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 4, marginBottom: 22 }}>
        {[["overview", "Resumen"], ["reports", `Reportes IA${reports.length ? ` (${reports.length})` : ""}`]].map(([id, label]) => (
          <button key={id} onClick={() => setSection(id)} style={{ background: section === id ? "rgba(20,156,172,0.9)" : "transparent", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontSize: 13, fontWeight: section === id ? 700 : 500, fontFamily: "inherit" }}>{label}</button>
        ))}
      </div>

      {section === "overview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 22 }}>
            {kpi("Tableros", boards.length, "#4dd8e8")}
            {kpi("Tareas", g.tasks)}
            {kpi("Avance global", `${globalPct}%`, "#27ae60")}
            {kpi("Bloqueadas", g.blocked, g.blocked ? "#e74c3c" : "#fff")}
            {kpi("Vencidas", g.overdue, g.overdue ? "#f5a623" : "#fff")}
            {kpi("Personas", distinctPeople, "#bb8fff")}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {boards.map(b => {
              const h = health(b);
              const segs = [["#27ae60", b.done], ["#3a86d6", b.inProgress], ["#e74c3c", b.blocked], ["#7a8aa0", b.notStarted]];
              const chip = (txt, c, bg) => <span style={{ background: bg, color: c, borderRadius: 999, padding: "3px 9px", fontSize: 10, fontWeight: 700 }}>{txt}</span>;
              return (
                <div key={b.project.id} style={{ ...card, cursor: "pointer", transition: "transform .15s, border-color .15s", display: "flex", flexDirection: "column", gap: 0 }}
                  onClick={() => onOpenProject?.(b.project)}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.borderColor = "rgba(20,156,172,0.5)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}>
                  {/* Encabezado */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{b.project.name}</div>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, color: h.c, whiteSpace: "nowrap" }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: h.c }} />{h.t}
                    </span>
                  </div>
                  {/* Barra de estados */}
                  <div style={{ display: "flex", height: 8, borderRadius: 5, overflow: "hidden", background: "rgba(255,255,255,0.07)" }}>
                    {b.total > 0 ? segs.map(([c, n], i) => n > 0 && <div key={i} title={`${n}`} style={{ width: `${n / b.total * 100}%`, background: c }} />)
                      : <div style={{ width: "100%" }} />}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 7 }}>
                    <span><b style={{ color: "#fff", fontSize: 14 }}>{b.donePct}%</b> completado</span>
                    <span>{b.done}/{b.total} tareas</span>
                  </div>
                  {/* Chips de atención */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11 }}>
                    {chip(`${b.inProgress} en proceso`, "#9cc8f0", "rgba(58,134,214,0.16)")}
                    {b.blocked > 0 && chip(`${b.blocked} bloqueadas`, "#f5a3a3", "rgba(231,76,60,0.16)")}
                    {b.overdue > 0 && chip(`${b.overdue} vencidas`, "#f5c97a", "rgba(245,166,35,0.16)")}
                  </div>
                  {/* Meta del tablero */}
                  <div style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "12px 0" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5, color: "rgba(255,255,255,0.62)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span>🏃</span><span>{b.activeSprint ? <b style={{ color: "#fff", fontWeight: 600 }}>{b.activeSprint}</b> : "Sin sprint activo"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>🎯 {b.okrCount} OKR{b.okrCount === 1 ? "" : "s"} activo{b.okrCount === 1 ? "" : "s"}</span>
                      <span>👥 {b.peopleCount} personas</span>
                      <span>📄 {b.reportCount} reporte{b.reportCount === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  {/* Top aportantes */}
                  {b.top2.length > 0 && (
                    <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 5 }}>
                      {b.top2.map((c, i) => (
                        <div key={c.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11.5 }}>
                          <span style={{ color: "rgba(255,255,255,0.82)" }}>{["🥇", "🥈"][i]} {c.name}</span>
                          <span style={{ color: "#7ee2a8", fontWeight: 700 }}>{Math.round(c.ap)} pts</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {section === "reports" && (
        <div>
          {reports.length === 0 ? (
            <div style={{ ...card, textAlign: "center", padding: 40, color: "rgba(255,255,255,0.55)" }}>
              Aún no hay reportes de IA archivados. Se generan automáticamente según la cadencia configurada en cada tablero y aparecerán aquí.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {boards.filter(b => reports.some(r => r.project_id === b.project.id)).map(b => (
                <div key={b.project.id} style={card}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#4dd8e8" }}>{b.project.name}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {reports.filter(r => r.project_id === b.project.id).map(r => (
                      <button key={r.id} onClick={() => setOpenReport(r)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "10px 12px", cursor: "pointer", textAlign: "left", color: "#fff", fontFamily: "inherit" }}>
                        <span style={{ fontSize: 12.5 }}>
                          <b>{REPORT_TYPE_LABEL[r.report_type] || r.report_type}</b>
                          <span style={{ color: "rgba(255,255,255,0.45)" }}> · {r.period_start} a {r.period_end}</span>
                        </span>
                        <span style={{ fontSize: 11, color: "#4dd8e8", whiteSpace: "nowrap" }}>Ver →</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {openReport && (
        <div onClick={() => setOpenReport(null)} style={{ position: "fixed", inset: 0, zIndex: 100003, background: "rgba(5,5,14,0.8)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#14141f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, maxWidth: 760, width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 26, color: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{REPORT_TYPE_LABEL[openReport.report_type] || openReport.report_type}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{openReport.period_start} a {openReport.period_end}</div>
              </div>
              <button onClick={() => setOpenReport(null)} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>Cerrar</button>
            </div>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.85)", margin: 0 }}>{openReport.plain_text || "(Sin texto archivado)"}</pre>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
