import { useState, useEffect, useMemo, useId, memo } from "react";
import { supabase } from "../../supabaseClient";
import { useDialog } from "../../useDialog";
import { STATUS_COLORS, STATUS_LIGHT, ESTADOS, DEFAULT_TASK_TYPES } from "../../constants";
import { calcAporte } from "../../lib/aporte";
import { getColombiaNow } from "../../lib/format";
import { readCustomFieldValue } from "../../lib/customFields";
import TaskForm from "./TaskForm";

const emptyTask = (id) => ({
  id,
  createdAt: getColombiaNow(),
  indicator: "",
  indicators: [],
  title: "",
  startDate: "",
  endDate: "",
  estimatedTime: 5,
  type: "Operativa",
  status: "Sin iniciar",
  validationClose: null,
  extProgress1: "",
  extProgress2: "",
  difficulty: 5,
  strategicValue: 5,
  aporteSnapshot: null,
  expectedDelivery: "",
  responsible: "",
  comments: "",
  progressPercent: 0,
  subtasks: [],
  dependentTask: "",
  finalizedAt: null,
  dimensionValues: {},
  krId: null,
  sprintId: null,
  customFields: {},
  updatedAt: null,
  closedAt: null,
  lastModifiedBy: '',
});

// ─── TaskCard ──────────────────────────────────────────────
// Compact, card-friendly rendering for a custom field value.
function formatCardCustomField(def, task) {
  const v = readCustomFieldValue(def, task);
  if (v === undefined || v === null || v === '') return null;
  if (def.type === 'multiselect' && Array.isArray(v)) {
    if (!v.length) return null;
    return v.join(', ');
  }
  if (def.type === 'subitems' && Array.isArray(v)) {
    if (!v.length) return null;
    const done = v.filter(i => i.done).length;
    return `☑ ${done}/${v.length}`;
  }
  if (def.type === 'date' && typeof v === 'string') return v;
  if (def.type === 'textarea') {
    const s = String(v);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  }
  return String(v);
}

// Wrapper that binds a stable click handler per task so the memoized
// TaskCard doesn't re-render when the parent recreates its arrow.
const TaskCardWithClick = memo(function TaskCardWithClick({ task, openEdit, customFieldDefs }) {
  const onClick = useMemo(() => () => openEdit(task), [openEdit, task]);
  return <TaskCard task={task} onClick={onClick} customFieldDefs={customFieldDefs} />;
});

// Memoized: avoids re-rendering every card when an unrelated piece of state
// changes (kanban with hundreds of cards × dozens of defs would otherwise
// run formatCardCustomField on every keystroke).
const TaskCard = memo(function TaskCard({ task, onClick, customFieldDefs = [] }) {
  const sc = STATUS_COLORS[task.status] || "#888";
  const sl = STATUS_LIGHT[task.status] || "#eee";
  const prog = task.type === "Otra" ? null : task.progressPercent;
  const aporteVal = task.type !== "Otra"
    ? (task.aporteSnapshot != null ? task.aporteSnapshot : "—")
    : null;
  return (
    <div
      onClick={onClick}
      style={{
        background: "#ffffff",
        border: "1px solid rgba(84,44,156,0.1)",
        borderLeft: `4px solid ${sc}`,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        transition: "all 0.2s ease",
        marginBottom: 8,
        animation: "fadeInUp 0.3s ease",
        boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(84,44,156,0.14)"; e.currentTarget.style.borderColor = sc; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 1px 6px rgba(0,0,0,0.06)"; e.currentTarget.style.borderColor = "rgba(84,44,156,0.1)"; e.currentTarget.style.borderLeftColor = sc; }}
    >
      {aporteVal !== null && (
        <div style={{ background: "linear-gradient(135deg, #ec6c04, #f07d1e)", borderRadius: 8, padding: "6px 10px", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 8px rgba(236,108,4,0.25)" }}>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#ffffff", opacity: 0.9 }}>Valor de Aporte</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#ffffff", lineHeight: 1 }}>{aporteVal}</span>
        </div>
      )}
      <div style={{ fontSize: 10, color: "#969696", marginBottom: 3 }}>#{task.id}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#2d2d2d", marginBottom: 8, lineHeight: 1.35, wordBreak: "break-word" }}>
        {task.title || "(Sin título)"}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 20,
          background: sl, color: sc, whiteSpace: "nowrap", letterSpacing: "0.05em",
        }}>{task.status}</span>
        {prog !== null && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, justifyContent: "flex-end" }}>
            <div style={{ flex: 1, height: 5, background: "#f0f0f0", borderRadius: 3, maxWidth: 70 }}>
              <div style={{ width: `${Math.min(100, prog)}%`, height: "100%", background: prog >= 100 ? "#27ae60" : "#ec6c04", borderRadius: 3, transition: "width 0.4s ease" }} />
            </div>
            <span style={{ fontSize: 10, color: "#969696" }}>{Number(prog).toFixed(0)}%</span>
          </div>
        )}
      </div>
      {task.responsible && (
        <div style={{ fontSize: 10, color: "#149cac", fontWeight: 500, marginTop: 6 }}>
          👤 {task.responsible}
        </div>
      )}
      {task.subtasks?.length > 0 && (
        <div style={{ fontSize: 10, color: "#542c9c", fontWeight: 500, marginTop: 4 }}>
          ☑ {task.subtasks.filter(s => s.done).length}/{task.subtasks.length} subtareas
        </div>
      )}
      {(() => {
        // customFieldDefs is already filtered to "shown" by BoardTab (see
        // useMemo there). Defensive double-check keeps this safe if the
        // component is reused elsewhere.
        const shown = (customFieldDefs || []).filter(d => d.show_on_card && !d.deleted_at);
        if (!shown.length) return null;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6, paddingTop: 6, borderTop: '1px dashed #f0e8fa' }}>
            {shown.map(def => {
              const v = formatCardCustomField(def, task);
              if (v === null) return null;
              return (
                <div key={def.id} style={{ fontSize: 10, color: '#542c9c', display: 'flex', gap: 6, lineHeight: 1.3 }}>
                  <span style={{ fontWeight: 600, opacity: 0.7, flexShrink: 0 }}>{def.label}:</span>
                  <span style={{ color: '#2d2d2d', wordBreak: 'break-word' }}>{v}</span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
});

// ─── Modal ─────────────────────────────────────────────────
function Modal({ title, onClose, onSave, onDelete, children, saveLabel = "Guardar" }) {
  const titleId = useId();
  const dialogRef = useDialog(onClose);
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(26,26,46,0.65)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      zIndex: 1000, padding: "16px", overflowY: "auto",
    }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{
        background: "#ffffff",
        border: "1px solid rgba(84,44,156,0.15)",
        borderRadius: 16,
        width: "100%", maxWidth: 680,
        marginTop: 8,
        boxShadow: "0 20px 60px rgba(84,44,156,0.2)",
        overflow: "hidden",
        outline: "none",
      }}>
        <div style={{ background: "linear-gradient(135deg, #542c9c, #6e3ebf)", borderRadius: "16px 16px 0 0", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#ffffff" }}>{title}</h2>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: "20px 22px 4px" }}>{children}</div>
        <div style={{ padding: "0 22px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {onDelete && (
              <button onClick={onDelete} style={{
                background: "#fde8e8", border: "1px solid #f5c6c6",
                color: "#c0392b", borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600,
              }}>Eliminar tarea</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{
              background: "#f4f4f4", border: "1px solid #e0e0e0",
              color: "#666666", borderRadius: 8, padding: "7px 16px", cursor: "pointer", fontSize: 13,
            }}>Cancelar</button>
            <button onClick={onSave} style={{
              background: "linear-gradient(135deg, #ec6c04, #f07d1e)", border: "none", color: "#ffffff",
              borderRadius: 8, padding: "9px 22px", cursor: "pointer", fontSize: 13, fontWeight: 700,
              boxShadow: "0 3px 12px rgba(236,108,4,0.35)",
            }}>{saveLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BoardTab ──────────────────────────────────────────────
// Tablero Kanban: columnas por estado, filtros, y modal de creación/edición
// (Modal + TaskForm). Dirigido 100% por props. Extraído del monolito
// (H-002, núcleo fase C).
export default function BoardTab({ tasks, createTask, updateTask, deleteTask, participants, indicators, currentUser, weights, taskTypes, dimensions, editTaskFromDep, onDepEditDone, projectId, nextId, keyResults = [], sprints = [], taskFieldDefs = [] }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(null);
  const [taskHistory, setTaskHistory] = useState([]);
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [fIndicator, setFIndicator] = useState("");
  const [fResponsible, setFResponsible] = useState("");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo, setFDateTo] = useState("");
  const [search, setSearch] = useState("");

  const openNew = () => {
    // El id se reserva al GUARDAR (ver save()), no al abrir, para no quemar ids
    // de la secuencia ni disparar trabajo en el servidor por cada formulario que
    // el usuario abre y descarta (H-014). El número definitivo aparece tras guardar.
    setForm(emptyTask(null));
    setModal("new");
  };
  const openEdit = async (t) => {
    setForm({ ...t });
    setTaskHistory([]);
    setModal(t.id);
    if (projectId) {
      const { data } = await supabase.from('task_history').select('*').eq('task_id', t.id).eq('project_id', projectId).order('changed_at', { ascending: false }).limit(20);
      if (data) setTaskHistory(data);
    }
  };

  // Open edit modal when triggered from DependenciesTab
  useEffect(() => {
    if (!editTaskFromDep) return undefined;
    let active = true;
    const openFromDependencyGraph = async () => {
      setForm({ ...editTaskFromDep });
      setTaskHistory([]);
      setModal(editTaskFromDep.id);
      if (projectId) {
        const { data } = await supabase.from('task_history').select('*').eq('task_id', editTaskFromDep.id).eq('project_id', projectId).order('changed_at', { ascending: false }).limit(20);
        if (active && data) setTaskHistory(data);
      }
      if (active && onDepEditDone) onDepEditDone();
    };
    openFromDependencyGraph();
    return () => { active = false; };
  }, [editTaskFromDep, onDepEditDone, projectId]);

  const save = async () => {
    if (!form.title.trim()) { alert("El título es obligatorio"); return; }
    setModal(null);
    if (modal === "new") {
      // Reservar el id atómicamente recién ahora (lock-free vía SEQUENCE, H-014).
      let id = form.id;
      if (id == null) {
        try {
          const { data: claimedId, error } = await supabase.rpc('claim_task_id');
          if (error || claimedId == null) {
            console.warn('[save] claim_task_id falló, usando fallback nextId:', error?.message || claimedId);
            id = nextId;
          } else {
            id = claimedId;
          }
        } catch (err) {
          console.warn('[save] claim_task_id excepción, usando fallback nextId:', err?.message);
          id = nextId;
        }
      }
      const activeDimensions = Array.isArray(dimensions) && dimensions.length ? dimensions : weights;
      const newTask = { ...form, id, aporteSnapshot: parseFloat(calcAporte(form, activeDimensions).toFixed(1)) };
      await createTask(newTask);
    } else {
      await updateTask(form);
    }
  };

  const del = async () => {
    if (!confirm(`¿Eliminar la tarea #${form.id}?`)) return;
    setModal(null);
    await deleteTask(form.id);
  };

  const filtered = useMemo(() => tasks.filter((t) => {
    if (fStatus && t.status !== fStatus) return false;
    if (fType && t.type !== fType) return false;
    if (fIndicator && t.indicator !== fIndicator) return false;
    if (fResponsible && t.responsible !== fResponsible) return false;
    if (!(!fDateFrom || !t.endDate || t.endDate >= fDateFrom)) return false;
    if (!(!fDateTo || !t.startDate || t.startDate <= fDateTo)) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !String(t.id).includes(search)) return false;
    return true;
  }), [tasks, fStatus, fType, fIndicator, fResponsible, fDateFrom, fDateTo, search]);

  const grouped = useMemo(() => {
    const g = {};
    ESTADOS.forEach((s) => (g[s] = []));
    filtered.forEach((t) => { if (g[t.status]) g[t.status].push(t); });
    return g;
  }, [filtered]);

  // Pre-filter defs marked as visible on summary cards. Stable identity
  // so React.memo on TaskCard avoids re-rendering on unrelated state changes.
  const shownTaskFieldDefs = useMemo(
    () => (taskFieldDefs || []).filter(d => d.show_on_card && !d.deleted_at),
    [taskFieldDefs]
  );

  const ss = { background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-secondary)", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: "pointer", outline: "none", fontFamily: "inherit" };
  const si = { ...ss, color: "var(--color-text-primary)" };

  return (
    <div>
      <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 2px 12px rgba(84,44,156,0.08)", padding: "12px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={openNew} style={{ background: "linear-gradient(135deg, #ec6c04, #f07d1e)", border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, boxShadow: "0 3px 10px rgba(236,108,4,0.3)" }}>
          + Nueva tarea
        </button>
        <input style={si} placeholder="Buscar tarea o ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select style={ss} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select style={ss} value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">Todos los tipos</option>
          {(taskTypes.length ? taskTypes.map((t) => t.name) : DEFAULT_TASK_TYPES).map((t) => <option key={t}>{t}</option>)}
        </select>
        <select style={ss} value={fIndicator} onChange={(e) => setFIndicator(e.target.value)}>
          <option value="">Todos los indicadores</option>
          {indicators.map((i) => <option key={i.id}>{i.name}</option>)}
        </select>
        <select style={ss} value={fResponsible} onChange={(e) => setFResponsible(e.target.value)}>
          <option value="">Todos los responsables</option>
          {participants.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
        </select>
        <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Desde</label>
        <input type="date" style={si} value={fDateFrom} onChange={(e) => setFDateFrom(e.target.value)} />
        <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Hasta</label>
        <input type="date" style={si} value={fDateTo} onChange={(e) => setFDateTo(e.target.value)} />
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
          {filtered.length} tarea{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>
      </div>

      <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 12, minHeight: 200 }}>
        {ESTADOS.map((status) => (
          <div key={status} style={{ flexShrink: 0, width: 210, background: "#ffffff", borderRadius: 14, boxShadow: "0 2px 16px rgba(84,44,156,0.06)", padding: "12px 10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 8, borderBottom: `2px solid ${STATUS_COLORS[status]}` }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: STATUS_COLORS[status], textTransform: "uppercase", letterSpacing: "0.06em" }}>{status}</span>
              <span style={{ fontSize: 11, background: STATUS_LIGHT[status], color: STATUS_COLORS[status], borderRadius: 10, padding: "1px 7px", fontWeight: 500 }}>
                {grouped[status]?.length || 0}
              </span>
            </div>
            {(grouped[status] || []).map((task) => (
              <TaskCardWithClick key={task.id} task={task} openEdit={openEdit} customFieldDefs={shownTaskFieldDefs} />
            ))}
          </div>
        ))}
      </div>

      {modal && form && (
        <Modal
          title={modal === "new" ? `Nueva tarea${form.id != null ? ` #${form.id}` : ""}` : `Tarea #${form.id} — ${form.title || "Sin título"}`}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal !== "new" ? del : undefined}
        >
          <TaskForm task={form} setTask={setForm} participants={participants} indicators={indicators} taskTypes={taskTypes} currentUser={currentUser} weights={weights} dimensions={dimensions} keyResults={keyResults} sprints={sprints} taskHistory={taskHistory} tasks={tasks} customFieldDefs={taskFieldDefs} projectId={projectId} />
        </Modal>
      )}
    </div>
  );
}
