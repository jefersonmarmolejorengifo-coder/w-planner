import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

const STATUS_COLORS = {
  "No programada": "#969696",
  "Sin iniciar":   "#542c9c",
  "En proceso":    "#ec6c04",
  "Bloqueada":     "#c0392b",
  "En pausa":      "#149cac",
  "Cancelada":     "#969696",
  "Finalizada":    "#27ae60",
};
const STATUS_LIGHT = {
  "No programada": "#f4f4f4",
  "Sin iniciar":   "#ede8f8",
  "En proceso":    "#fff3ea",
  "Bloqueada":     "#fde8e8",
  "En pausa":      "#e6f7f8",
  "Cancelada":     "#f4f4f4",
  "Finalizada":    "#e8f8ee",
};
const TYPE_COLORS = {
  Administrativa: "#185FA5",
  Operativa: "#BA7517",
  Apadrinamiento: "#993556",
  Seguimiento: "#534AB7",
  Creativa: "#3B6D11",
  Otra: "#5F5E5A",
};
const TIPOS = ["Administrativa","Operativa","Apadrinamiento","Seguimiento","Creativa","Otra"];
const ESTADOS = ["No programada","Sin iniciar","En proceso","Bloqueada","En pausa","Cancelada","Finalizada"];
const CLOSE_STATES = ["Finalizada","Cancelada"];
const STORAGE_KEY = "w_planner_v1";
const CONFIG_PIN = "020419*";

const getColombiaNow = () => {
  const d = new Date();
  return d.toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
};

const daysBetween = (a, b) => {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
};

const loadState = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
  catch { return null; }
};

const emptyTask = (id) => ({
  id,
  createdAt: getColombiaNow(),
  indicator: "",
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
});

// ─── calcAporte ────────────────────────────────────────────
const calcAporte = (task, weights) =>
  ((task.estimatedTime || 1) * weights.tiempo +
   (task.difficulty || 1) * weights.dificultad +
   (task.strategicValue || 1) * weights.estrategico) / 100;

// ─── StarRating ────────────────────────────────────────────
function StarRating({ value, onChange, readonly }) {
  const [hov, setHov] = useState(0);
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          onMouseEnter={() => !readonly && setHov(n)}
          onMouseLeave={() => !readonly && setHov(0)}
          onClick={() => !readonly && onChange(n)}
          style={{
            fontSize: 20, cursor: readonly ? "default" : "pointer",
            userSelect: "none", lineHeight: 1,
            color: n <= (hov || Number(value)) ? (hov >= n ? "#f07d1e" : "#ec6c04") : "#e0e0e0",
            transition: "color 0.15s, transform 0.1s",
            transform: !readonly && hov === n ? "scale(1.2)" : "scale(1)",
            display: "inline-block",
          }}
        >★</span>
      ))}
    </div>
  );
}

// ─── Field wrapper ─────────────────────────────────────────
const F = ({ label, children, half }) => (
  <div style={{ gridColumn: half ? "span 1" : "span 2" }}>
    <label style={{
      display: "block", fontSize: 11, fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.07em",
      color: "#542c9c", marginBottom: 5,
    }}>{label}</label>
    {children}
  </div>
);

const inp = {
  background: "#fafafa",
  border: "1.5px solid #e0e0e0",
  borderRadius: 8,
  color: "#2d2d2d",
  padding: "8px 12px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
  fontFamily: "inherit",
  transition: "border-color 0.2s, box-shadow 0.2s",
};
const readonlyInp = { ...inp, background: "#f4f4f4", color: "#969696", cursor: "default", border: "1.5px solid #e8e8e8" };

// ─── TaskForm ──────────────────────────────────────────────
function TaskForm({ task, setTask, participants, indicators, currentUser, weights }) {
  const isOtra = task.type === "Otra";
  const isClose = CLOSE_STATES.includes(task.status);
  const isSuperUser = currentUser?.isSuperUser;

  const upd = (key, val) =>
    setTask((prev) => {
      const next = { ...prev, [key]: val };
      if (key === "status" && CLOSE_STATES.includes(val)) next.validationClose = val;
      return next;
    });

  const addSubtask = () => {
    if (task.subtasks.length < 20) upd("subtasks", [...task.subtasks, ""]);
  };
  const updSubtask = (i, v) => {
    const arr = [...task.subtasks];
    arr[i] = v;
    upd("subtasks", arr);
  };
  const delSubtask = (i) => upd("subtasks", task.subtasks.filter((_, idx) => idx !== i));

  const isNew = task.aporteSnapshot === null || task.aporteSnapshot === undefined;
  const aporteDisplay = isNew
    ? (weights && task.type !== "Otra" ? calcAporte(task, weights).toFixed(1) : null)
    : (task.type !== "Otra" ? String(task.aporteSnapshot) : null);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <F label="ID" half><input style={readonlyInp} readOnly value={task.id ?? "(auto)"} /></F>
      <F label="Fecha de creación" half><input style={readonlyInp} readOnly value={task.createdAt} /></F>

      {aporteDisplay !== null && (
        <div style={{ gridColumn: "span 2", background: "linear-gradient(135deg, #ec6c04 0%, #149cac 100%)", backgroundSize: "200% auto", animation: "shimmer 3s linear infinite", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#ffffff", display: "block", opacity: 0.9 }}>Valor de Aporte</span>
            {!isNew && (
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.75)" }}>Calculado con los pesos al momento de creación</span>
            )}
          </div>
          <span style={{ fontSize: 26, fontWeight: 800, color: "#ffffff", lineHeight: 1 }}>{aporteDisplay}</span>
        </div>
      )}

      <F label="Título de la tarea *">
        <input style={inp} value={task.title} onChange={(e) => upd("title", e.target.value)} placeholder="Descripción breve..." />
      </F>

      <F label="Tipo" half>
        <select style={inp} value={task.type} onChange={(e) => upd("type", e.target.value)}>
          {TIPOS.map((t) => <option key={t}>{t}</option>)}
        </select>
      </F>
      <F label="Fecha de inicio" half>
        <input type="date" style={inp} value={task.startDate} onChange={(e) => upd("startDate", e.target.value)} />
      </F>
      <F label="Fecha de fin" half>
        <input type="date" style={inp} value={task.endDate} onChange={(e) => upd("endDate", e.target.value)} />
      </F>
      {!isOtra && (
        <>
          <F label="Indicador que impacta">
            <select style={inp} value={task.indicator} onChange={(e) => upd("indicator", e.target.value)}>
              <option value="">— Seleccionar indicador —</option>
              {indicators.map((ind) => <option key={ind.id} value={ind.name}>{ind.name}</option>)}
            </select>
          </F>

          <F label="Estado" half>
            <select
              style={{ ...inp, borderColor: STATUS_COLORS[task.status] + "88" }}
              value={task.status}
              onChange={(e) => upd("status", e.target.value)}
            >
              {ESTADOS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </F>

          {isClose && (
            <F label={`Validación de cierre${!isSuperUser ? " (sólo super usuario)" : ""}`} half>
              <input
                style={isSuperUser ? { ...inp, borderColor: "#EF9F27" } : readonlyInp}
                value={task.validationClose || ""}
                readOnly={!isSuperUser}
                onChange={(e) => isSuperUser && upd("validationClose", e.target.value)}
                placeholder={isSuperUser ? "Editar validación..." : task.validationClose || ""}
              />
            </F>
          )}

          <F label="Avance condicionado externo" half>
            <input style={inp} value={task.extProgress1} onChange={(e) => upd("extProgress1", e.target.value)} />
          </F>
          <F label="Avance condicionado interno" half>
            <input style={inp} value={task.extProgress2} onChange={(e) => upd("extProgress2", e.target.value)} />
          </F>

          <div style={{ gridColumn: "span 2", display: "flex", gap: 24 }}>
            {[
              { label: "Tiempo estimado (1-10 ★)", key: "estimatedTime", def: 5 },
              { label: "Dificultad estimada (1-10 ★)", key: "difficulty", def: 5 },
              { label: "Valor estratégico (1-10 ★)", key: "strategicValue", def: 5 },
            ].map(({ label, key, def }) => (
              <div key={key} style={{ flex: 1 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#542c9c", marginBottom: 4 }}>
                  {label}
                </label>
                <StarRating value={Number(task[key]) || def} onChange={(v) => upd(key, v)} />
              </div>
            ))}
          </div>

          <F label="Entrega esperada">
            <textarea style={{ ...inp, minHeight: 64, resize: "vertical" }} value={task.expectedDelivery} onChange={(e) => upd("expectedDelivery", e.target.value)} />
          </F>

          <F label="Responsable" half>
            <select style={inp} value={task.responsible} onChange={(e) => upd("responsible", e.target.value)}>
              <option value="">— Seleccionar —</option>
              {participants.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </F>

          <F label="Porcentaje de avance" half>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="number" min={0} max={100} step={0.1} style={{ ...inp, flex: 1 }}
                value={task.progressPercent}
                onChange={(e) => upd("progressPercent", Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))} />
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)", minWidth: 34, fontWeight: 500 }}>
                {Number(task.progressPercent).toFixed(1)}%
              </span>
            </div>
          </F>

          <F label="Tarea dependiente (ID)" half>
            <input type="number" style={inp} value={task.dependentTask} onChange={(e) => upd("dependentTask", e.target.value)} placeholder="Ej: 12" />
          </F>

          <F label="Comentarios">
            <textarea style={{ ...inp, minHeight: 72, resize: "vertical" }} value={task.comments} onChange={(e) => upd("comments", e.target.value)} />
          </F>

          <F label={`Subtareas (${task.subtasks.length}/20)`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {task.subtasks.map((st, i) => (
                <div key={i} style={{ display: "flex", gap: 6 }}>
                  <input style={{ ...inp, flex: 1 }} value={st} onChange={(e) => updSubtask(i, e.target.value)} placeholder={`Subtarea ${i + 1}`} />
                  <button onClick={() => delSubtask(i)} style={{
                    background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)",
                    color: "var(--color-text-danger)", borderRadius: 6, padding: "0 10px", cursor: "pointer", fontSize: 14,
                  }}>✕</button>
                </div>
              ))}
              {task.subtasks.length < 20 && (
                <button onClick={addSubtask} style={{
                  background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)",
                  color: "var(--color-text-secondary)", borderRadius: 6, padding: "6px", cursor: "pointer", fontSize: 12,
                }}>+ Agregar subtarea</button>
              )}
            </div>
          </F>
        </>
      )}
    </div>
  );
}

// ─── TaskCard ──────────────────────────────────────────────
function TaskCard({ task, onClick }) {
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
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────
function Modal({ title, onClose, onSave, onDelete, children, saveLabel = "Guardar" }) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(26,26,46,0.65)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      zIndex: 1000, padding: "16px", overflowY: "auto",
    }}>
      <div style={{
        background: "#ffffff",
        border: "1px solid rgba(84,44,156,0.15)",
        borderRadius: 16,
        width: "100%", maxWidth: 680,
        marginTop: 8,
        boxShadow: "0 20px 60px rgba(84,44,156,0.2)",
        overflow: "hidden",
      }}>
        <div style={{ background: "linear-gradient(135deg, #542c9c, #6e3ebf)", borderRadius: "16px 16px 0 0", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#ffffff" }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: 22, lineHeight: 1 }}>×</button>
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
function BoardTab({ tasks, setTasks, participants, indicators, currentUser, nextId, setNextId, weights }) {
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(null);
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [fIndicator, setFIndicator] = useState("");
  const [fResponsible, setFResponsible] = useState("");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo, setFDateTo] = useState("");
  const [search, setSearch] = useState("");

  const openNew = () => { setForm(emptyTask(nextId)); setModal("new"); };
  const openEdit = (t) => { setForm({ ...t }); setModal(t.id); };

  const save = () => {
    if (!form.title.trim()) { alert("El título es obligatorio"); return; }
    if (modal === "new") {
      const taskToSave = { ...form, aporteSnapshot: parseFloat(calcAporte(form, weights).toFixed(1)) };
      setTasks((p) => [...p, taskToSave]);
      setNextId((n) => n + 1);
    } else {
      setTasks((p) => p.map((t) => (t.id === form.id ? form : t)));
    }
    setModal(null);
  };

  const del = () => {
    if (!confirm(`¿Eliminar la tarea #${form.id}?`)) return;
    setTasks((p) => p.filter((t) => t.id !== form.id));
    setModal(null);
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
          {TIPOS.map((t) => <option key={t}>{t}</option>)}
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
              <TaskCard key={task.id} task={task} onClick={() => openEdit(task)} />
            ))}
          </div>
        ))}
      </div>

      {modal && form && (
        <Modal
          title={modal === "new" ? `Nueva tarea #${form.id}` : `Tarea #${form.id} — ${form.title || "Sin título"}`}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal !== "new" ? del : undefined}
        >
          <TaskForm task={form} setTask={setForm} participants={participants} indicators={indicators} currentUser={currentUser} weights={weights} />
        </Modal>
      )}
    </div>
  );
}

// ─── GanttTab ──────────────────────────────────────────────
function GanttTab({ tasks, indicators }) {
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0]; });
  const [dateTo, setDateTo] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 2, 0); return d.toISOString().split("T")[0]; });
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [fIndicator, setFIndicator] = useState("");

  const filtered = useMemo(() => tasks.filter((t) => {
    if (!t.startDate || !t.endDate) return false;
    if (t.endDate < dateFrom || t.startDate > dateTo) return false;
    if (fStatus && t.status !== fStatus) return false;
    if (fType && t.type !== fType) return false;
    if (fIndicator && t.indicator !== fIndicator) return false;
    return true;
  }), [tasks, dateFrom, dateTo, fStatus, fType, fIndicator]);

  const startMs = new Date(dateFrom).getTime();
  const endMs = new Date(dateTo).getTime();
  const totalMs = Math.max(1, endMs - startMs);
  const [labelWidth, setLabelWidth] = useState(210);
  const isResizing = useRef(false);
  const ROW_H = 34;
  const CHART_W = 660;
  const HDR_H = 44;

  const months = useMemo(() => {
    const ms = [];
    const start = new Date(dateFrom);
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur.getTime() <= endMs) {
      const mStart = Math.max(cur.getTime(), startMs);
      const mEnd = Math.min(new Date(cur.getFullYear(), cur.getMonth() + 1, 0, 23, 59).getTime(), endMs);
      const x = ((mStart - startMs) / totalMs) * CHART_W;
      const w = Math.max(0, ((mEnd - mStart) / totalMs) * CHART_W);
      ms.push({ label: cur.toLocaleDateString("es-CO", { month: "short", year: "2-digit" }), x, w });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    return ms;
  }, [dateFrom, dateTo, startMs, endMs, totalMs]);

  const fmtShort = (d) => { if (!d) return ""; const [, m, day] = d.split("-"); return `${day}/${m}`; };
  const fmtFull  = (d) => { if (!d) return ""; const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; };

  const days = useMemo(() => {
    const result = [];
    let cur = new Date(dateFrom);
    const end = new Date(dateTo);
    while (cur <= end) {
      const dayMs = cur.getTime();
      const nextMs = dayMs + 86400000;
      const x = ((dayMs - startMs) / totalMs) * CHART_W;
      const w = ((nextMs - dayMs) / totalMs) * CHART_W;
      const dow = cur.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const weekNum = Math.floor((cur.getTime() - new Date(cur.getFullYear(), 0, 1).getTime()) / (7 * 86400000));
      const fill = isWeekend ? "#fff3ea" : weekNum % 2 === 0 ? "#fafafa" : "#f4f0fb";
      result.push({ label: cur.getDate(), x, w, fill });
      cur = new Date(nextMs);
    }
    return result;
  }, [dateFrom, dateTo, startMs, endMs, totalMs]);

  const todayX = ((new Date(today).getTime() - startMs) / totalMs) * CHART_W;
  const bx = (s) => Math.max(0, ((new Date(s).getTime() - startMs) / totalMs) * CHART_W);
  const bw = (s, e) => {
    const a = Math.max(new Date(s).getTime(), startMs);
    const b = Math.min(new Date(e).getTime(), endMs);
    return Math.max(4, ((b - a) / totalMs) * CHART_W);
  };

  const ss = { background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-secondary)", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: "pointer", outline: "none", fontFamily: "inherit" };
  const si = { ...ss, color: "var(--color-text-primary)" };
  const svgH = HDR_H + filtered.length * ROW_H + 8;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Desde</label>
        <input type="date" style={si} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <label style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Hasta</label>
        <input type="date" style={si} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <select style={ss} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select style={ss} value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select style={ss} value={fIndicator} onChange={(e) => setFIndicator(e.target.value)}>
          <option value="">Todos los indicadores</option>
          {indicators.map((i) => <option key={i.id}>{i.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--color-text-secondary)", padding: "40px 0", fontSize: 13 }}>
          No hay tareas con fechas de inicio y fin en el rango seleccionado.
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "0.5px solid var(--color-border-tertiary)", borderRadius: 10, background: "var(--color-background-primary)" }}>
          <div style={{ display: "flex", minWidth: labelWidth + CHART_W }}>
            <div style={{ position: "relative", width: labelWidth, flexShrink: 0, borderRight: "0.5px solid var(--color-border-tertiary)" }}>
              <div
                onMouseDown={(e) => {
                  e.preventDefault();
                  isResizing.current = true;
                  const startX = e.clientX;
                  const startW = labelWidth;
                  const onMove = (ev) => {
                    if (!isResizing.current) return;
                    const newW = Math.max(120, Math.min(400, startW + ev.clientX - startX));
                    setLabelWidth(newW);
                  };
                  const onUp = () => {
                    isResizing.current = false;
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
                style={{ position: "absolute", top: 0, right: 0, width: 6, height: "100%", cursor: "col-resize", background: "transparent", zIndex: 10, transition: "background 0.15s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(236,108,4,0.35)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              />
              <div style={{ height: HDR_H, borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "6px 10px" }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Tarea</span>
              </div>
              {filtered.map((t, i) => (
                <div key={t.id} style={{
                  height: ROW_H, display: "flex", alignItems: "center", padding: "0 10px",
                  borderBottom: "0.5px solid var(--color-border-tertiary)",
                  background: i % 2 === 0 ? "transparent" : "var(--color-background-secondary)",
                }}>
                  <span style={{ fontSize: 10, color: "var(--color-text-secondary)", marginRight: 6 }}>#{t.id}</span>
                  <span style={{ fontSize: 12, color: "var(--color-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 170 }}>{t.title}</span>
                </div>
              ))}
            </div>

            <div style={{ flex: 1, overflowX: "auto" }}>
              <svg width={CHART_W} height={svgH} style={{ display: "block" }}>
                {/* ── Nivel superior: meses (0–22 px) ── */}
                {months.map((m, i) => (
                  <g key={i}>
                    <rect x={m.x} y={0} width={m.w} height={22} fill={i % 2 === 0 ? "#fafafa" : "#f4f0fb"} />
                    <text x={m.x + m.w / 2} y={14} textAnchor="middle" fontSize={10} fontWeight="600" fill="#542c9c">{m.label}</text>
                    <line x1={m.x} y1={0} x2={m.x} y2={22} stroke="var(--color-border-tertiary)" strokeWidth={0.5} />
                  </g>
                ))}
                <line x1={0} y1={22} x2={CHART_W} y2={22} stroke="var(--color-border-tertiary)" strokeWidth={0.5} />
                {/* ── Nivel inferior: días (22–44 px) ── */}
                {days.map((d, i) => (
                  <g key={i}>
                    <rect x={d.x} y={22} width={d.w} height={22} fill={d.fill} />
                    {d.w > 14 && (
                      <text x={d.x + d.w / 2} y={36} textAnchor="middle" fontSize={8} fill="#888888">{d.label}</text>
                    )}
                    <line x1={d.x} y1={22} x2={d.x} y2={svgH} stroke="var(--color-border-tertiary)" strokeWidth={0.3} opacity={0.4} />
                  </g>
                ))}
                <line x1={0} y1={HDR_H} x2={CHART_W} y2={HDR_H} stroke="var(--color-border-secondary)" strokeWidth={0.5} />

                {filtered.map((t, i) => {
                  const rx = bx(t.startDate);
                  const rw = bw(t.startDate, t.endDate);
                  const ry = HDR_H + i * ROW_H + 6;
                  const rh = ROW_H - 12;
                  const col = STATUS_COLORS[t.status] || "#888";
                  const light = STATUS_LIGHT[t.status] || "#eee";
                  const prog = Math.min(100, t.progressPercent || 0) / 100;
                  const showDates = rw > 120;
                  return (
                    <g key={t.id}>
                      {!showDates && (
                        <title>{`#${t.id} · ${t.title} · inicio: ${fmtFull(t.startDate)} → fin: ${fmtFull(t.endDate)} · progreso: ${Number(t.progressPercent || 0).toFixed(0)}%`}</title>
                      )}
                      <rect x={rx} y={ry} width={rw} height={rh} rx={3} fill={col} opacity={0.25} stroke={col} strokeWidth={1.5} />
                      <rect x={rx} y={ry} width={rw * prog} height={rh} rx={3} fill={col} opacity={1} />
                      {showDates ? (
                        <text x={rx + rw / 2} y={ry + rh / 2 + 3} textAnchor="middle" fontSize={9} fontWeight="700" fill="#ffffff" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                          {fmtShort(t.startDate)} → {fmtShort(t.endDate)}
                        </text>
                      ) : rw > 30 ? (
                        <text x={rx + 5} y={ry + rh / 2 + 4} fontSize={9} fontWeight="500" fill={col}>
                          {Number(t.progressPercent || 0).toFixed(0)}%
                        </text>
                      ) : null}
                      <line x1={0} y1={HDR_H + (i + 1) * ROW_H} x2={CHART_W} y2={HDR_H + (i + 1) * ROW_H} stroke="var(--color-border-tertiary)" strokeWidth={0.5} />
                    </g>
                  );
                })}

                {todayX >= 0 && todayX <= CHART_W && (
                  <g>
                    <line x1={todayX} y1={0} x2={todayX} y2={svgH} stroke="#ec6c04" strokeWidth={1.5} strokeDasharray="4,3" />
                    <rect x={todayX - 12} y={2} width={24} height={14} rx={3} fill="#ec6c04" />
                    <text x={todayX} y={12} textAnchor="middle" fontSize={8} fontWeight="700" fill="#fff">HOY</text>
                  </g>
                )}
              </svg>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "10px 14px", borderTop: "0.5px solid var(--color-border-tertiary)" }}>
            {ESTADOS.map((s) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_COLORS[s] }} />
                <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MetricsTab ────────────────────────────────────────────
function MetricsTab({ tasks, participants, indicators }) {
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

    const byType = {};
    TIPOS.forEach((tp) => (byType[tp] = 0));
    filtered.forEach((t) => { byType[t.type] = (byType[t.type] || 0) + 1; });

    const byIndicator = {};
    const ptsByIndicator = {};
    let totalPts = 0;
    filtered.forEach((t) => {
      const pts = t.difficulty || 0;
      totalPts += pts;
      if (t.indicator) {
        byIndicator[t.indicator] = (byIndicator[t.indicator] || 0) + 1;
        ptsByIndicator[t.indicator] = (ptsByIndicator[t.indicator] || 0) + pts;
      }
    });

    const timeByType = {};
    TIPOS.forEach((tp) => (timeByType[tp] = []));
    filtered.filter((t) => t.status === "Finalizada" && t.startDate && t.endDate).forEach((t) => {
      timeByType[t.type].push(daysBetween(t.startDate, t.endDate));
    });
    const avgTimeByType = {};
    Object.entries(timeByType).forEach(([tp, arr]) => {
      avgTimeByType[tp] = arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : null;
    });

    const eligible = filtered.filter((t) => t.status !== "Cancelada" && t.status !== "No programada");
    const finalizadas = filtered.filter((t) => t.status === "Finalizada");
    const completionPct = eligible.length > 0 ? +((finalizadas.length / eligible.length) * 100).toFixed(1) : 0;

    return { byStatus, byType, byIndicator, ptsByIndicator, totalPts, avgTimeByType, completionPct, finalizadas: finalizadas.length, eligible: eligible.length };
  }, [filtered]);

  const ss = { background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-secondary)", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: "pointer", outline: "none", fontFamily: "inherit" };
  const si = { ...ss, color: "var(--color-text-primary)" };

  const Sec = ({ title, children }) => (
    <div style={{ background: "#ffffff", border: "none", borderRadius: 14, padding: 18, marginBottom: 12, boxShadow: "0 2px 14px rgba(84,44,156,0.07)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#542c9c", marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );

  const MetCard = ({ label, value, color = "var(--color-text-primary)" }) => (
    <div style={{ background: "#ffffff", borderRadius: 10, padding: "14px 16px", boxShadow: "0 2px 10px rgba(84,44,156,0.08)" }}>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, color }}>{value}</div>
    </div>
  );

  const Row = ({ label, value, color, light }) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "7px 10px", borderRadius: 6, borderLeft: `3px solid ${color}`,
      background: light, marginBottom: 5,
    }}>
      <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 500, color }}>{value}</span>
    </div>
  );

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
            <MetCard label="Total tareas" value={filtered.length} />
            <MetCard label="Finalizadas" value={metrics.finalizadas} color="#3B6D11" />
            <MetCard label="Puntos totales" value={metrics.totalPts} color="#BA7517" />
          </div>

          <Sec title="Tareas por estado">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
              {ESTADOS.map((s) => metrics.byStatus[s] > 0 && (
                <Row key={s} label={s} value={metrics.byStatus[s]} color={STATUS_COLORS[s]} light={STATUS_LIGHT[s]} />
              ))}
            </div>
          </Sec>

          <Sec title="Tareas por tipo">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
              {TIPOS.map((tp) => metrics.byType[tp] > 0 && (
                <Row key={tp} label={tp} value={metrics.byType[tp]} color={TYPE_COLORS[tp]} light="var(--color-background-secondary)" />
              ))}
            </div>
          </Sec>

          {Object.keys(metrics.byIndicator).length > 0 && (
            <Sec title="Tareas e indicadores clave">
              {Object.entries(metrics.byIndicator).map(([ind, cnt]) => (
                <div key={ind} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", background: "var(--color-background-secondary)", borderRadius: 6, marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text-primary)" }}>{ind}</span>
                  <div style={{ display: "flex", gap: 20 }}>
                    <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{cnt} tareas</span>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "#BA7517" }}>{metrics.ptsByIndicator[ind] || 0} pts</span>
                  </div>
                </div>
              ))}
            </Sec>
          )}

          <Sec title="Tiempo promedio de resolución (días · solo tareas Finalizadas)">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 6 }}>
              {TIPOS.map((tp) => metrics.avgTimeByType[tp] !== null && (
                <div key={tp} style={{ padding: "8px 10px", background: "var(--color-background-secondary)", borderRadius: 6, borderLeft: `3px solid ${TYPE_COLORS[tp]}` }}>
                  <div style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{tp}</div>
                  <div style={{ fontSize: 18, fontWeight: 500, color: "var(--color-text-primary)" }}>{metrics.avgTimeByType[tp]} días</div>
                </div>
              ))}
            </div>
          </Sec>

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
        </>
      )}
    </div>
  );
}

// ─── WeightCalculator ──────────────────────────────────────
function WeightCalculator({ weights, setWeights }) {
  const [local, setLocal] = useState({ ...weights });
  const [inputVals, setInputVals] = useState({
    tiempo: String(weights.tiempo),
    dificultad: String(weights.dificultad),
    estrategico: String(weights.estrategico),
  });

  useEffect(() => {
    setInputVals({
      tiempo: String(local.tiempo),
      dificultad: String(local.dificultad),
      estrategico: String(local.estrategico),
    });
  }, [local.tiempo, local.dificultad, local.estrategico]);

  const handleChange = (key, rawVal) => {
    const val = Math.min(100, Math.max(0, Number(rawVal) || 0));
    const other = Object.keys(local).filter((k) => k !== key);
    const remaining = 100 - val;
    const sumOther = local[other[0]] + local[other[1]];
    let a, b;
    if (sumOther === 0) {
      a = Math.floor(remaining / 2);
      b = remaining - a;
    } else {
      a = Math.round((local[other[0]] / sumOther) * remaining);
      b = remaining - a;
    }
    const next = { ...local, [key]: val, [other[0]]: a, [other[1]]: b };
    setLocal(next);
    return next;
  };

  const commit = (next) => {
    const scrollY = window.scrollY;
    setWeights(next || { ...local });
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  };

  const labels = {
    tiempo: "Tiempo estimado",
    dificultad: "Dificultad estimada",
    estrategico: "Valor estratégico",
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {Object.keys(local).map((key) => (
        <div key={key}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 6, fontSize: 12,
            color: "#542c9c", fontWeight: 600,
          }}>
            <span>{labels[key]}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={inputVals[key]}
                onChange={(e) => {
                  setInputVals((prev) => ({ ...prev, [key]: e.target.value }));
                }}
                onBlur={(e) => {
                  const next = handleChange(key, e.target.value);
                  commit(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const next = handleChange(key, e.target.value);
                    commit(next);
                    e.target.blur();
                  }
                }}
                style={{
                  width: 54,
                  textAlign: "center",
                  border: "0.5px solid var(--color-border-secondary)",
                  borderRadius: 6,
                  padding: "3px 5px",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                  background: "var(--color-background-secondary)",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>%</span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={local[key]}
            onChange={(e) => handleChange(key, e.target.value)}
            onMouseUp={(e) => {
              const next = handleChange(key, e.target.value);
              commit(next);
            }}
            onTouchEnd={(e) => {
              const next = handleChange(key, e.target.value);
              commit(next);
            }}
            style={{
              width: "100%",
              cursor: "pointer",
              accentColor: "#ec6c04",
              touchAction: "none",
            }}
          />
        </div>
      ))}
      <div style={{
        fontSize: 12,
        color: "#ffffff",
        textAlign: "center",
        background: "#1a1a2e",
        borderRadius: 8,
        padding: "8px 12px",
        fontWeight: 600,
      }}>
        Total: {local.tiempo + local.dificultad + local.estrategico}%
      </div>
    </div>
  );
}

// ─── ConfigTab ─────────────────────────────────────────────
function ConfigTab({ participants, setParticipants, indicators, setIndicators, weights, setWeights }) {
  const [newP, setNewP] = useState("");
  const [newI, setNewI] = useState("");

  const addP = () => {
    const name = newP.trim();
    if (!name || participants.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    setParticipants((prev) => [...prev, { id: Date.now(), name, isSuperUser: false }]);
    setNewP("");
  };
  const toggleSuper = (id) => {
    const target = participants.find((p) => p.id === id);
    if (!target) return;
    if (target.name === "Jeferson Marmolejo") return;
    setParticipants((prev) => prev.map((p) => {
      if (p.id === id) return { ...p, isSuperUser: true };
      return { ...p, isSuperUser: false };
    }));
  };
  const removeP = (id) => { if (confirm("¿Eliminar participante?")) setParticipants((prev) => prev.filter((p) => p.id !== id)); };

  const addI = () => {
    const name = newI.trim();
    if (!name || indicators.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    setIndicators((prev) => [...prev, { id: Date.now(), name }]);
    setNewI("");
  };
  const removeI = (id) => { if (confirm("¿Eliminar indicador?")) setIndicators((prev) => prev.filter((i) => i.id !== id)); };

  const si = { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-primary)", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", flex: 1 };
  const addBtn = { background: "linear-gradient(135deg, #542c9c, #6e3ebf)", border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, boxShadow: "0 3px 10px rgba(84,44,156,0.3)" };

  const Sec = ({ title, children }) => (
    <div style={{ background: "#ffffff", border: "none", borderRadius: 14, padding: 20, boxShadow: "0 2px 16px rgba(84,44,156,0.07)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#542c9c", marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}>
      <Sec title="👥 Participantes">
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input style={si} value={newP} onChange={(e) => setNewP(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addP()} placeholder="Nombre del participante..." />
          <button onClick={addP} style={addBtn}>Agregar</button>
        </div>
        {participants.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center" }}>No hay participantes aún.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {participants.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fafafa", borderRadius: 8, border: "1px solid rgba(84,44,156,0.08)" }}>
                <div style={{
                  width: 32, height: 32, borderRadius: "50%",
                  background: p.isSuperUser ? "linear-gradient(135deg, #ec6c04, #f07d1e)" : "linear-gradient(135deg, #542c9c, #6e3ebf)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700, color: "#ffffff",
                }}>
                  {p.name.slice(0, 2).toUpperCase()}
                </div>
                <span style={{ flex: 1, fontSize: 13, color: "var(--color-text-primary)" }}>{p.name}</span>
                {p.isSuperUser && (
                  <span style={{ fontSize: 10, background: "linear-gradient(135deg, #ec6c04, #f07d1e)", color: "#ffffff", padding: "2px 8px", borderRadius: 8, fontWeight: 700 }}>
                    SUPER
                  </span>
                )}
                <button
                  onClick={() => p.name !== "Jeferson Marmolejo" && toggleSuper(p.id)}
                  style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-secondary)", borderRadius: 6, padding: "3px 9px", cursor: p.name === "Jeferson Marmolejo" ? "not-allowed" : "pointer", fontSize: 11 }}
                >
                  {p.name === "Jeferson Marmolejo" ? "Super fijo" : p.isSuperUser ? "Quitar super" : "Hacer super"}
                </button>
                <button onClick={() => removeP(p.id)} style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", color: "var(--color-text-danger)", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Sec>

      <Sec title="📊 Indicadores clave">
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input style={si} value={newI} onChange={(e) => setNewI(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addI()} placeholder="Nombre del indicador..." />
          <button onClick={addI} style={addBtn}>Agregar</button>
        </div>
        {indicators.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center" }}>No hay indicadores aún.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {indicators.map((ind) => (
              <div key={ind.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fafafa", borderRadius: 8, border: "1px solid rgba(84,44,156,0.08)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #542c9c, #149cac)", flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: "var(--color-text-primary)" }}>{ind.name}</span>
                <button onClick={() => removeI(ind.id)} style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", color: "var(--color-text-danger)", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Sec>

      <Sec title="⚖️ Calculadora de Valor de Aporte">
        <WeightCalculator weights={weights} setWeights={setWeights} />
      </Sec>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────
const DEFAULT_WEIGHTS = { tiempo: 33, dificultad: 34, estrategico: 33 };

export default function App() {
  const saved = loadState();
  const [tasks, setTasks] = useState(saved?.tasks || []);
  const [participants, setParticipants] = useState(
    saved?.participants?.length ? saved.participants : [{ id: 1, name: "Jeferson Marmolejo", isSuperUser: true }]
  );
  const [indicators, setIndicators] = useState(saved?.indicators || []);
  const [nextId, setNextId] = useState(saved?.nextId || 1);
  const [activeTab, setActiveTab] = useState("board");
  const [currentUserId, setCurrentUserId] = useState(saved?.currentUserId || null);
  const [weights, setWeights] = useState(saved?.weights || DEFAULT_WEIGHTS);
  const [configUnlocked, setConfigUnlocked] = useState(false);
  const [configPin, setConfigPin] = useState("");
  const [pinError, setPinError] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks, participants, indicators, nextId, currentUserId, weights }));
    } catch {}
  }, [tasks, participants, indicators, nextId, currentUserId, weights]);

  const currentUser = useMemo(() => participants.find((p) => p.id === currentUserId) || null, [participants, currentUserId]);

  const exportXLSX = () => {
    if (tasks.length === 0) { alert("No hay tareas para exportar."); return; }
    const data = tasks.map((t) => ({
      "ID": t.id,
      "Valor de Aporte": t.aporteSnapshot ?? "—",
      "Fecha de creación": t.createdAt,
      "Indicador que impacta": t.indicator,
      "Título": t.title,
      "Tipo": t.type,
      "Estado": t.status,
      "Validación cierre": t.validationClose || "",
      "Fecha de inicio": t.startDate,
      "Fecha de fin": t.endDate,
      "Tiempo estimado (★)": t.estimatedTime,
      "Dificultad estimada (★)": t.difficulty,
      "Valor estratégico (★)": t.strategicValue,
      "Avance condicionado ext.": t.extProgress1,
      "Avance condicionado int.": t.extProgress2,
      "Entrega esperada": t.expectedDelivery,
      "Responsable": t.responsible,
      "Comentarios": t.comments,
      "Porcentaje de avance": `${Number(t.progressPercent || 0).toFixed(1)}%`,
      "Subtareas": t.subtasks.filter(Boolean).join(" | "),
      "Tarea dependiente (ID)": t.dependentTask || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tareas");
    XLSX.writeFile(wb, `w_planner_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const TABS = [
    { id: "board", label: "Tablero" },
    { id: "gantt", label: "Gantt" },
    { id: "metrics", label: "Métricas" },
    { id: "config", label: "Configuración" },
  ];

  return (
    <>
    <style>{`
      @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes shimmer { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    `}</style>
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #f8f4ff 0%, #e6f7f8 50%, #fff3ea 100%)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}>
      <div style={{ background: "linear-gradient(90deg, #1a1a2e 0%, #2d1b4e 100%)", boxShadow: "0 2px 0 #ec6c04", padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, fontSize: 18, display: "flex", alignItems: "center", gap: 2 }}>
          <span style={{ background: "linear-gradient(135deg, #ec6c04, #f07d1e)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>W</span>
          <span style={{ color: "#ffffff", fontWeight: 300, fontSize: 16 }}> Planner</span>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ec6c04", marginLeft: 6, animation: "pulse 2s ease-in-out infinite", display: "inline-block" }} />
        </div>
        <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.15)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Usuario activo:</span>
          <select
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", color: "#ffffff", borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer", outline: "none", fontFamily: "inherit" }}
            value={currentUserId || ""}
            onChange={(e) => setCurrentUserId(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="" style={{ background: "#1a1a2e" }}>— Seleccionar usuario —</option>
            {participants.map((p) => (
              <option key={p.id} value={p.id} style={{ background: "#1a1a2e" }}>{p.name}{p.isSuperUser ? " ★" : ""}</option>
            ))}
          </select>
          {currentUser?.isSuperUser && (
            <span style={{ fontSize: 10, background: "linear-gradient(135deg, #ec6c04, #f07d1e)", color: "#ffffff", padding: "2px 8px", borderRadius: 8, fontWeight: 700 }}>
              SUPER USUARIO
            </span>
          )}
        </div>
        <button onClick={exportXLSX} style={{
          marginLeft: "auto",
          background: "rgba(20,156,172,0.2)",
          border: "1px solid rgba(20,156,172,0.5)",
          color: "#4dd8e8",
          borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 500,
        }}>
          ↓ Exportar XLSX
        </button>
      </div>

      <div style={{ background: "#ffffff", borderBottom: "1px solid #e8e0f4", padding: "0 20px", display: "flex", gap: 0, boxShadow: "0 2px 8px rgba(84,44,156,0.06)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { if (tab.id !== "config") setConfigUnlocked(false); setActiveTab(tab.id); }}
            style={{
              background: "none", border: "none",
              borderBottom: activeTab === tab.id ? "2.5px solid #542c9c" : "2.5px solid transparent",
              color: activeTab === tab.id ? "#542c9c" : "#888888",
              padding: "11px 18px", cursor: "pointer", fontSize: 13,
              fontWeight: activeTab === tab.id ? 700 : 500,
              transition: "all 0.15s", fontFamily: "inherit",
            }}
          >{tab.label}</button>
        ))}
      </div>

      <div style={{ padding: "20px 20px 40px" }}>
        {activeTab === "board" && (
          <BoardTab tasks={tasks} setTasks={setTasks} participants={participants} indicators={indicators} currentUser={currentUser} nextId={nextId} setNextId={setNextId} weights={weights} />
        )}
        {activeTab === "gantt" && <GanttTab tasks={tasks} indicators={indicators} />}
        {activeTab === "metrics" && <MetricsTab tasks={tasks} participants={participants} indicators={indicators} />}
        {activeTab === "config" && (
          configUnlocked ? (
            <ConfigTab participants={participants} setParticipants={setParticipants} indicators={indicators} setIndicators={setIndicators} weights={weights} setWeights={setWeights} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 340, gap: 16 }}>
              <div style={{ background: "#ffffff", borderRadius: 16, padding: "32px 36px", boxShadow: "0 4px 32px rgba(84,44,156,0.12)", border: "1px solid rgba(84,44,156,0.12)", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, minWidth: 300 }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, #542c9c, #6e3ebf)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, color: "#fff" }}>🔒</div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#542c9c", marginBottom: 4 }}>Acceso restringido</div>
                  <div style={{ fontSize: 12, color: "#969696" }}>Ingresa la clave para acceder a Configuración</div>
                </div>
                <input
                  type="password"
                  placeholder="Clave de acceso"
                  value={configPin}
                  onChange={(e) => { setConfigPin(e.target.value); setPinError(false); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (configPin === CONFIG_PIN) { setConfigUnlocked(true); setConfigPin(""); setPinError(false); }
                      else { setPinError(true); setConfigPin(""); }
                    }
                  }}
                  style={{ width: "100%", border: pinError ? "1.5px solid #c0392b" : "1.5px solid #e0e0e0", borderRadius: 8, padding: "10px 14px", fontSize: 14, textAlign: "center", letterSpacing: "0.2em", outline: "none", background: pinError ? "#fde8e8" : "#fafafa", color: "#2d2d2d", fontFamily: "inherit", transition: "border-color 0.2s" }}
                  autoFocus
                />
                {pinError && (
                  <div style={{ fontSize: 12, color: "#c0392b", fontWeight: 500 }}>Clave incorrecta. Intenta de nuevo.</div>
                )}
                <button
                  onClick={() => {
                    if (configPin === CONFIG_PIN) { setConfigUnlocked(true); setConfigPin(""); setPinError(false); }
                    else { setPinError(true); setConfigPin(""); }
                  }}
                  style={{ width: "100%", background: "linear-gradient(135deg, #542c9c, #6e3ebf)", color: "#ffffff", border: "none", borderRadius: 8, padding: "10px", fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 3px 12px rgba(84,44,156,0.3)" }}
                >
                  Ingresar
                </button>
              </div>
            </div>
          )
        )}
      </div>
      <div style={{ position: "fixed", bottom: 12, left: 16, display: "flex", flexDirection: "column", gap: 1, zIndex: 50 }}>
        <span style={{ fontSize: 10, color: "#969696", fontWeight: 400, letterSpacing: "0.03em" }}>Desarrollado por Jeferson Marmolejo</span>
        <span style={{ fontSize: 9, color: "#b0b0b0", letterSpacing: "0.05em" }}>W Planner v1.0.0</span>
      </div>
    </div>
    </>
  );
}
