import { useState, useMemo } from "react";
import { computeDepLayout, NODE_W, NODE_H, NODE_GAP_X } from "../../lib/depGraph";
import { parseDeps } from "../../lib/deps";
import { STATUS_COLORS, STATUS_LIGHT } from "../../constants";
import { PresentationCard } from "./PresentationCard";

// Vista de Presentación: grafo de dependencias o cuadrícula, enfocada por persona.
// Extraída del monolito (H-002), cargada con React.lazy. PresentationGraph usa la
// paleta global (constants); PresentationTab define su propia paleta local que pasa
// a PresentationCard como colorByStatus (comportamiento original conservado).
export default function PresentationTab({ tasks, participants, taskFieldDefs, sprints }) {
  const [mode, setMode] = useState("graph"); // "graph" | "grid"
  const [selectedPersona, setSelectedPersona] = useState("__all__");
  const [selectedSprint, setSelectedSprint] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [hoverTaskId, setHoverTaskId] = useState(null);
  const [pinnedTaskId, setPinnedTaskId] = useState(null);
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  const personas = useMemo(() => {
    const fromTasks = new Set(tasks.map(t => t.responsible).filter(Boolean));
    const fromParticipants = participants.map(p => p.name);
    return [...new Set([...fromParticipants, ...fromTasks])].sort();
  }, [tasks, participants]);

  // Resolver nombre de sprint de una tarea: prioriza sprint_id contra la tabla,
  // luego custom_fields.sprint, luego null.
  const sprintNameOfTask = (t) => {
    if (t.sprint_id || t.sprintId) {
      const id = t.sprint_id || t.sprintId;
      const s = (sprints || []).find(s => String(s.id) === String(id));
      if (s?.name) return s.name;
    }
    const cf = t.custom_fields || t.customFields || {};
    if (cf.sprint) return String(cf.sprint);
    return null;
  };

  const visibleTasks = useMemo(() => {
    return tasks.filter(t => {
      if (selectedPersona !== "__all__" && t.responsible !== selectedPersona) return false;
      if (statusFilter !== "__all__" && t.status !== statusFilter) return false;
      if (selectedSprint !== "__all__") {
        if (sprintNameOfTask(t) !== selectedSprint) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, selectedPersona, statusFilter, selectedSprint, sprints]);

  // Sprints disponibles: tabla sprints + custom field sprint.
  const sprintOptions = useMemo(() => {
    const found = new Set();
    (sprints || []).forEach(s => { if (s.name) found.add(s.name); });
    tasks.forEach(t => {
      const cf = t.custom_fields || t.customFields || {};
      if (cf.sprint) found.add(String(cf.sprint));
    });
    return [...found].sort();
  }, [tasks, sprints]);

  const STATUS_COLORS = {
    "Sin iniciar": "#7f8c8d",
    "En proceso": "#0aa0ab",
    "Bloqueada": "#e74c3c",
    "En pausa": "#f39c12",
    "Cancelada": "#95a5a6",
    "Finalizada": "#27ae60",
    "No programada": "#95a5a6",
  };

  // Métricas resumen del participante seleccionado
  const personaStats = useMemo(() => {
    const tasksOf = selectedPersona === "__all__" ? visibleTasks : visibleTasks.filter(t => t.responsible === selectedPersona);
    const finalizadas = tasksOf.filter(t => t.status === "Finalizada").length;
    const bloqueadas = tasksOf.filter(t => t.status === "Bloqueada").length;
    const enProceso = tasksOf.filter(t => t.status === "En proceso").length;
    const aporteTotal = tasksOf.reduce((s, t) => s + (parseFloat(t.aporte_snapshot || t.aporteSnapshot) || 0), 0);
    const avgProgress = tasksOf.length ? Math.round(tasksOf.reduce((s,t) => s + (parseFloat(t.progress_percent || t.progressPercent) || 0), 0) / tasksOf.length) : 0;
    return { total: tasksOf.length, finalizadas, bloqueadas, enProceso, aporteTotal, avgProgress };
  }, [visibleTasks, selectedPersona]);

  return (
    <div style={{ padding: 20, fontFamily: "system-ui, sans-serif" }}>
      {/* Encabezado y filtros */}
      <div style={{ background: "linear-gradient(135deg, #0aa0ab 0%, #ef7218 100%)", borderRadius: 12, padding: 24, marginBottom: 20, color: "#fff" }}>
        <h2 style={{ margin: "0 0 8px 0", fontSize: 24, fontWeight: 700 }}>Presentación Sprint</h2>
        <p style={{ margin: 0, opacity: 0.9, fontSize: 14 }}>Vista enfocada por persona: pasa el cursor o haz clic en una tarjeta para ver su resumen.</p>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20, alignItems: "flex-end" }}>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Persona</label>
          <select value={selectedPersona} onChange={e => { setSelectedPersona(e.target.value); setSelectedTaskId(null); }} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, minWidth: 180 }}>
            <option value="__all__">Todas las personas</option>
            {personas.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Sprint</label>
          <select value={selectedSprint} onChange={e => setSelectedSprint(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, minWidth: 140 }}>
            <option value="__all__">Todos los sprints</option>
            {sprintOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Estado</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, minWidth: 140 }}>
            <option value="__all__">Todos los estados</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 4, background: "#eef0f5", borderRadius: 8, padding: 4 }}>
          {[["graph","Grafo"],["grid","Cuadrícula"]].map(([v,l]) => (
            <button key={v} onClick={() => setMode(v)}
              style={{ background: mode === v ? "#fff" : "transparent", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: mode === v ? 700 : 500, color: mode === v ? "#542c9c" : "#888", boxShadow: mode === v ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
              {l}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 13, color: "#666" }}>
          {visibleTasks.length} tarea{visibleTasks.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* Resumen de la persona */}
      {selectedPersona !== "__all__" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard label="Tareas" value={personaStats.total} color="#0aa0ab" />
          <StatCard label="Finalizadas" value={personaStats.finalizadas} color="#27ae60" />
          <StatCard label="En proceso" value={personaStats.enProceso} color="#ef7218" />
          <StatCard label="Bloqueadas" value={personaStats.bloqueadas} color="#e74c3c" />
          <StatCard label="Aporte total" value={personaStats.aporteTotal.toFixed(1)} color="#ef7218" />
          <StatCard label="Progreso prom." value={`${personaStats.avgProgress}%`} color="#0aa0ab" />
        </div>
      )}

      {/* Vista principal: grafo o cuadrícula */}
      {visibleTasks.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#999", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
          No hay tareas con esos filtros.
        </div>
      ) : mode === "graph" ? (
        <PresentationGraph
          tasks={tasks}
          visibleTasks={visibleTasks}
          focusedPersona={selectedPersona === "__all__" ? null : selectedPersona}
          onSelect={(id) => setSelectedTaskId(id)}
          selectedTaskId={selectedTaskId}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {visibleTasks.map(task => (
            <PresentationCard
              key={task.id}
              task={task}
              taskFieldDefs={taskFieldDefs}
              tasks={tasks}
              colorByStatus={STATUS_COLORS}
              isActive={hoverTaskId === task.id || pinnedTaskId === task.id}
              onHover={() => setHoverTaskId(task.id)}
              onLeave={() => setHoverTaskId(null)}
              onClick={() => setPinnedTaskId(p => p === task.id ? null : task.id)}
              pinned={pinnedTaskId === task.id}
              focusedPersona={selectedPersona === "__all__" ? null : selectedPersona}
            />
          ))}
        </div>
      )}

      {/* Panel lateral con detalle rico cuando se selecciona una tarea en el grafo */}
      {selectedTaskId && mode === "graph" && (() => {
        const t = tasks.find(x => String(x.id) === String(selectedTaskId));
        if (!t) return null;
        return (
          <div style={{ position: "fixed", top: 80, right: 20, width: 380, maxHeight: "85vh", overflowY: "auto", background: "#fff", border: "1px solid #ddd", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.15)", zIndex: 50 }}>
            <button onClick={() => setSelectedTaskId(null)} style={{ position: "absolute", top: 8, right: 8, background: "transparent", border: "none", fontSize: 22, color: "#999", cursor: "pointer", lineHeight: 1 }}>×</button>
            <div style={{ padding: 0 }}>
              <PresentationCard
                task={t}
                taskFieldDefs={taskFieldDefs}
                tasks={tasks}
                colorByStatus={STATUS_COLORS}
                isActive={true}
                onHover={() => {}}
                onLeave={() => {}}
                onClick={() => {}}
                pinned={true}
                focusedPersona={selectedPersona === "__all__" ? null : selectedPersona}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Renderiza las tareas como nodos SVG en niveles según sus dependencias. Las
// tareas del participante focal aparecen con color de estado; las ajenas en gris.
function PresentationGraph({ tasks, visibleTasks, focusedPersona, onSelect, selectedTaskId }) {
  const focalIds = useMemo(() => new Set(visibleTasks.map(t => String(t.id))), [visibleTasks]);

  const linkedNonFocal = useMemo(() => {
    const extra = new Set();
    visibleTasks.forEach(t => {
      parseDeps(t.dependent_task || t.dependentTask).forEach(id => {
        if (!focalIds.has(id)) extra.add(id);
      });
      tasks.forEach(other => {
        if (parseDeps(other.dependent_task || other.dependentTask).includes(String(t.id))) {
          if (!focalIds.has(String(other.id))) extra.add(String(other.id));
        }
      });
    });
    return [...extra].map(id => tasks.find(t => String(t.id) === id)).filter(Boolean);
  }, [tasks, visibleTasks, focalIds]);

  const allInGraph = useMemo(() => {
    const combined = [...visibleTasks];
    linkedNonFocal.forEach(t => { if (!combined.find(v => v.id === t.id)) combined.push(t); });
    // Normaliza camelCase a snake_case que computeDepLayout usa internamente.
    return combined.map(t => ({
      ...t,
      dependentTask: t.dependentTask ?? t.dependent_task ?? "",
    }));
  }, [visibleTasks, linkedNonFocal]);

  const { positions, svgW, svgH, byLevel } = useMemo(() => computeDepLayout(allInGraph), [allInGraph]);

  const edges = useMemo(() => {
    const result = [];
    allInGraph.forEach(t => {
      parseDeps(t.dependentTask).forEach(depId => {
        if (positions[depId]) result.push({ t, depId });
      });
    });
    return result;
  }, [allInGraph, positions]);

  const shortName = (name) => {
    if (!name) return "";
    const parts = name.trim().split(" ");
    return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0]}.`;
  };

  return (
    <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "70vh", border: "1px solid #e8e0f4", borderRadius: 14, background: "#fafafe" }}>
      <svg width={svgW} height={svgH} style={{ display: "block" }}>
        <defs>
          <marker id="pres-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#542c9c" opacity="0.6" />
          </marker>
          <marker id="pres-arrow-muted" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#bbb" opacity="0.65" />
          </marker>
        </defs>

        {/* Encabezados de nivel */}
        {Object.keys(byLevel).map(lvl => (
          <text key={lvl}
            x={Number(lvl) * (NODE_W + NODE_GAP_X) + 24 + NODE_W / 2} y={12}
            textAnchor="middle"
            style={{ fontSize: 10, fill: "#aaa", fontFamily: "inherit", letterSpacing: 2 }}>
            {Number(lvl) === 0 ? "Nivel 0 · Origen" : `Nivel ${lvl}`}
          </text>
        ))}

        {/* Aristas */}
        {edges.map(({ t, depId }) => {
          const src = positions[depId];
          const dst = positions[String(t.id)];
          if (!src || !dst) return null;
          const tFocal = !focusedPersona || focalIds.has(String(t.id));
          const depFocal = !focusedPersona || focalIds.has(depId);
          const isMuted = !!focusedPersona && !(tFocal && depFocal);
          const x1 = src.x + NODE_W, y1 = src.y + NODE_H / 2;
          const x2 = dst.x,          y2 = dst.y + NODE_H / 2;
          const cx = (x1 + x2) / 2;
          return (
            <path key={`pe-${t.id}-${depId}`}
              d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={isMuted ? "#cfcfcf" : "#542c9c"}
              strokeWidth={isMuted ? 1 : 1.5}
              strokeOpacity={isMuted ? 0.55 : 0.5}
              strokeDasharray={isMuted ? "5,4" : "none"}
              markerEnd={isMuted ? "url(#pres-arrow-muted)" : "url(#pres-arrow)"} />
          );
        })}

        {/* Nodos */}
        {allInGraph.map(t => {
          const pos = positions[String(t.id)];
          if (!pos) return null;
          const isFocal = !focusedPersona || focalIds.has(String(t.id));
          const sc = isFocal ? (STATUS_COLORS[t.status] || "#888") : "#b8b8b8";
          const sl = isFocal ? (STATUS_LIGHT[t.status] || "#f4f4f4") : "#f0f0f0";
          const isSel = String(selectedTaskId) === String(t.id);
          const name = shortName(t.responsible);
          return (
            <g key={t.id} style={{ cursor: "pointer" }} onClick={() => onSelect(isSel ? null : String(t.id))}>
              <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={8}
                fill={sl}
                stroke={isSel ? sc : isFocal ? "rgba(84,44,156,0.15)" : "#c8c8c8"}
                strokeWidth={isSel ? 2.5 : 1}
                strokeDasharray={isFocal ? "none" : "5,3"}
                style={{ filter: isSel ? `drop-shadow(0 4px 12px ${sc}66)` : "none", transition: "all 0.2s", opacity: isFocal ? 1 : 0.78 }} />
              <rect x={pos.x} y={pos.y} width={4} height={NODE_H} rx="2 0 0 2" fill={sc} />
              <text x={pos.x + 14} y={pos.y + 14} style={{ fontSize: 9, fill: isFocal ? "#aaa" : "#bbb", fontFamily: "inherit" }}>
                #{t.id} · {t.type || "—"}
              </text>
              <foreignObject x={pos.x + 14} y={pos.y + 18} width={NODE_W - 20} height={32}>
                <div xmlns="http://www.w3.org/1999/xhtml"
                  style={{ fontSize: 11, fontWeight: isFocal ? 700 : 600, color: isFocal ? "#2d2d2d" : "#888", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                  {t.title || "(Sin título)"}
                </div>
              </foreignObject>
              <text x={pos.x + 14} y={pos.y + 62} style={{ fontSize: 10, fill: sc, fontWeight: 700, fontFamily: "inherit" }}>
                {t.status || ""}
              </text>
              {name && (
                <text x={pos.x + NODE_W - 8} y={pos.y + 62} textAnchor="end"
                  style={{ fontSize: 10, fill: isFocal ? "#149cac" : "#aaa", fontWeight: 600, fontFamily: "inherit" }}>
                  {name}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ padding: 16, background: "#fafafa", borderTop: `3px solid ${color}`, borderRadius: 8, textAlign: "center" }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>{label}</div>
    </div>
  );
}
