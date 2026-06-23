import { useState, useMemo } from "react";
import { STATUS_COLORS, STATUS_LIGHT, ESTADOS, DEFAULT_TASK_TYPES } from "../../constants";
import { getUserColor, getInitials } from "../../lib/format";

// Tab de Métricas (estados, tipos, indicadores, tiempos, cumplimiento, carga por
// persona). Extraído del monolito (H-002), cargado con React.lazy.
// TYPE_COLORS y daysBetween son exclusivos de esta vista.
const TYPE_COLORS = {
  Administrativa: "#185FA5",
  Operativa: "#BA7517",
  Apadrinamiento: "#993556",
  Seguimiento: "#534AB7",
  Creativa: "#3B6D11",
  Otra: "#5F5E5A",
};

const daysBetween = (a, b) => {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
};

function MetricsSection({ title, children }) {
  return (
    <div style={{ background: "#ffffff", border: "none", borderRadius: 14, padding: 18, marginBottom: 12, boxShadow: "0 2px 14px rgba(84,44,156,0.07)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#542c9c", marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function MetricCard({ label, value, color = "var(--color-text-primary)" }) {
  return (
    <div style={{ background: "#ffffff", borderRadius: 10, padding: "14px 16px", boxShadow: "0 2px 10px rgba(84,44,156,0.08)" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color }}>{value}</div>
    </div>
  );
}

function MetricRow({ label, value, color, light }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "7px 10px", borderRadius: 6, borderLeft: `3px solid ${color}`,
      background: light, marginBottom: 5,
    }}>
      <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, color }}>{value}</span>
    </div>
  );
}

export default function MetricsTab({ tasks, participants, taskTypes }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selParticipant, setSelParticipant] = useState("");

  const filtered = useMemo(() => tasks.filter((t) => {
    if (selParticipant && t.responsible !== selParticipant) return false;
    if (dateFrom && t.startDate && t.startDate < dateFrom) return false;
    if (dateTo && t.endDate && t.endDate > dateTo) return false;
    return true;
  }), [tasks, selParticipant, dateFrom, dateTo]);

  const metrics = useMemo(() => {
    const byStatus = {};
    ESTADOS.forEach((s) => (byStatus[s] = 0));
    filtered.forEach((t) => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });

    const activeTypes = taskTypes.length ? taskTypes.map((t) => t.name) : DEFAULT_TASK_TYPES;
    const byType = {};
    activeTypes.forEach((tp) => (byType[tp] = 0));
    filtered.forEach((t) => { byType[t.type] = (byType[t.type] || 0) + 1; });

    const byIndicator = {};
    const ptsByIndicator = {};
    let totalPts = 0;
    filtered.forEach((t) => {
      const pts = parseFloat(t.aporteSnapshot) || 0;
      totalPts += pts;
      if (t.indicator) {
        byIndicator[t.indicator] = (byIndicator[t.indicator] || 0) + 1;
        ptsByIndicator[t.indicator] = (ptsByIndicator[t.indicator] || 0) + pts;
      }
    });

    const timeByType = {};
    activeTypes.forEach((tp) => (timeByType[tp] = []));
    filtered.filter((t) => t.status === "Finalizada" && t.startDate && t.endDate).forEach((t) => {
      if (!timeByType[t.type]) timeByType[t.type] = [];
      timeByType[t.type].push(daysBetween(t.startDate, t.endDate));
    });
    const avgTimeByType = {};
    Object.entries(timeByType).forEach(([tp, arr]) => {
      avgTimeByType[tp] = arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : null;
    });

    const eligible = filtered.filter((t) => t.status !== "Cancelada" && t.status !== "No programada");
    const finalizadas = filtered.filter((t) => t.status === "Finalizada");
    const completionPct = eligible.length > 0 ? +((finalizadas.length / eligible.length) * 100).toFixed(2) : 0;

    return { byStatus, byType, byIndicator, ptsByIndicator, totalPts, avgTimeByType, completionPct, finalizadas: finalizadas.length, eligible: eligible.length };
  }, [filtered, taskTypes]);

  const ss = { background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-secondary)", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: "pointer", outline: "none", fontFamily: "inherit" };
  const si = { ...ss, color: "var(--color-text-primary)" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
        <select style={ss} value={selParticipant} onChange={(e) => setSelParticipant(e.target.value)}>
          <option value="">Todos los participantes</option>
          {participants.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
        <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Desde</label>
        <input type="date" style={si} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Hasta</label>
        <input type="date" style={si} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--color-text-secondary)", padding: "40px 0", fontSize: 13 }}>
          No hay tareas para mostrar con los filtros seleccionados.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
            <MetricCard label="Total tareas" value={filtered.length} />
            <MetricCard label="Finalizadas" value={metrics.finalizadas} color="#3B6D11" />
            <MetricCard label="Valor de Aporte total" value={Number(metrics.totalPts).toFixed(2)} color="#BA7517" />
          </div>

          <MetricsSection title="Tareas por estado">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
              {ESTADOS.map((s) => metrics.byStatus[s] > 0 && (
                <MetricRow key={s} label={s} value={metrics.byStatus[s]} color={STATUS_COLORS[s]} light={STATUS_LIGHT[s]} />
              ))}
            </div>
          </MetricsSection>

          <MetricsSection title="Tareas por tipo">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
              {(taskTypes.length ? taskTypes.map((t) => t.name) : DEFAULT_TASK_TYPES).map((tp) => metrics.byType[tp] > 0 && (
                <MetricRow key={tp} label={tp} value={metrics.byType[tp]} color={TYPE_COLORS[tp]} light="var(--color-background-secondary)" />
              ))}
            </div>
          </MetricsSection>

          {Object.keys(metrics.byIndicator).length > 0 && (
            <MetricsSection title="Tareas e indicadores clave">
              {Object.entries(metrics.byIndicator).map(([ind, cnt]) => (
                <div key={ind} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", background: "var(--color-background-secondary)", borderRadius: 6, marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{ind}</span>
                  <div style={{ display: "flex", gap: 20 }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{cnt} tareas</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "#BA7517" }}>{Number(metrics.ptsByIndicator[ind] || 0).toFixed(2)} aporte</span>
                  </div>
                </div>
              ))}
            </MetricsSection>
          )}

          <MetricsSection title="Tiempo promedio de resolución (días · solo tareas Finalizadas)">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6 }}>
              {(taskTypes.length ? taskTypes.map((t) => t.name) : DEFAULT_TASK_TYPES).map((tp) => metrics.avgTimeByType[tp] !== null && (
                <div key={tp} style={{ padding: "8px 10px", background: "var(--color-background-secondary)", borderRadius: 6, borderLeft: `3px solid ${TYPE_COLORS[tp]}` }}>
                  <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{tp}</div>
                  <div style={{ fontSize: 18, fontWeight: 500, color: "var(--color-text-primary)" }}>{Number(metrics.avgTimeByType[tp]).toFixed(2)} días</div>
                </div>
              ))}
            </div>
          </MetricsSection>

          <div style={{
            background: "linear-gradient(135deg, #149cac 0%, #0d7a87 100%)",
            border: "none",
            borderRadius: 14, padding: "22px 24px", textAlign: "center",
            boxShadow: "0 6px 24px rgba(20,156,172,0.3)",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: "rgba(255,255,255,0.85)", marginBottom: 8 }}>
              Porcentaje de cumplimiento
            </div>
            <div style={{ fontSize: 60, fontWeight: 800, color: "#ffffff", lineHeight: 1, marginBottom: 6 }}>
              {metrics.completionPct}%
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", marginBottom: 14 }}>
              {metrics.finalizadas} finalizadas de {metrics.eligible} elegibles
              &nbsp;·&nbsp;Excluye canceladas y no programadas
            </div>
            <div style={{ height: 10, background: "rgba(255,255,255,0.2)", borderRadius: 5 }}>
              <div style={{
                height: "100%", width: `${metrics.completionPct}%`,
                background: "#ffffff", borderRadius: 5,
                transition: "width 0.5s ease",
                maxWidth: "100%",
              }} />
            </div>
          </div>

          {participants.length > 0 && (
            <MetricsSection title="Carga de trabajo por persona">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {participants.map(p => {
                  const today = new Date().toISOString().split('T')[0];
                  const myTasks = tasks.filter(t => t.responsible === p.name && !['Finalizada', 'Cancelada'].includes(t.status));
                  const overdue = myTasks.filter(t => t.endDate && t.endDate < today).length;
                  const blocked = myTasks.filter(t => t.status === 'Bloqueada').length;
                  const load = myTasks.length;
                  const loadColor = load === 0 ? '#27ae60' : load <= 4 ? '#ec6c04' : '#c0392b';
                  const color = getUserColor(p.name);
                  return (
                    <div key={p.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', background: '#fafafa', borderRadius: 8, border: '1px solid #f0e8ff' }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: `linear-gradient(135deg, ${color}, ${color}cc)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', flexShrink: 0 }}>{getInitials(p.name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2d2d', marginBottom: 4 }}>{p.name}</div>
                        <div style={{ height: 5, background: '#f0e8ff', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, load * 12)}%`, background: loadColor, borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, fontSize: 11, flexShrink: 0 }}>
                        <span style={{ background: '#ede8f8', color: '#542c9c', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{load} activas</span>
                        {overdue > 0 && <span style={{ background: '#fde8e8', color: '#c0392b', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{overdue} vencidas</span>}
                        {blocked > 0 && <span style={{ background: '#fff3ea', color: '#ec6c04', padding: '2px 8px', borderRadius: 12, fontWeight: 700 }}>{blocked} bloq.</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </MetricsSection>
          )}
        </>
      )}
    </div>
  );
}
