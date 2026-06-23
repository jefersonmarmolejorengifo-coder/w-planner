import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { supabase } from "../../supabaseClient";
import { STATUS_COLORS } from "../../constants";
import { PresentationCard } from "../presentation/PresentationCard";

// Super-tareas: objetivos grandes (jarrón que se llena con el aporte de tareas
// vinculadas, agrupadas por sprint). Extraído del monolito (H-002), cargado con
// React.lazy. Reutiliza PresentationCard (módulo hoja) y SuperTaskCreatorModal (lazy).
const SuperTaskCreatorModal = lazy(() => import("./SuperTaskCreatorModal"));

function SuperTaskJar({ superTask, percent, sprintContributions = [], compact = false, onClick }) {
  const w = compact ? 110 : 160;
  const h = compact ? 140 : 200;
  const pct = Math.max(0, Math.min(100, percent));
  // Nivel del líquido: 100% = altura completa interior. Reserva 18px top y 14px bottom.
  const interiorH = h - 60;
  const fillH = (pct / 100) * interiorH;
  const liquidTop = 40 + (interiorH - fillH);
  const cx = w / 2;
  const innerW = w - 24;

  // Color del líquido derivado del color principal
  const color = superTask.color || "#542c9c";

  return (
    <div
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        cursor: onClick ? "pointer" : "default",
        padding: 8,
        borderRadius: 12,
        background: "#fff",
        border: `1px solid ${color}22`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        transition: "transform 200ms, box-shadow 200ms",
        position: "relative",
        width: w + 16,
      }}
      onMouseEnter={(e) => { if (onClick) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 6px 18px ${color}33`; } }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.05)"; }}
    >
      {/* Ícono emoji arriba */}
      <div style={{ fontSize: compact ? 18 : 22 }}>{superTask.icon || "🎯"}</div>

      {/* Jarrón SVG */}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
        <defs>
          <linearGradient id={`liq-${superTask.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} stopOpacity="1" />
          </linearGradient>
          <clipPath id={`jarclip-${superTask.id}`}>
            {/* Forma de jarrón: cuello angosto arriba, panza abajo */}
            <path d={`
              M ${cx - 16},22
              L ${cx - 16},34
              Q ${cx - 16},38 ${cx - (innerW/2)},42
              L ${cx - (innerW/2)},${h - 28}
              Q ${cx - (innerW/2)},${h - 16} ${cx - innerW/2 + 8},${h - 16}
              L ${cx + innerW/2 - 8},${h - 16}
              Q ${cx + innerW/2},${h - 16} ${cx + innerW/2},${h - 28}
              L ${cx + innerW/2},42
              Q ${cx + 16},38 ${cx + 16},34
              L ${cx + 16},22
              Z
            `} />
          </clipPath>
        </defs>

        {/* Líquido (clipeado por la forma del jarrón) */}
        <g clipPath={`url(#jarclip-${superTask.id})`}>
          <rect x="0" y={liquidTop} width={w} height={fillH + 6} fill={`url(#liq-${superTask.id})`} />
          {/* Burbujas decorativas */}
          {pct > 15 && (
            <>
              <circle cx={cx - 14} cy={liquidTop + 10} r="2.5" fill="#fff" opacity="0.5" />
              <circle cx={cx + 10} cy={liquidTop + 22} r="1.8" fill="#fff" opacity="0.4" />
              <circle cx={cx + 18} cy={liquidTop + 5} r="1.5" fill="#fff" opacity="0.6" />
            </>
          )}
        </g>

        {/* Contorno del jarrón (encima del líquido) */}
        <path
          d={`
            M ${cx - 16},22
            L ${cx - 16},34
            Q ${cx - 16},38 ${cx - (innerW/2)},42
            L ${cx - (innerW/2)},${h - 28}
            Q ${cx - (innerW/2)},${h - 16} ${cx - innerW/2 + 8},${h - 16}
            L ${cx + innerW/2 - 8},${h - 16}
            Q ${cx + innerW/2},${h - 16} ${cx + innerW/2},${h - 28}
            L ${cx + innerW/2},42
            Q ${cx + 16},38 ${cx + 16},34
            L ${cx + 16},22
          `}
          fill="none"
          stroke={color}
          strokeWidth="2"
        />

        {/* Tapa del jarrón */}
        <rect x={cx - 22} y="14" width="44" height="10" rx="2" fill={color} opacity="0.85" />

        {/* "Gotas" de sprints contribuyentes en la parte superior */}
        {sprintContributions.slice(0, 6).map((s, i) => (
          <circle key={i}
            cx={6 + i * 12}
            cy={h - 4}
            r="4"
            fill={s.color}
            opacity="0.85"
          >
            <title>{s.label}: {s.percent.toFixed(0)}%</title>
          </circle>
        ))}

        {/* Texto del % en el centro del líquido */}
        <text
          x={cx} y={liquidTop + (fillH < 30 ? -8 : fillH/2 + 6)}
          textAnchor="middle"
          style={{
            fontSize: compact ? 18 : 22,
            fontWeight: 800,
            fill: fillH < 30 ? "#333" : "#fff",
            fontFamily: "system-ui, sans-serif",
          }}
        >{pct.toFixed(0)}%</text>
      </svg>

      {/* Título debajo */}
      <div style={{ fontSize: compact ? 11 : 13, fontWeight: 600, color: "#333", textAlign: "center", maxWidth: w + 12, lineHeight: 1.2 }}>
        {superTask.title}
      </div>
      {!compact && (
        <div style={{ fontSize: 10, color: "#888" }}>
          {superTask.tasksCount || 0} tareas · target {superTask.target_aporte}
        </div>
      )}
    </div>
  );
}

// Vista detalle de una super-tarea: jarrón grande + sprints contribuyentes
// como pills + tareas de cada sprint como chips (hover muestra detalle rico).
function SuperTaskExpanded({ superTask, tasks, links, sprintsMap, sprintColorOf, onClose, taskFieldDefs }) {
  const [hoverTaskId, setHoverTaskId] = useState(null);
  const [expandedSprint, setExpandedSprint] = useState(null);

  // Tareas vinculadas a esta super-tarea, agrupadas por sprint
  const linkedTaskIds = useMemo(
    () => new Set(links.filter(l => l.super_task_id === superTask.id).map(l => String(l.task_id))),
    [links, superTask.id]
  );
  const linkedTasks = useMemo(
    () => tasks.filter(t => linkedTaskIds.has(String(t.id))),
    [tasks, linkedTaskIds]
  );
  const linkWeightOf = (taskId) => {
    const l = links.find(l => l.super_task_id === superTask.id && String(l.task_id) === String(taskId));
    return l?.weight ?? 1.0;
  };

  // Determinar sprint de una tarea (sprint_id contra tabla, o custom_field.sprint)
  const sprintOfTask = (t) => {
    if (t.sprint_id || t.sprintId) {
      const sid = String(t.sprint_id || t.sprintId);
      const s = sprintsMap[sid];
      if (s) return s.name;
    }
    const cf = t.custom_fields || t.customFields || {};
    return cf.sprint || "Sin sprint";
  };

  // Agrupar por sprint con sus métricas
  const sprintGroups = useMemo(() => {
    const groups = {};
    linkedTasks.forEach(t => {
      const sprintName = sprintOfTask(t);
      if (!groups[sprintName]) groups[sprintName] = {
        name: sprintName,
        tasks: [],
        aporteCerrado: 0,
        aportePotencial: 0,
      };
      const w = linkWeightOf(t.id);
      const aporte = parseFloat(t.aporte_snapshot || t.aporteSnapshot || 0);
      groups[sprintName].tasks.push({ ...t, weight: w });
      groups[sprintName].aportePotencial += aporte * w;
      if (t.status === "Finalizada") {
        groups[sprintName].aporteCerrado += aporte * w;
      }
    });
    return Object.values(groups);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedTasks, links]);

  // % global del jarrón
  const totalCerrado = sprintGroups.reduce((s, g) => s + g.aporteCerrado, 0);
  const percent = Math.min(100, (totalCerrado / Math.max(superTask.target_aporte, 1)) * 100);

  // Contribuciones por sprint para las gotas del jarrón
  const sprintContributions = sprintGroups.map(g => ({
    label: g.name,
    color: sprintColorOf(g.name),
    percent: (g.aporteCerrado / Math.max(superTask.target_aporte, 1)) * 100,
  }));

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 8px 32px rgba(0,0,0,0.1)", border: `1px solid ${superTask.color}33` }}>
      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <SuperTaskJar superTask={{ ...superTask, tasksCount: linkedTasks.length }} percent={percent} sprintContributions={sprintContributions} />
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: "0 0 6px 0", fontSize: 20, color: superTask.color, fontWeight: 700 }}>{superTask.icon} {superTask.title}</h3>
          {superTask.description && (
            <p style={{ margin: "0 0 10px 0", color: "#555", fontSize: 13, lineHeight: 1.5 }}>{superTask.description}</p>
          )}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "#666" }}>
            <span>📊 <b>{linkedTasks.length}</b> tareas vinculadas</span>
            <span>⚡ <b>{totalCerrado.toFixed(1)}</b> / {superTask.target_aporte} aporte ({percent.toFixed(0)}%)</span>
            <span>🌊 <b>{sprintGroups.length}</b> sprints contribuyen</span>
          </div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid #e0e0e0", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>← Volver</button>
      </div>

      {/* Sprints como burbujas colapsadas */}
      {sprintGroups.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "#888", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
          No hay tareas vinculadas. Edita las tareas para enlazarlas a esta super-tarea.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sprintGroups.map(g => {
            const pctSprint = (g.aporteCerrado / Math.max(superTask.target_aporte, 1)) * 100;
            const isExpanded = expandedSprint === g.name;
            const sColor = sprintColorOf(g.name);
            return (
              <div key={g.name} style={{ border: `1px solid ${sColor}33`, borderRadius: 10, overflow: "hidden", background: "#fafafa" }}>
                <button onClick={() => setExpandedSprint(isExpanded ? null : g.name)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "#fff", padding: "12px 16px", border: "none", cursor: "pointer", borderBottom: isExpanded ? `1px solid ${sColor}22` : "none" }}>
                  <div style={{ width: 16, height: 16, borderRadius: "50%", background: sColor, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: "#333", fontSize: 14 }}>{g.name}</span>
                  <span style={{ fontSize: 12, color: "#888" }}>{g.tasks.length} tareas</span>
                  <div style={{ flex: 1 }} />
                  <div style={{ width: 120, height: 8, background: "#eee", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, pctSprint)}%`, height: "100%", background: sColor, transition: "width 300ms" }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: sColor, minWidth: 50, textAlign: "right" }}>+{pctSprint.toFixed(0)}%</span>
                  <span style={{ fontSize: 13, color: "#888" }}>{isExpanded ? "▾" : "▸"}</span>
                </button>

                {/* Pastillas de tareas */}
                {isExpanded && (
                  <div style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 8, position: "relative" }}>
                    {g.tasks.map(t => {
                      const statusColor = STATUS_COLORS[t.status] || "#888";
                      const isHover = hoverTaskId === t.id;
                      const finished = t.status === "Finalizada";
                      return (
                        <div key={t.id}
                          onMouseEnter={() => setHoverTaskId(t.id)}
                          onMouseLeave={() => setHoverTaskId(null)}
                          style={{
                            position: "relative",
                            background: finished ? statusColor : "#fff",
                            color: finished ? "#fff" : "#333",
                            border: `1.5px solid ${statusColor}`,
                            borderRadius: 18,
                            padding: "6px 14px",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "default",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            transition: "all 200ms",
                            transform: isHover ? "translateY(-2px)" : "none",
                            boxShadow: isHover ? `0 6px 16px ${statusColor}44` : "none",
                            maxWidth: 320,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={t.title}
                        >
                          <span style={{ opacity: 0.7, fontSize: 10 }}>#{t.id}</span>
                          <span>{t.title.length > 32 ? t.title.slice(0, 32) + "…" : t.title}</span>
                          <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>×{t.weight.toFixed(1)}</span>
                          {isHover && (
                            <div style={{
                              position: "absolute", left: 0, top: "100%", marginTop: 8,
                              width: 320, maxWidth: "90vw", zIndex: 30,
                              background: "#fff", border: "1px solid #e0e0e0", borderRadius: 10,
                              boxShadow: "0 12px 32px rgba(0,0,0,0.15)",
                              padding: 0,
                              cursor: "default",
                            }}>
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
                                focusedPersona={null}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Pestaña dedicada. Vista por defecto: grid de jarrones. Click en un jarrón
// abre la vista expandida (sprints + pastillas + detalles).
export default function SuperTasksTab({ projectId, tasks, sprints, taskFieldDefs, isOwner }) {
  const [superTasks, setSuperTasks] = useState([]);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [showCreator, setShowCreator] = useState(false);
  const [filterPersona, setFilterPersona] = useState("__all__");
  const [filterSprint, setFilterSprint] = useState("__all__");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const sprintsMap = useMemo(() => {
    const m = {};
    (sprints || []).forEach(s => { m[String(s.id)] = s; });
    return m;
  }, [sprints]);

  // Asigna un color consistente a cada sprint según hash de su nombre
  const sprintColorOf = (name) => {
    const palette = ["#542c9c", "#0aa0ab", "#ef7218", "#27ae60", "#e74c3c", "#f1c40f", "#9b59b6", "#2980b9", "#16a085", "#d35400"];
    if (!name) return "#888";
    let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return palette[h % palette.length];
  };

  const reload = async () => {
    if (!projectId) return;
    const [stRes, lkRes] = await Promise.all([
      supabase.from("super_tasks").select("*").eq("project_id", projectId).is("deleted_at", null).order("position", { ascending: true }),
      supabase.from("task_super_links").select("*"),
    ]);
    if (stRes.error) {
      if (stRes.error.code === "42P01") {
        setError("Aplica la migración 014 para empezar a usar super-tareas.");
      } else {
        setError(stRes.error.message);
      }
      setLoading(false);
      return;
    }
    setError("");
    setSuperTasks(stRes.data || []);
    setLinks(lkRes.data || []);
    setLoading(false);
  };

  useEffect(() => {
    // Wrap async to evitar setState síncrono en useEffect (React 19 strict).
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await reload();
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Aplicar filtros a las tareas
  const filteredTasks = useMemo(() => {
    let base = tasks;
    if (filterPersona !== "__all__") base = base.filter(t => t.responsible === filterPersona);
    if (filterSprint !== "__all__") {
      base = base.filter(t => {
        if (t.sprint_id || t.sprintId) {
          const sid = String(t.sprint_id || t.sprintId);
          if (sprintsMap[sid]?.name === filterSprint) return true;
        }
        const cf = t.custom_fields || t.customFields || {};
        return cf.sprint === filterSprint;
      });
    }
    if (dateFrom) base = base.filter(t => (t.end_date || t.endDate || "") >= dateFrom);
    if (dateTo) base = base.filter(t => (t.start_date || t.startDate || "") <= dateTo);
    return base;
  }, [tasks, filterPersona, filterSprint, dateFrom, dateTo, sprintsMap]);

  // Calcula percent + contribuciones por super-tarea
  const superTasksWithMetrics = useMemo(() => {
    return superTasks.map(st => {
      const linkedTaskIds = new Set(links.filter(l => l.super_task_id === st.id).map(l => String(l.task_id)));
      const linked = filteredTasks.filter(t => linkedTaskIds.has(String(t.id)));
      const linkWeight = (id) => {
        const l = links.find(l => l.super_task_id === st.id && String(l.task_id) === String(id));
        return l?.weight ?? 1.0;
      };

      let aporteCerrado = 0;
      const sprintMap = {};
      linked.forEach(t => {
        const w = linkWeight(t.id);
        const aporte = parseFloat(t.aporte_snapshot || t.aporteSnapshot || 0) * w;
        let sprintName = "Sin sprint";
        if (t.sprint_id || t.sprintId) {
          const s = sprintsMap[String(t.sprint_id || t.sprintId)];
          if (s) sprintName = s.name;
        }
        const cf = t.custom_fields || t.customFields || {};
        if (sprintName === "Sin sprint" && cf.sprint) sprintName = String(cf.sprint);
        if (!sprintMap[sprintName]) sprintMap[sprintName] = 0;
        if (t.status === "Finalizada") {
          aporteCerrado += aporte;
          sprintMap[sprintName] += aporte;
        }
      });

      const percent = Math.min(100, (aporteCerrado / Math.max(st.target_aporte, 1)) * 100);
      const sprintContributions = Object.entries(sprintMap)
        .filter(([, v]) => v > 0)
        .map(([name, v]) => ({
          label: name,
          color: sprintColorOf(name),
          percent: (v / Math.max(st.target_aporte, 1)) * 100,
        }));

      return { ...st, percent, sprintContributions, tasksCount: linked.length };
    });
  }, [superTasks, links, filteredTasks, sprintsMap]);

  const personas = useMemo(() => {
    const set = new Set(tasks.map(t => t.responsible).filter(Boolean));
    return [...set].sort();
  }, [tasks]);

  const sprintOptions = useMemo(() => {
    const set = new Set();
    (sprints || []).forEach(s => set.add(s.name));
    tasks.forEach(t => {
      const cf = t.custom_fields || t.customFields || {};
      if (cf.sprint) set.add(cf.sprint);
    });
    return [...set].sort();
  }, [tasks, sprints]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando super-tareas…</div>;
  }

  if (error) {
    return (
      <div style={{ background: "#fff8e0", border: "1px solid #f0c060", padding: 20, borderRadius: 10, fontSize: 14 }}>
        ⚠️ {error}
      </div>
    );
  }

  // Vista expandida
  if (expandedId) {
    const st = superTasksWithMetrics.find(s => s.id === expandedId);
    if (!st) { setExpandedId(null); return null; }
    return (
      <SuperTaskExpanded
        superTask={st}
        tasks={filteredTasks}
        links={links}
        sprintsMap={sprintsMap}
        sprintColorOf={sprintColorOf}
        taskFieldDefs={taskFieldDefs}
        onClose={() => setExpandedId(null)}
      />
    );
  }

  return (
    <div style={{ padding: 4 }}>
      {/* Cabecera */}
      <div style={{ background: "linear-gradient(135deg, #542c9c 0%, #ef7218 100%)", borderRadius: 12, padding: 20, marginBottom: 18, color: "#fff" }}>
        <h2 style={{ margin: "0 0 6px 0", fontSize: 22, fontWeight: 700 }}>Super-tareas · Norte del proyecto</h2>
        <p style={{ margin: 0, opacity: 0.92, fontSize: 13 }}>
          Cada jarrón es un objetivo grande. Las tareas que lo alimentan lo llenan según su aporte y peso.
          Las gotas debajo del jarrón muestran qué sprints están contribuyendo y con cuánto.
        </p>
      </div>

      {/* Filtros */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 18 }}>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Persona</label>
          <select value={filterPersona} onChange={(e) => setFilterPersona(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, minWidth: 160 }}>
            <option value="__all__">Todas las personas</option>
            {personas.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Sprint</label>
          <select value={filterSprint} onChange={(e) => setFilterSprint(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13, minWidth: 140 }}>
            <option value="__all__">Todos los sprints</option>
            {sprintOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Desde</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Hasta</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ padding: "7px 10px", borderRadius: 6, border: "1px solid #ddd", fontSize: 13 }} />
        </div>
        <div style={{ marginLeft: "auto" }}>
          {isOwner && (
            <button onClick={() => setShowCreator(true)} style={{ background: "linear-gradient(135deg, #542c9c, #6e3ebf)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 700, boxShadow: "0 3px 12px rgba(84,44,156,0.3)" }}>
              + Nueva super-tarea
            </button>
          )}
        </div>
      </div>

      {/* Grid de jarrones */}
      {superTasksWithMetrics.length === 0 ? (
        <div style={{ padding: 60, textAlign: "center", color: "#888", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>🏺</div>
          <div style={{ fontSize: 15, color: "#555", marginBottom: 8 }}>Aún no hay super-tareas en este proyecto.</div>
          {isOwner && <div style={{ fontSize: 12, color: "#999" }}>Crea la primera con el botón "+ Nueva super-tarea" arriba.</div>}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
          {superTasksWithMetrics.map(st => (
            <SuperTaskJar
              key={st.id}
              superTask={st}
              percent={st.percent}
              sprintContributions={st.sprintContributions}
              onClick={() => setExpandedId(st.id)}
            />
          ))}
        </div>
      )}

      {/* Modal de creación */}
      {showCreator && (
        <Suspense fallback={null}>
          <SuperTaskCreatorModal
            projectId={projectId}
            tasks={tasks}
            onClose={() => setShowCreator(false)}
            onCreated={() => { setShowCreator(false); reload(); }}
          />
        </Suspense>
      )}
    </div>
  );
}
