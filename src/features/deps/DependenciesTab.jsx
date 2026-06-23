import { useState, useMemo } from "react";
import { parseDeps } from "../../lib/deps";
import { computeDepLayout, NODE_W, NODE_H, NODE_GAP_X, NODE_GAP_Y } from "../../lib/depGraph";
import { STATUS_COLORS, STATUS_LIGHT } from "../../constants";

// Red de dependencias de tareas (grafo SVG por niveles). Extraído del monolito
// (H-002) y cargado con React.lazy. El layout (computeDepLayout + NODE_*) vive en
// lib/depGraph, compartido con la Presentación.
export default function DependenciesTab({ tasks, onEditTask, sprints = [] }) {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");
  const [sprintFilter, setSprintFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userFilter, setUserFilter] = useState("all");

  const allUsers = useMemo(() => {
    const u = new Set(tasks.map(t => t.responsible).filter(Boolean));
    return [...u].sort();
  }, [tasks]);

  // Step 1: sprint + date filter
  const sprintTasks = useMemo(() => {
    let base = tasks;
    if (sprintFilter !== "all") base = base.filter(t => String(t.sprintId) === String(sprintFilter));
    if (dateFrom || dateTo) {
      base = base.filter(t => {
        const sd = t.startDate || t.endDate || "";
        if (!sd) return false;
        if (dateFrom && sd < dateFrom) return false;
        if (dateTo && sd > dateTo) return false;
        return true;
      });
    }
    return base;
  }, [tasks, sprintFilter, dateFrom, dateTo]);

  // Step 2: user filter → focal tasks
  const focalTasks = useMemo(() => {
    if (userFilter === "all") return sprintTasks;
    return sprintTasks.filter(t => t.responsible === userFilter);
  }, [sprintTasks, userFilter]);

  const isSprintFiltered = sprintFilter !== "all" || dateFrom || dateTo;
  const isUserFiltered = userFilter !== "all";

  // Step 3: linked toggle applied to focal tasks
  const visibleBase = useMemo(() => {
    if (filter !== "linked") return focalTasks;
    return focalTasks.filter(t =>
      parseDeps(t.dependentTask).length > 0 ||
      tasks.some(x => parseDeps(x.dependentTask).includes(String(t.id)))
    );
  }, [focalTasks, filter, tasks]);

  // Cross-user tasks: deps of visibleBase assigned to a different user (only when user filter active)
  const crossUserTaskSet = useMemo(() => {
    if (!isUserFiltered) return new Set();
    const cross = new Set();
    visibleBase.forEach(t => {
      parseDeps(t.dependentTask).forEach(depId => {
        const dep = tasks.find(x => String(x.id) === depId);
        if (dep && dep.responsible !== userFilter && !visibleBase.find(v => v.id === dep.id)) {
          cross.add(dep.id);
        }
      });
    });
    return cross;
  }, [tasks, visibleBase, isUserFiltered, userFilter]);

  const crossUserTasks = useMemo(() =>
    [...crossUserTaskSet].map(id => tasks.find(t => t.id === id)).filter(Boolean),
    [tasks, crossUserTaskSet]);

  // Ghost tasks: sprint-external deps not already handled by crossUser
  const ghostTaskSet = useMemo(() => {
    if (!isSprintFiltered) return new Set();
    const ghosts = new Set();
    visibleBase.forEach(t => {
      parseDeps(t.dependentTask).forEach(depId => {
        const dep = tasks.find(x => String(x.id) === depId);
        if (dep && !visibleBase.find(v => v.id === dep.id) && !crossUserTaskSet.has(dep.id)) {
          ghosts.add(dep.id);
        }
      });
    });
    return ghosts;
  }, [tasks, visibleBase, isSprintFiltered, crossUserTaskSet]);

  const ghostTasks = useMemo(() =>
    [...ghostTaskSet].map(id => tasks.find(t => t.id === id)).filter(Boolean),
    [tasks, ghostTaskSet]);

  const allVisible = useMemo(() => {
    const combined = [...visibleBase];
    [...crossUserTasks, ...ghostTasks].forEach(t => {
      if (!combined.find(v => v.id === t.id)) combined.push(t);
    });
    return combined;
  }, [visibleBase, crossUserTasks, ghostTasks]);

  const { positions, svgW, svgH, byLevel } = useMemo(() => computeDepLayout(allVisible), [allVisible]);
  // One edge entry per {task, depId} pair
  const edges = useMemo(() => {
    const result = [];
    visibleBase.forEach(t => {
      parseDeps(t.dependentTask).forEach(depId => {
        if (positions[depId]) result.push({ t, depId });
      });
    });
    return result;
  }, [visibleBase, positions]);
  const sel = selected ? tasks.find(t => String(t.id) === String(selected)) : null;

  const inpStyle = { background: "#f4f4f4", border: "1.5px solid #e0e0e0", borderRadius: 8, padding: "5px 10px", fontSize: 12, color: "#444", outline: "none", fontFamily: "inherit", cursor: "pointer" };

  // First name + last initial: "Ana Martinez" → "Ana M."
  const shortName = (name) => {
    if (!name) return "";
    const parts = name.trim().split(" ");
    return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[1][0]}.`;
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#542c9c" }}>Red de Dependencias</div>

        {/* Sprint filter */}
        {sprints.length > 0 && (
          <select value={sprintFilter} onChange={e => { setSprintFilter(e.target.value); setSelected(null); }} style={inpStyle}>
            <option value="all">Todos los sprints</option>
            {sprints.map(s => (
              <option key={s.id} value={String(s.id)}>{s.name} {s.status === 'active' ? '▶' : s.status === 'closed' ? '✓' : '○'}</option>
            ))}
          </select>
        )}

        {/* Date range filter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#999", whiteSpace: "nowrap" }}>Inicio desde</span>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setSelected(null); }} style={inpStyle} />
          <span style={{ fontSize: 11, color: "#999" }}>hasta</span>
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setSelected(null); }} style={inpStyle} />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(""); setDateTo(""); }} style={{ background: "#f4f4f4", border: "1.5px solid #e0e0e0", borderRadius: 8, padding: "5px 10px", fontSize: 11, color: "#666", cursor: "pointer" }}>Limpiar</button>
          )}
        </div>

        {/* User filter */}
        {allUsers.length > 0 && (
          <select value={userFilter} onChange={e => { setUserFilter(e.target.value); setSelected(null); }}
            style={{ ...inpStyle, borderColor: isUserFiltered ? "#149cac" : "#e0e0e0", color: isUserFiltered ? "#149cac" : "#444", fontWeight: isUserFiltered ? 700 : 400 }}>
            <option value="all">Todos los responsables</option>
            {allUsers.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        )}

        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[["all","Todas"],["linked","Solo enlazadas"]].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v)}
              style={{ background: filter === v ? "linear-gradient(135deg,#542c9c,#6e3ebf)" : "#f4f4f4", color: filter === v ? "#fff" : "#666", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: filter === v ? 700 : 400 }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Status legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        {Object.entries(STATUS_COLORS).map(([st, c]) => (
          <div key={st} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#666" }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{st}
          </div>
        ))}
      </div>

      {/* External nodes legend */}
      {(ghostTasks.length > 0 || crossUserTasks.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 14, fontSize: 11, color: "#999" }}>
          {ghostTasks.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: "#e8e8e8", border: "1.5px dashed #bbb" }} />
              Dependencias de otros sprints
            </div>
          )}
          {crossUserTasks.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 14, height: 14, borderRadius: 3, background: "#fff0e0", border: "1.5px dashed rgba(236,108,4,0.6)" }} />
              Dependencias de otro responsable
            </div>
          )}
        </div>
      )}

      {edges.length === 0 && filter === "linked" && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#969696", fontSize: 14 }}>
          No hay tareas con dependencias registradas.<br />
          <span style={{ fontSize: 12 }}>Usa el campo "Tarea dependiente" al crear o editar una tarea.</span>
        </div>
      )}

      {/* SVG Graph */}
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "60vh", border: "1px solid #e8e0f4", borderRadius: 14, background: "#fafafe" }}>
        <svg width={svgW} height={svgH} style={{ display: "block" }}>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#542c9c" opacity="0.6" />
            </marker>
            <marker id="arrow-ghost" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#bbb" opacity="0.7" />
            </marker>
            <marker id="arrow-cross" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill="#ec6c04" opacity="0.7" />
            </marker>
          </defs>

          {/* Column headers */}
          {Object.keys(byLevel).map(lvl => (
            <text key={lvl}
              x={Number(lvl) * (NODE_W + NODE_GAP_X) + 24 + NODE_W / 2} y={12}
              textAnchor="middle"
              style={{ fontSize: 10, fill: "#aaa", fontFamily: "inherit", letterSpacing: 2 }}>
              {Number(lvl) === 0 ? "Nivel 0 · Origen" : `Nivel ${lvl}`}
            </text>
          ))}

          {/* Edges — one per dep pair */}
          {edges.map(({ t, depId }) => {
            const src = positions[depId];
            const dst = positions[String(t.id)];
            if (!src || !dst) return null;
            const depIdNum = Number(depId);
            const isCross = crossUserTaskSet.has(depIdNum) || crossUserTaskSet.has(depId);
            const isGhost = !isCross && (ghostTaskSet.has(depIdNum) || ghostTaskSet.has(depId));
            const x1 = src.x + NODE_W, y1 = src.y + NODE_H / 2;
            const x2 = dst.x,          y2 = dst.y + NODE_H / 2;
            const cx = (x1 + x2) / 2;
            return (
              <path key={`e-${t.id}-${depId}`}
                d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
                fill="none"
                stroke={isCross ? "#ec6c04" : isGhost ? "#bbb" : "#542c9c"}
                strokeWidth={isCross || isGhost ? 1 : 1.5}
                strokeOpacity={isCross || isGhost ? 0.6 : 0.4}
                strokeDasharray={isCross || isGhost ? "5,4" : "none"}
                markerEnd={isCross ? "url(#arrow-cross)" : isGhost ? "url(#arrow-ghost)" : "url(#arrow)"} />
            );
          })}

          {/* Regular Nodes */}
          {visibleBase.map(t => {
            const pos = positions[String(t.id)];
            if (!pos) return null;
            const sc = STATUS_COLORS[t.status] || "#888";
            const sl = STATUS_LIGHT[t.status] || "#f4f4f4";
            const isSel = String(selected) === String(t.id);
            const name = shortName(t.responsible);
            return (
              <g key={t.id} style={{ cursor: "pointer" }} onClick={() => setSelected(isSel ? null : String(t.id))}>
                <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={8}
                  fill={sl} stroke={isSel ? sc : "rgba(84,44,156,0.15)"}
                  strokeWidth={isSel ? 2.5 : 1}
                  style={{ filter: isSel ? `drop-shadow(0 4px 12px ${sc}66)` : "none", transition: "all 0.2s" }} />
                <rect x={pos.x} y={pos.y} width={4} height={NODE_H} rx="2 0 0 2" fill={sc} />
                {/* type row */}
                <text x={pos.x + 14} y={pos.y + 14} style={{ fontSize: 9, fill: "#aaa", fontFamily: "inherit" }}>
                  #{t.id} · {t.type}
                </text>
                {/* title */}
                <foreignObject x={pos.x + 14} y={pos.y + 18} width={NODE_W - 20} height={32}>
                  <div xmlns="http://www.w3.org/1999/xhtml"
                    style={{ fontSize: 11, fontWeight: 700, color: "#2d2d2d", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {t.title || "(Sin título)"}
                  </div>
                </foreignObject>
                {/* status + responsible */}
                <text x={pos.x + 14} y={pos.y + 62} style={{ fontSize: 10, fill: sc, fontWeight: 700, fontFamily: "inherit" }}>
                  {t.status}
                </text>
                {name && (
                  <text x={pos.x + NODE_W - 8} y={pos.y + 62} textAnchor="end"
                    style={{ fontSize: 10, fill: "#149cac", fontWeight: 600, fontFamily: "inherit" }}>
                    {name}
                  </text>
                )}
              </g>
            );
          })}

          {/* Cross-user Nodes (orange dashed — different responsible) */}
          {crossUserTasks.map(t => {
            const pos = positions[String(t.id)];
            if (!pos) return null;
            const name = shortName(t.responsible);
            return (
              <g key={`cross-${t.id}`} style={{ cursor: "default", opacity: 0.88 }}>
                <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={8}
                  fill="#fff8ed" stroke="rgba(236,108,4,0.55)" strokeWidth={1.5} strokeDasharray="5,3" />
                <rect x={pos.x} y={pos.y} width={4} height={NODE_H} rx="2 0 0 2" fill="#ec6c04" />
                <text x={pos.x + 14} y={pos.y + 14} style={{ fontSize: 9, fill: "#c8855a", fontFamily: "inherit" }}>
                  #{t.id} · {t.type}
                </text>
                <foreignObject x={pos.x + 14} y={pos.y + 18} width={NODE_W - 20} height={32}>
                  <div xmlns="http://www.w3.org/1999/xhtml"
                    style={{ fontSize: 11, fontWeight: 600, color: "#a0600a", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {t.title || "(Sin título)"}
                  </div>
                </foreignObject>
                <text x={pos.x + 14} y={pos.y + 62} style={{ fontSize: 10, fill: "#ec6c04", fontWeight: 700, fontFamily: "inherit" }}>
                  {t.status}
                </text>
                {name && (
                  <text x={pos.x + NODE_W - 8} y={pos.y + 62} textAnchor="end"
                    style={{ fontSize: 10, fill: "#ec6c04", fontWeight: 700, fontFamily: "inherit" }}>
                    {name}
                  </text>
                )}
              </g>
            );
          })}

          {/* Ghost Nodes (grey dashed — other sprint/date) */}
          {ghostTasks.map(t => {
            const pos = positions[String(t.id)];
            if (!pos) return null;
            const sprintOfTask = sprints.find(s => String(s.id) === String(t.sprintId));
            const sprintLabel = sprintOfTask ? sprintOfTask.name : 'Sin sprint';
            const name = shortName(t.responsible);
            return (
              <g key={`ghost-${t.id}`} style={{ cursor: "default", opacity: 0.7 }}>
                <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={8}
                  fill="#f0f0f0" stroke="#c0c0c0" strokeWidth={1} strokeDasharray="5,3" />
                <rect x={pos.x} y={pos.y} width={4} height={NODE_H} rx="2 0 0 2" fill="#bbb" />
                <text x={pos.x + 14} y={pos.y + 14} style={{ fontSize: 9, fill: "#bbb", fontFamily: "inherit" }}>
                  #{t.id} · {sprintLabel}
                </text>
                <foreignObject x={pos.x + 14} y={pos.y + 18} width={NODE_W - 20} height={32}>
                  <div xmlns="http://www.w3.org/1999/xhtml"
                    style={{ fontSize: 11, fontWeight: 600, color: "#999", lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {t.title || "(Sin título)"}
                  </div>
                </foreignObject>
                <text x={pos.x + 14} y={pos.y + 62} style={{ fontSize: 9, fill: "#bbb", fontFamily: "inherit" }}>
                  {t.startDate || ""}
                </text>
                {name && (
                  <text x={pos.x + NODE_W - 8} y={pos.y + 62} textAnchor="end"
                    style={{ fontSize: 10, fill: "#bbb", fontFamily: "inherit" }}>
                    {name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Selected task detail */}
      {sel && !ghostTaskSet.has(sel.id) && !crossUserTaskSet.has(sel.id) && (
        <div style={{ marginTop: 16, background: "#ffffff", borderRadius: 14, padding: "18px 20px", border: `2px solid ${STATUS_COLORS[sel.status] || "#e0e0e0"}`, boxShadow: "0 4px 20px rgba(84,44,156,0.1)", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, color: "#969696" }}>#{sel.id} · {sel.type}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#2d2d2d", marginTop: 2, marginBottom: 8 }}>{sel.title}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 20, background: STATUS_LIGHT[sel.status], color: STATUS_COLORS[sel.status], fontWeight: 700 }}>{sel.status}</span>
              {sel.responsible && <span style={{ fontSize: 11, color: "#149cac", fontWeight: 600 }}>@ {sel.responsible}</span>}
              {sel.progressPercent > 0 && <span style={{ fontSize: 11, color: "#ec6c04", fontWeight: 600 }}>{Number(sel.progressPercent).toFixed(0)}% avance</span>}
            </div>
            {parseDeps(sel.dependentTask).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#542c9c" }}>
                Depende de: {parseDeps(sel.dependentTask).map(id => <strong key={id}> #{id}</strong>)}
              </div>
            )}
            {tasks.filter(x => parseDeps(x.dependentTask).includes(String(sel.id))).length > 0 && (
              <div style={{ marginTop: 4, fontSize: 12, color: "#ec6c04" }}>
                Desbloquea: {tasks.filter(x => parseDeps(x.dependentTask).includes(String(sel.id))).map(x => `#${x.id}`).join(", ")}
              </div>
            )}
          </div>
          <button onClick={() => { onEditTask(sel); setSelected(null); }}
            style={{ background: "linear-gradient(135deg,#ec6c04,#f07d1e)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontWeight: 700, fontSize: 13, alignSelf: "center" }}>
            Editar tarea →
          </button>
        </div>
      )}
    </div>
  );
}
