import { useState, useEffect, useMemo, useRef, memo } from "react";
import { supabase } from './supabaseClient';

const getAuthJsonHeaders = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Debes iniciar sesión nuevamente.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  };
};

const joinProjectByCode = async (code, user) => {
  const inviteCode = String(code || "").trim();
  if (!inviteCode) return null;

  const { data: joined, error: rpcError } = await supabase.rpc(
    "join_project_by_invite_code",
    { invite_code_input: inviteCode }
  );
  if (!rpcError && joined) return joined;

  const { data: proj } = await supabase.from('projects').select('*').eq('invite_code', inviteCode).single();
  if (!proj) return null;
  if (user) {
    await supabase.from('project_members').upsert(
      { project_id: proj.id, email: user.email, name: user.user_metadata?.full_name || user.email, user_id: user.id },
      { onConflict: 'project_id,email' }
    );
  }
  return proj;
};

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
const DEFAULT_TASK_TYPES = [...TIPOS];
const ESTADOS = ["No programada","Sin iniciar","En proceso","Bloqueada","En pausa","Cancelada","Finalizada"];
const CLOSE_STATES = ["Finalizada","Cancelada"];
const DEFAULT_PIN = "020419*";
const DEFAULT_DIMENSIONS = [
  { key: "tiempo",      label: "Tiempo estimado",   weight: 33, builtin: true },
  { key: "dificultad",  label: "Dificultad",         weight: 34, builtin: true },
  { key: "estrategico", label: "Valor estratégico",  weight: 33, builtin: true },
];

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

// ─── calcAporte ────────────────────────────────────────────
// Supports both array dimensions and legacy {tiempo,dificultad,estrategico} object
const calcAporte = (task, weights) => {
  if (Array.isArray(weights)) {
    return weights.reduce((sum, dim) => {
      const val = dim.key === 'tiempo'      ? (task.estimatedTime  || 1)
                : dim.key === 'dificultad'  ? (task.difficulty     || 1)
                : dim.key === 'estrategico' ? (task.strategicValue || 1)
                : (task.dimensionValues?.[dim.key] ?? 5);
      return sum + val * (dim.weight || 0);
    }, 0) / 100;
  }
  return ((task.estimatedTime || 1) * (weights.tiempo      || 0) +
          (task.difficulty    || 1) * (weights.dificultad  || 0) +
          (task.strategicValue|| 1) * (weights.estrategico || 0)) / 100;
};

/**
 * Calcula el porcentaje de avance basado en subtareas.
 * Retorna null si no hay subtareas (modo manual).
 */
const calcProgressFromSubtasks = (subtasks) => {
  if (!subtasks || subtasks.length === 0) return null;
  const done = subtasks.filter((s) => s.done).length;
  return parseFloat(((done / subtasks.length) * 100).toFixed(1));
};

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
// ── Custom field helpers ──────────────────────────────────────
// Auto fields (type='auto') derive their value from a fixed source column on
// the task row. Allowed sources are fixed in DB/UI to keep the contract tight.
const AUTO_FIELD_SOURCES = {
  created_at:       (task) => task.createdAt || '',
  updated_at:       (task) => task.updatedAt ? new Date(task.updatedAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false }) : '',
  closed_at:        (task) => task.closedAt ? new Date(task.closedAt).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false }) : '',
  last_modified_by: (task) => task.lastModifiedBy || '',
};
const AUTO_FIELD_SOURCE_LABELS = {
  created_at:       'Fecha de creación',
  updated_at:       'Última modificación',
  closed_at:        'Fecha de cierre',
  last_modified_by: 'Último usuario que modificó',
};

// Returns the visible value of a custom field given the task and the def.
// Used by both the form and (later) the card / CSV / report layers.
function readCustomFieldValue(def, task) {
  if (!def) return undefined;
  if (def.type === 'auto') {
    const src = def.config?.source;
    const fn = AUTO_FIELD_SOURCES[src];
    return fn ? fn(task) : '';
  }
  const v = task?.customFields?.[def.key];
  if (v === undefined || v === null) {
    if (def.type === 'multiselect' || def.type === 'subitems') return [];
    return '';
  }
  return v;
}

// CustomFieldsRenderer — renders a list of field defs as form inputs in
// `edit` mode or as labeled read-only values in `view` mode. Designed to be
// dropped inside the existing TaskForm grid (gridColumn: span 1 or span 2
// depending on def.config.half).
function CustomFieldsRenderer({ defs, task, onChange, mode = 'edit' }) {
  if (!Array.isArray(defs) || !defs.length) return null;
  const active = defs.filter(d => !d.deleted_at);
  if (!active.length) return null;

  const inpLocal = {
    background: '#fafafa', border: '1.5px solid #e0e0e0', borderRadius: 8,
    color: '#2d2d2d', padding: '8px 12px', fontSize: 13, width: '100%',
    boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };
  const readonlyLocal = { ...inpLocal, background: '#f4f4f4', color: '#969696', cursor: 'default', border: '1.5px solid #e8e8e8' };

  const fieldWrap = (def, children) => (
    <div key={def.id} style={{ gridColumn: def.config?.half ? 'span 1' : 'span 2' }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#542c9c', marginBottom: 5 }}>
        {def.label}{def.required && def.type !== 'auto' ? ' *' : ''}
      </label>
      {children}
    </div>
  );

  const setVal = (key, val) => onChange && onChange(key, val);

  return (
    <>
      {active.map(def => {
        const value = readCustomFieldValue(def, task);

        if (def.type === 'auto') {
          return fieldWrap(def, <input style={readonlyLocal} readOnly value={value || ''} />);
        }

        if (mode === 'view') {
          // Compact read-only rendering for view-only contexts (detail panels).
          let display = '';
          if (def.type === 'multiselect' && Array.isArray(value)) display = value.join(', ');
          else if (def.type === 'subitems' && Array.isArray(value)) display = `${value.filter(i => i.done).length}/${value.length} completados`;
          else display = String(value ?? '');
          return fieldWrap(def, <input style={readonlyLocal} readOnly value={display} />);
        }

        if (def.type === 'text') {
          return fieldWrap(def, (
            <input
              style={inpLocal}
              value={value || ''}
              maxLength={def.config?.maxLength || 200}
              placeholder={def.config?.placeholder || ''}
              onChange={(e) => setVal(def.key, e.target.value)}
            />
          ));
        }

        if (def.type === 'textarea') {
          return fieldWrap(def, (
            <textarea
              style={{ ...inpLocal, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }}
              value={value || ''}
              maxLength={def.config?.maxLength || 2000}
              placeholder={def.config?.placeholder || ''}
              onChange={(e) => setVal(def.key, e.target.value)}
            />
          ));
        }

        if (def.type === 'date') {
          return fieldWrap(def, (
            <input
              type="date"
              style={inpLocal}
              value={value || ''}
              onChange={(e) => setVal(def.key, e.target.value)}
            />
          ));
        }

        if (def.type === 'select') {
          const options = Array.isArray(def.config?.options) ? def.config.options : [];
          return fieldWrap(def, (
            <select style={inpLocal} value={value || ''} onChange={(e) => setVal(def.key, e.target.value)}>
              <option value="">— Sin valor —</option>
              {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              {value && !options.includes(value) && <option value={value}>{value}</option>}
            </select>
          ));
        }

        if (def.type === 'multiselect') {
          const options = Array.isArray(def.config?.options) ? def.config.options : [];
          const selected = Array.isArray(value) ? value : [];
          const max = def.config?.maxSelections || options.length || 20;
          return fieldWrap(def, (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {options.length === 0 && (
                <span style={{ fontSize: 12, color: '#9ca3af' }}>Sin opciones configuradas.</span>
              )}
              {options.map(opt => {
                const isSel = selected.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      if (isSel) setVal(def.key, selected.filter(s => s !== opt));
                      else if (selected.length < max) setVal(def.key, [...selected, opt]);
                    }}
                    style={{
                      padding: '5px 10px', borderRadius: 999, fontSize: 12,
                      border: isSel ? '1.5px solid #542c9c' : '1px solid #d4d4d8',
                      background: isSel ? '#ede8f8' : '#fafafa',
                      color: isSel ? '#542c9c' : '#525252',
                      cursor: 'pointer', fontWeight: isSel ? 600 : 500, fontFamily: 'inherit',
                    }}
                  >
                    {isSel && <span style={{ marginRight: 4 }}>✓</span>}{opt}
                  </button>
                );
              })}
              {selected.length >= max && (
                <span style={{ fontSize: 11, color: '#9ca3af', alignSelf: 'center' }}>Máximo {max} selecciones</span>
              )}
            </div>
          ));
        }

        if (def.type === 'subitems') {
          const items = Array.isArray(value) ? value : [];
          const max = def.config?.maxItems || 20;
          const update = (next) => setVal(def.key, next);
          return fieldWrap(def, (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map((it, i) => (
                // Use a stable per-item uid so editing/deleting one row
                // does not steal focus from another.
                <div key={it.uid || `idx-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!it.done}
                    onChange={() => {
                      const arr = items.map((x, idx) => idx === i ? { ...x, done: !x.done } : x);
                      update(arr);
                    }}
                  />
                  <input
                    style={{ ...inpLocal, flex: 1 }}
                    value={it.text || ''}
                    onChange={(e) => {
                      const arr = items.map((x, idx) => idx === i ? { ...x, text: e.target.value } : x);
                      update(arr);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => update(items.filter((_, idx) => idx !== i))}
                    style={{ background: '#fde8e8', border: '1px solid #f5c6c6', color: '#c0392b', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
                  >✕</button>
                </div>
              ))}
              {items.length < max && (
                <button
                  type="button"
                  onClick={() => {
                    const uid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    update([...items, { uid, text: '', done: false }]);
                  }}
                  style={{ alignSelf: 'flex-start', background: '#f5f0ff', border: '1px dashed #a78bda', color: '#542c9c', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >+ Agregar sub-ítem</button>
              )}
            </div>
          ));
        }

        // Unknown type — render as plain readonly for forward compat.
        return fieldWrap(def, <input style={readonlyLocal} readOnly value={typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')} />);
      })}
    </>
  );
}

function TaskForm({ task, setTask, participants, indicators, taskTypes, currentUser, weights, dimensions, keyResults = [], sprints = [], taskHistory = [], tasks = [], customFieldDefs = [] }) {
  const isOtra = task.type === "Otra";
  const isClose = CLOSE_STATES.includes(task.status);
  const isSuperUser = currentUser?.isSuperUser;
  const typeOptions = taskTypes.length ? taskTypes.map((t) => t.name) : DEFAULT_TASK_TYPES;
  const [depInput, setDepInput] = useState("");

  const upd = (key, val) =>
    setTask((prev) => {
      const next = { ...prev, [key]: val };
      if (key === "status" && CLOSE_STATES.includes(val)) next.validationClose = val;
      return next;
    });

  const addSubtask = () => {
    if (task.subtasks.length < 20) {
      const nextSubtasks = [...task.subtasks, { text: "", done: false }];
      const autoProgress = calcProgressFromSubtasks(nextSubtasks);
      upd("subtasks", nextSubtasks);
      if (autoProgress !== null) upd("progressPercent", autoProgress);
    }
  };
  const updSubtask = (i, v) => {
    const arr = [...task.subtasks];
    arr[i] = { ...arr[i], text: v };
    const autoProgress = calcProgressFromSubtasks(arr);
    upd("subtasks", arr);
    if (autoProgress !== null) upd("progressPercent", autoProgress);
  };
  const toggleSubtask = (i) => {
    const arr = [...task.subtasks];
    arr[i] = { ...arr[i], done: !arr[i].done };
    const autoProgress = calcProgressFromSubtasks(arr);
    upd("subtasks", arr);
    if (autoProgress !== null) upd("progressPercent", autoProgress);
  };
  const delSubtask = (i) => {
    const arr = task.subtasks.filter((_, idx) => idx !== i);
    const autoProgress = calcProgressFromSubtasks(arr);
    upd("subtasks", arr);
    if (autoProgress !== null) upd("progressPercent", autoProgress);
  };

  const activeDims = Array.isArray(dimensions) && dimensions.length ? dimensions : weights;
  const isNew = task.aporteSnapshot === null || task.aporteSnapshot === undefined;
  const aporteDisplay = isNew
    ? (activeDims && task.type !== "Otra" ? calcAporte(task, activeDims).toFixed(1) : null)
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
          {typeOptions.map((t) => <option key={t}>{t}</option>)}
          {task.type && !typeOptions.includes(task.type) && (
            <option value={task.type}>{task.type}</option>
          )}
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
            <div>
              {/* Chips de selección */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: (task.indicators && task.indicators.length > 0) ? 12 : 0 }}>
                {indicators.length === 0 ? (
                  <span style={{ fontSize: 13, color: '#9ca3af' }}>
                    No hay indicadores configurados
                  </span>
                ) : (
                  indicators.map((ind) => {
                    const selected = task.indicators || [];
                    const idx = selected.findIndex((s) => s.name === ind.name);
                    const isSelected = idx !== -1;
                    const isPrimary = idx === 0;
                    const chipClass = isPrimary
                      ? 'indicator-chip chip-primary'
                      : isSelected
                      ? 'indicator-chip chip-sub'
                      : 'indicator-chip';

                    return (
                      <button
                        key={ind.id}
                        type="button"
                        className={chipClass}
                        onClick={() => {
                          let newIndicators = [...(task.indicators || [])];
                          if (isSelected) {
                            newIndicators = newIndicators.filter((s) => s.name !== ind.name);
                            if (newIndicators.length > 0) {
                              newIndicators[0] = { ...newIndicators[0], isPrimary: true };
                            }
                          } else {
                            newIndicators.push({
                              name: ind.name,
                              isPrimary: newIndicators.length === 0,
                            });
                          }
                          upd('indicators', newIndicators);
                          upd('indicator', newIndicators[0]?.name || '');
                        }}
                      >
                        {isSelected && <span className="chip-dot" />}
                        <span>{ind.name}</span>
                        {isPrimary && <span className="chip-badge-primary">Principal</span>}
                        {isSelected && !isPrimary && <span className="chip-badge-sub">Sub-aporte</span>}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Resumen de seleccionados */}
              {task.indicators && task.indicators.length > 0 && (
                <div style={{
                  borderTop: '1px solid #f3f4f6',
                  paddingTop: 10,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  alignItems: 'center',
                }}>
                  <span style={{ fontSize: 11, color: '#9ca3af', marginRight: 2 }}>Seleccionados:</span>
                  {task.indicators.map((ind, i) => (
                    <span
                      key={ind.name}
                      className={`chip-summary-pill ${i === 0 ? 'pill-primary' : 'pill-sub'}`}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block', opacity: 0.7 }} />
                      {ind.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Hint cuando no hay nada seleccionado */}
              {(!task.indicators || task.indicators.length === 0) && (
                <p style={{ fontSize: 12, color: '#9ca3af', margin: '6px 0 0 0' }}>
                  El primero que selecciones será el indicador principal
                </p>
              )}
            </div>
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

          {task.finalizedAt && (
            <F label="Fecha de finalización" half>
              <input style={readonlyInp} readOnly value={task.finalizedAt || "—"} />
            </F>
          )}

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

          <div style={{ gridColumn: "span 2" }}>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#542c9c", marginBottom: 10 }}>
              Dimensiones de Aporte (1-10 ★)
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
              {(Array.isArray(dimensions) && dimensions.length ? dimensions : DEFAULT_DIMENSIONS).map((dim) => {
                const taskKey = dim.key === 'tiempo' ? 'estimatedTime' : dim.key === 'dificultad' ? 'difficulty' : dim.key === 'estrategico' ? 'strategicValue' : null;
                const val = taskKey ? (task[taskKey] ?? 5) : (task.dimensionValues?.[dim.key] ?? 5);
                return (
                  <div key={dim.key} style={{ flex: "1 1 155px", minWidth: 140 }}>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#542c9c", marginBottom: 4 }}>
                      {dim.label}
                    </label>
                    <StarRating
                      value={Number(val)}
                      onChange={(v) => {
                        if (taskKey) { upd(taskKey, v); }
                        else { upd('dimensionValues', { ...(task.dimensionValues || {}), [dim.key]: v }); }
                      }}
                    />
                  </div>
                );
              })}
            </div>
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
            {task.subtasks && task.subtasks.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  background: '#f0fdf4', border: '1px solid #86efac',
                  borderRadius: 8, padding: '6px 12px',
                  fontSize: 15, fontWeight: 700, color: '#15803d', minWidth: 70, textAlign: 'center'
                }}>
                  {Number(task.progressPercent || 0).toFixed(1)}%
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>
                  <div>🤖 Calculado automáticamente</div>
                  <div>{(task.subtasks || []).filter(s => s.done).length} de {(task.subtasks || []).length} subtareas completadas</div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={task.progressPercent}
                  onChange={(e) =>
                    upd("progressPercent", Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))
                  }
                  style={inp}
                />
                <span style={{ fontSize: 11, color: '#9ca3af' }}>
                  Añade subtareas para calcular automáticamente
                </span>
              </div>
            )}
          </F>

          <F label="Tareas dependientes (máx. 4)" half={false}>
            {(() => {
              const deps = parseDeps(task.dependentTask);
              const addDep = () => {
                const id = depInput.trim();
                if (!id || deps.length >= 4 || deps.includes(id)) { setDepInput(""); return; }
                upd("dependentTask", [...deps, id].join(','));
                setDepInput("");
              };
              return (
                <div>
                  {deps.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {deps.map(id => {
                        const dt = tasks.find(x => String(x.id) === id);
                        return (
                          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#ede8f8', border: '1px solid #c4b5e8', borderRadius: 20, padding: '4px 10px', fontSize: 12, color: '#542c9c' }}>
                            <span style={{ fontWeight: 700 }}>#{id}</span>
                            {dt && <span style={{ color: '#888', fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dt.title}</span>}
                            <button onClick={() => upd("dependentTask", deps.filter(d => d !== id).join(','))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 4px', color: '#999', fontSize: 16, lineHeight: 1, fontWeight: 700 }}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {deps.length < 4 ? (
                    <input type="number" style={inp} value={depInput}
                      onChange={e => setDepInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDep(); } }}
                      placeholder={deps.length === 0 ? "ID de tarea y presiona Enter..." : "Agregar otra dependencia..."} />
                  ) : (
                    <div style={{ fontSize: 11, color: '#969696', padding: '6px 0' }}>Máximo 4 dependencias alcanzado</div>
                  )}
                </div>
              );
            })()}
          </F>

          {sprints.filter(s => s.status !== 'closed').length > 0 && (
            <F label="Sprint" half>
              <select style={inp} value={task.sprintId || ""} onChange={e => upd("sprintId", e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Sin sprint —</option>
                {sprints.filter(s => s.status !== 'closed').map(s => (
                  <option key={s.id} value={s.id}>[{s.status === 'active' ? '▶' : '◐'}] {s.name}</option>
                ))}
              </select>
            </F>
          )}

          {keyResults.length > 0 && (
            <F label="Resultado clave (OKR)" half>
              <select style={inp} value={task.krId || ""} onChange={e => upd("krId", e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Sin KR —</option>
                {keyResults.map(kr => (
                  <option key={kr.id} value={kr.id}>{kr.title}</option>
                ))}
              </select>
            </F>
          )}

          <F label="Comentarios">
            <textarea
              style={{ ...inp, minHeight: 110, resize: "vertical" }}
              value={task.comments}
              onChange={(e) => upd("comments", e.target.value)}
              placeholder={"¿Qué quieres lograr?\n¿Quién gana con esto?\nPasos 1. 2. 3.\n¿Cómo sabrás que quedó bien?\n¿Qué te puede frenar?"}
            />
          </F>

          {customFieldDefs && customFieldDefs.length > 0 && (
            <CustomFieldsRenderer
              defs={customFieldDefs}
              task={task}
              mode="edit"
              onChange={(key, val) => {
                const nextCustom = { ...(task.customFields || {}), [key]: val };
                upd('customFields', nextCustom);
              }}
            />
          )}

          <F label={`Subtareas (${task.subtasks.length}/20)`}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {task.subtasks.map((st, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={st.done}
                    onChange={() => toggleSubtask(i)}
                    style={{ width: 16, height: 16, accentColor: "#ec6c04", cursor: "pointer", flexShrink: 0 }}
                  />
                  <input
                    style={{ ...inp, flex: 1, textDecoration: st.done ? "line-through" : "none", color: st.done ? "#969696" : undefined }}
                    value={st.text}
                    onChange={(e) => updSubtask(i, e.target.value)}
                    placeholder={`Subtarea ${i + 1}`}
                  />
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
          {taskHistory.length > 0 && (
            <div style={{ gridColumn: "span 2" }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#542c9c", marginBottom: 8 }}>Historial de cambios</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                {taskHistory.map((h) => (
                  <div key={h.id} style={{ display: "flex", gap: 8, fontSize: 11, padding: "5px 8px", background: "#fafafe", borderRadius: 6, border: "1px solid #e8e0f4" }}>
                    <span style={{ color: "#969696", flexShrink: 0 }}>{new Date(h.changed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    <span style={{ color: "#542c9c", fontWeight: 600, flexShrink: 0 }}>{h.changed_by}</span>
                    <span style={{ color: "#888" }}>{h.field_name}:</span>
                    <span style={{ color: "#c0392b", textDecoration: "line-through" }}>{h.old_value || "—"}</span>
                    <span style={{ color: "#888" }}>→</span>
                    <span style={{ color: "#27ae60", fontWeight: 600 }}>{h.new_value || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
function BoardTab({ tasks, createTask, updateTask, deleteTask, participants, indicators, currentUser, weights, taskTypes, dimensions, editTaskFromDep, onDepEditDone, projectId, nextId, keyResults = [], sprints = [], taskFieldDefs = [] }) {
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

  const openNew = async () => {
    try {
      // Intentar reservar ID atómicamente en el servidor
      const { data: claimedId, error } = await supabase.rpc('claim_task_id');
      
      if (error) {
        console.error('[openNew] Error RPC claim_task_id:', error);
        // Fallback: usar nextId local si el RPC falla
        console.warn('[openNew] Usando fallback con nextId local:', nextId);
        setForm(emptyTask(nextId));
        setModal("new");
        return;
      }
      
      if (claimedId === null || claimedId === undefined) {
        console.error('[openNew] RPC retornó null, usando fallback:', nextId);
        setForm(emptyTask(nextId));
        setModal("new");
        return;
      }
      
      console.info('[openNew] ID reservado exitosamente:', claimedId);
      setForm(emptyTask(claimedId));
      setModal("new");
    } catch (err) {
      console.error('[openNew] Error inesperado:', err);
      // Fallback seguro
      setForm(emptyTask(nextId));
      setModal("new");
    }
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
      const activeDimensions = Array.isArray(dimensions) && dimensions.length ? dimensions : weights;
      const newTask = { ...form, aporteSnapshot: parseFloat(calcAporte(form, activeDimensions).toFixed(1)) };
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
          title={modal === "new" ? `Nueva tarea #${form.id}` : `Tarea #${form.id} — ${form.title || "Sin título"}`}
          onClose={() => setModal(null)}
          onSave={save}
          onDelete={modal !== "new" ? del : undefined}
        >
          <TaskForm task={form} setTask={setForm} participants={participants} indicators={indicators} taskTypes={taskTypes} currentUser={currentUser} weights={weights} dimensions={dimensions} keyResults={keyResults} sprints={sprints} taskHistory={taskHistory} tasks={tasks} customFieldDefs={taskFieldDefs} />
        </Modal>
      )}
    </div>
  );
}

// ─── GanttTab ──────────────────────────────────────────────
function GanttTab({ tasks, participants, indicators, taskTypes }) {
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0]; });
  const [dateTo, setDateTo] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() + 2, 0); return d.toISOString().split("T")[0]; });
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [fIndicator, setFIndicator] = useState("");
  const [fParticipant, setFParticipant] = useState("");

  const filtered = useMemo(() => tasks.filter((t) => {
    if (!t.startDate || !t.endDate) return false;
    if (t.endDate < dateFrom || t.startDate > dateTo) return false;
    if (fStatus && t.status !== fStatus) return false;
    if (fType && t.type !== fType) return false;
    if (fIndicator && t.indicator !== fIndicator) return false;
    if (fParticipant && t.responsible !== fParticipant) return false;
    return true;
  }), [tasks, dateFrom, dateTo, fStatus, fType, fIndicator, fParticipant]);

  const startMs = new Date(dateFrom).getTime();
  const endMs = new Date(dateTo).getTime();
  const totalMs = Math.max(1, endMs - startMs);
  const [labelWidth, setLabelWidth] = useState(210);
  const isResizing = useRef(false);
  const CHART_W = 660;
  const HDR_H = 44;
  const getRowH = (title) => title && title.length > (labelWidth / 8) ? 50 : 34;

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
  }, [dateFrom, startMs, endMs, totalMs]);

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
  }, [dateFrom, dateTo, startMs, totalMs]);

  const todayX = ((new Date(today).getTime() - startMs) / totalMs) * CHART_W;
  const bx = (s) => Math.max(0, ((new Date(s).getTime() - startMs) / totalMs) * CHART_W);
  const bw = (s, e) => {
    const a = Math.max(new Date(s).getTime(), startMs);
    const b = Math.min(new Date(e).getTime(), endMs);
    return Math.max(4, ((b - a) / totalMs) * CHART_W);
  };

  const ss = { background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-secondary)", borderRadius: 6, padding: "6px 8px", fontSize: 12, cursor: "pointer", outline: "none", fontFamily: "inherit" };
  const si = { ...ss, color: "var(--color-text-primary)" };
  const totalRowsH = filtered.reduce((a, t) => a + getRowH(t.title), 0);
  const svgH = HDR_H + totalRowsH + 8;

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
          {(taskTypes.length ? taskTypes.map((t) => t.name) : DEFAULT_TASK_TYPES).map((t) => <option key={t}>{t}</option>)}
        </select>
        <select style={ss} value={fIndicator} onChange={(e) => setFIndicator(e.target.value)}>
          <option value="">Todos los indicadores</option>
          {indicators.map((i) => <option key={i.id}>{i.name}</option>)}
        </select>
        <select style={ss} value={fParticipant} onChange={(e) => setFParticipant(e.target.value)}>
          <option value="">Todos los participantes</option>
          {(participants || []).map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
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
                  height: getRowH(t.title), display: "flex", alignItems: "center", padding: "0 10px",
                  borderBottom: "0.5px solid var(--color-border-tertiary)",
                  background: i % 2 === 0 ? "transparent" : "var(--color-background-secondary)",
                }}>
                  <span style={{ fontSize: 10, color: "var(--color-text-secondary)", marginRight: 6, flexShrink: 0 }}>#{t.id}</span>
                  <span style={{
                    fontSize: 12,
                    color: "var(--color-text-primary)",
                    wordBreak: "break-word",
                    whiteSpace: "normal",
                    lineHeight: 1.35,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    maxWidth: labelWidth - 40,
                  }}>{t.title}</span>
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

                {(() => {
                  const elements = [];
                  let yOffset = HDR_H;
                  for (let i = 0; i < filtered.length; i++) {
                    const t = filtered[i];
                    const rowH = getRowH(t.title);
                    const rx = bx(t.startDate);
                    const rw = bw(t.startDate, t.endDate);
                    const ry = yOffset + 6;
                    const rh = rowH - 12;
                    const col = STATUS_COLORS[t.status] || "#888";
                    const prog = Math.min(100, t.progressPercent || 0) / 100;
                    const showDates = rw > 120;
                    elements.push(
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
                        <line x1={0} y1={yOffset + rowH} x2={CHART_W} y2={yOffset + rowH} stroke="var(--color-border-tertiary)" strokeWidth={0.5} />
                      </g>
                    );
                    yOffset += rowH;
                  }
                  return elements;
                })()}

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

// ─── MetricsTab ────────────────────────────────────────────
function MetricsTab({ tasks, participants, taskTypes }) {
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

// ─── DimensionEditor ───────────────────────────────────────
function DimensionEditor({ dimensions, setDimensions }) {
  const local = Array.isArray(dimensions) && dimensions.length ? dimensions : DEFAULT_DIMENSIONS;
  const [newLabel, setNewLabel] = useState("");

  const total = local.reduce((s, d) => s + (d.weight || 0), 0);

  const redistributeWeights = (dims) => {
    const t = dims.reduce((s, d) => s + (d.weight || 0), 0);
    if (t === 0 || dims.length === 0) return dims;
    let adjusted = dims.map(d => ({ ...d, weight: Math.round((d.weight / t) * 100) }));
    const diff = 100 - adjusted.reduce((s, d) => s + d.weight, 0);
    if (diff !== 0) adjusted[0] = { ...adjusted[0], weight: adjusted[0].weight + diff };
    return adjusted;
  };

  const updateWeight = (key, rawVal) => {
    const val = Math.min(100, Math.max(0, Number(rawVal) || 0));
    const others = local.filter(d => d.key !== key);
    const remaining = 100 - val;
    const sumOthers = others.reduce((s, d) => s + (d.weight || 0), 0);
    const next = local.map(d => {
      if (d.key === key) return { ...d, weight: val };
      if (sumOthers === 0) return { ...d, weight: Math.floor(remaining / others.length) };
      return { ...d, weight: Math.round((d.weight / sumOthers) * remaining) };
    });
    const diff = 100 - next.reduce((s, d) => s + d.weight, 0);
    if (diff !== 0 && next.length > 1) {
      const idx = next.findIndex(d => d.key !== key);
      next[idx] = { ...next[idx], weight: next[idx].weight + diff };
    }
    setDimensions(next);
  };

  const updateLabel = (key, label) => {
    const next = local.map(d => d.key === key ? { ...d, label } : d);
    setDimensions(next);
  };

  const addDimension = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = `dim_${Date.now()}`;
    const base = Math.floor(100 / (local.length + 1));
    const newDim = { key, label, weight: base, builtin: false };
    const next = redistributeWeights([...local.map(d => ({ ...d, weight: Math.max(1, Math.floor(d.weight * local.length / (local.length + 1))) })), newDim]);
    setDimensions(next);
    setNewLabel("");
  };

  const removeDimension = (key) => {
    const next = redistributeWeights(local.filter(d => d.key !== key));
    if (next.length === 0) return;
    setDimensions(next);
  };

  const si = { background: "#fafafa", border: "1px solid #e0e0e0", borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none", fontFamily: "inherit", color: "#2d2d2d" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} onMouseDown={e => e.stopPropagation()}>
      {local.map((dim) => (
        <div key={dim.key} style={{ background: "#fafafa", borderRadius: 10, padding: "12px 14px", border: "1px solid rgba(84,44,156,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input
              style={{ ...si, flex: 1, fontWeight: 600 }}
              value={dim.label}
              onChange={e => updateLabel(dim.key, e.target.value)}
              onBlur={() => setDimensions(local)}
              placeholder="Nombre de la dimensión"
            />
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="number" min={0} max={100} step={1}
                value={dim.weight}
                onChange={e => updateWeight(dim.key, e.target.value)}
                style={{ ...si, width: 52, textAlign: "center", fontWeight: 700 }}
              />
              <span style={{ fontSize: 12, color: "#888" }}>%</span>
            </div>
            {!dim.builtin && (
              <button
                onClick={() => removeDimension(dim.key)}
                style={{ background: "#fde8e8", border: "1px solid #f5c6c6", color: "#c0392b", borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 13, flexShrink: 0 }}
              >✕</button>
            )}
          </div>
          <input
            type="range" min={0} max={100} step={1} value={dim.weight}
            onChange={e => updateWeight(dim.key, e.target.value)}
            style={{ width: "100%", cursor: "pointer", accentColor: "#ec6c04" }}
          />
        </div>
      ))}

      {/* Add new dimension */}
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <input
          style={{ ...si, flex: 1, padding: "8px 12px" }}
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addDimension()}
          placeholder="Nueva dimensión (ej: Impacto en cliente)..."
        />
        <button
          onClick={addDimension}
          style={{ background: "linear-gradient(135deg,#542c9c,#6e3ebf)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}
        >+ Agregar</button>
      </div>

      <div style={{
        fontSize: 12, color: total === 100 ? "#27ae60" : "#c0392b",
        textAlign: "center", background: total === 100 ? "#e8f8ee" : "#fde8e8",
        borderRadius: 8, padding: "8px 12px", fontWeight: 700, transition: "all 0.2s",
      }}>
        Total: {total}% {total !== 100 && "— debe sumar 100%"}
      </div>
    </div>
  );
}

function ConfigSection({ title, children }) {
  return (
    <div style={{ background: "#ffffff", border: "none", borderRadius: 14, padding: 20, boxShadow: "0 2px 16px rgba(84,44,156,0.07)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#542c9c", marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

// ─── FieldDefEditor ────────────────────────────────────────
// Owner-only editor for the per-project custom card schema (task_field_defs).
// Soft-deletes on remove to preserve historical values inside tasks.custom_fields.
const FIELD_TYPE_LABELS = {
  text:        'Texto corto (una línea)',
  textarea:    'Texto largo (multilínea)',
  date:        'Fecha',
  select:      'Lista desplegable (una opción)',
  multiselect: 'Multi-opción (pastillas, varias)',
  subitems:    'Sub-ítems con checkbox',
  auto:        'Campo automático (sistema)',
};

const FIELD_TYPE_HINTS = {
  text:        'Ej: "Cliente", "Código externo".',
  textarea:    'Ej: "Notas extendidas", "Riesgos".',
  date:        'Ej: "Fecha objetivo", "Vencimiento contractual".',
  select:      'Una sola opción. Configura la lista de valores.',
  multiselect: 'Varias opciones tipo pastilla. Configura la lista de valores.',
  subitems:    'Lista interna con texto + checkbox (similar a las sub-tareas).',
  auto:        'Lectura no editable. Elige qué columna del sistema reflejar.',
};

function slugifyKey(label) {
  return String(label || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'campo';
}

function FieldDefEditor({ defs = [], onAdd, onUpdate, onDelete, onReorder }) {
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ label: '', type: 'text', required: false, show_on_card: false, show_in_presentation: false, options: '', source: 'created_at' });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const inpStyle = { background: '#fafafa', border: '1.5px solid #e0e0e0', borderRadius: 8, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
  const labelStyle = { display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#542c9c', marginBottom: 5 };
  const usedKeys = new Set(defs.filter(d => !d.deleted_at).map(d => d.key));

  const buildConfigFromDraft = (d) => {
    if (d.type === 'select' || d.type === 'multiselect') {
      const options = String(d.options || '')
        .split(/\r?\n|,/)
        .map(s => s.trim())
        .filter(Boolean);
      return { options, ...(d.type === 'multiselect' && d.maxSelections ? { maxSelections: Number(d.maxSelections) } : {}) };
    }
    if (d.type === 'auto') {
      return { source: d.source || 'created_at' };
    }
    if (d.type === 'text' && d.maxLength) return { maxLength: Number(d.maxLength) };
    if (d.type === 'textarea' && d.maxLength) return { maxLength: Number(d.maxLength) };
    if (d.type === 'subitems' && d.maxItems) return { maxItems: Number(d.maxItems) };
    return {};
  };

  const handleAdd = async () => {
    setError('');
    const label = draft.label.trim();
    if (!label) { setError('Pon una etiqueta para el campo.'); return; }
    let key = slugifyKey(label);
    // Avoid collisions with existing active keys.
    let n = 1;
    let candidate = key;
    while (usedKeys.has(candidate)) {
      n += 1;
      candidate = (key + '_' + n).slice(0, 50);
    }
    key = candidate;
    const config = buildConfigFromDraft(draft);
    if ((draft.type === 'select' || draft.type === 'multiselect') && (!config.options || !config.options.length)) {
      setError('Agrega al menos una opción (una por línea o separadas por coma).'); return;
    }
    setBusy(true);
    const { error: err } = await onAdd({
      key, label, type: draft.type,
      required: !!draft.required,
      show_on_card: !!draft.show_on_card,
      show_in_presentation: !!draft.show_in_presentation,
      config,
    });
    setBusy(false);
    if (err) {
      setError(err.message || 'Error al guardar el campo.');
      return;
    }
    setDraft({ label: '', type: 'text', required: false, show_on_card: false, show_in_presentation: false, options: '', source: 'created_at' });
    setShowNew(false);
  };

  const startEdit = (def) => {
    setEditingId(def.id);
    setEditDraft({
      label: def.label,
      required: !!def.required,
      show_on_card: !!def.show_on_card,
      show_in_presentation: !!def.show_in_presentation,
      options: (def.config?.options || []).join('\n'),
      source: def.config?.source || 'created_at',
      maxLength: def.config?.maxLength || '',
      maxItems: def.config?.maxItems || '',
      maxSelections: def.config?.maxSelections || '',
    });
    setError('');
  };

  const handleSaveEdit = async (def) => {
    if (!editDraft) return;
    setError('');
    const label = editDraft.label.trim();
    if (!label) { setError('La etiqueta no puede ir vacía.'); return; }
    const patch = {
      label,
      required: !!editDraft.required,
      show_on_card: !!editDraft.show_on_card,
      show_in_presentation: !!editDraft.show_in_presentation,
      config: buildConfigFromDraft({ ...editDraft, type: def.type }),
    };
    setBusy(true);
    const { error: err } = await onUpdate(def.id, patch);
    setBusy(false);
    if (err) { setError(err.message || 'Error al guardar.'); return; }
    setEditingId(null);
    setEditDraft(null);
  };

  const handleDelete = async (def) => {
    if (!window.confirm(`¿Eliminar el campo "${def.label}"? Los valores ya capturados quedarán archivados.`)) return;
    setBusy(true);
    const { error: err } = await onDelete(def.id);
    setBusy(false);
    if (err) setError(err.message || 'Error al eliminar.');
  };

  const move = async (def, dir) => {
    const ordered = [...defs].sort((a, b) => (a.position - b.position) || (a.id - b.id));
    const idx = ordered.findIndex(d => d.id === def.id);
    if (idx < 0) return;
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ordered.length) return;
    const next = [...ordered];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    await onReorder(next.map(d => d.id));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {defs.length === 0 ? (
        <p style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: '12px 0' }}>
          Aún no hay campos personalizados. Agrega el primero para que aparezca en cada tarjeta.
        </p>
      ) : (
        defs.map((def) => (
          <div key={def.id} style={{ background: '#fafafa', borderRadius: 8, border: '1px solid rgba(84,44,156,0.08)', padding: '10px 12px' }}>
            {editingId === def.id ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Etiqueta</label>
                    <input style={inpStyle} value={editDraft.label} onChange={(e) => setEditDraft(d => ({ ...d, label: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Tipo (no editable)</label>
                    <input style={{ ...inpStyle, background: '#f0f0f0', color: '#888' }} value={FIELD_TYPE_LABELS[def.type] || def.type} readOnly />
                  </div>
                </div>
                {def.type === 'auto' && (
                  <div>
                    <label style={labelStyle}>Origen automático</label>
                    <select style={inpStyle} value={editDraft.source} onChange={(e) => setEditDraft(d => ({ ...d, source: e.target.value }))}>
                      {Object.entries(AUTO_FIELD_SOURCE_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
                    </select>
                  </div>
                )}
                {(def.type === 'select' || def.type === 'multiselect') && (
                  <div>
                    <label style={labelStyle}>Opciones (una por línea)</label>
                    <textarea style={{ ...inpStyle, minHeight: 70 }} value={editDraft.options} onChange={(e) => setEditDraft(d => ({ ...d, options: e.target.value }))} />
                  </div>
                )}
                {def.type === 'multiselect' && (
                  <div>
                    <label style={labelStyle}>Máx. selecciones (opcional)</label>
                    <input style={inpStyle} type="number" min="1" max="50" value={editDraft.maxSelections} onChange={(e) => setEditDraft(d => ({ ...d, maxSelections: e.target.value }))} />
                  </div>
                )}
                {(def.type === 'text' || def.type === 'textarea') && (
                  <div>
                    <label style={labelStyle}>Máx. caracteres (opcional)</label>
                    <input style={inpStyle} type="number" min="1" value={editDraft.maxLength} onChange={(e) => setEditDraft(d => ({ ...d, maxLength: e.target.value }))} />
                  </div>
                )}
                {def.type === 'subitems' && (
                  <div>
                    <label style={labelStyle}>Máx. sub-ítems (opcional)</label>
                    <input style={inpStyle} type="number" min="1" max="50" value={editDraft.maxItems} onChange={(e) => setEditDraft(d => ({ ...d, maxItems: e.target.value }))} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12 }}>
                  {def.type !== 'auto' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
                      <input type="checkbox" checked={editDraft.required} onChange={(e) => setEditDraft(d => ({ ...d, required: e.target.checked }))} />
                      Requerido
                    </label>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
                    <input type="checkbox" checked={editDraft.show_on_card} onChange={(e) => setEditDraft(d => ({ ...d, show_on_card: e.target.checked }))} />
                    Mostrar en tarjeta resumida
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
                    <input type="checkbox" checked={!!editDraft.show_in_presentation} onChange={(e) => setEditDraft(d => ({ ...d, show_in_presentation: e.target.checked }))} />
                    Mostrar en Presentación
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={busy} onClick={() => handleSaveEdit(def)} style={{ background: 'linear-gradient(135deg, #ec6c04, #f07d1e)', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    Guardar
                  </button>
                  <button disabled={busy} onClick={() => { setEditingId(null); setEditDraft(null); setError(''); }} style={{ background: '#fff', border: '1px solid #e0e0e0', color: '#525252', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 12 }}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#2d2d2d' }}>{def.label}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <span>🔖 {FIELD_TYPE_LABELS[def.type] || def.type}</span>
                    <span>· clave: <code style={{ fontSize: 11 }}>{def.key}</code></span>
                    {def.required && <span style={{ color: '#c0392b' }}>· requerido</span>}
                    {def.show_on_card && <span style={{ color: '#149cac' }}>· en tarjeta</span>}
                    {def.show_in_presentation && <span style={{ color: '#ef7218' }}>· en presentación</span>}
                    {def.type === 'auto' && def.config?.source && <span>· origen: {AUTO_FIELD_SOURCE_LABELS[def.config.source] || def.config.source}</span>}
                  </div>
                </div>
                <button onClick={() => move(def, 'up')} title="Subir" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>▲</button>
                <button onClick={() => move(def, 'down')} title="Bajar" style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>▼</button>
                <button onClick={() => startEdit(def)} style={{ background: '#ede8f8', border: '1px solid #d4c4f0', color: '#542c9c', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>Editar</button>
                <button onClick={() => handleDelete(def)} style={{ background: '#fde8e8', border: '1px solid #f5c6c6', color: '#c0392b', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12 }}>✕</button>
              </div>
            )}
          </div>
        ))
      )}

      {showNew ? (
        <div style={{ background: '#fff', borderRadius: 8, border: '1.5px dashed #a78bda', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={labelStyle}>Etiqueta visible</label>
              <input style={inpStyle} value={draft.label} onChange={(e) => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="Ej: Cliente, Riesgo, Próxima acción..." />
            </div>
            <div>
              <label style={labelStyle}>Tipo de campo</label>
              <select style={inpStyle} value={draft.type} onChange={(e) => setDraft(d => ({ ...d, type: e.target.value }))}>
                {Object.entries(FIELD_TYPE_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#888' }}>{FIELD_TYPE_HINTS[draft.type]}</div>

          {draft.type === 'auto' && (
            <div>
              <label style={labelStyle}>Origen automático</label>
              <select style={inpStyle} value={draft.source} onChange={(e) => setDraft(d => ({ ...d, source: e.target.value }))}>
                {Object.entries(AUTO_FIELD_SOURCE_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
              </select>
            </div>
          )}
          {(draft.type === 'select' || draft.type === 'multiselect') && (
            <div>
              <label style={labelStyle}>Opciones (una por línea o separadas por coma)</label>
              <textarea style={{ ...inpStyle, minHeight: 70 }} value={draft.options} onChange={(e) => setDraft(d => ({ ...d, options: e.target.value }))} placeholder={'Opción A\nOpción B\nOpción C'} />
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12 }}>
            {draft.type !== 'auto' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
                <input type="checkbox" checked={draft.required} onChange={(e) => setDraft(d => ({ ...d, required: e.target.checked }))} />
                Requerido
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
              <input type="checkbox" checked={draft.show_on_card} onChange={(e) => setDraft(d => ({ ...d, show_on_card: e.target.checked }))} />
              Mostrar en tarjeta resumida
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#525252' }}>
              <input type="checkbox" checked={!!draft.show_in_presentation} onChange={(e) => setDraft(d => ({ ...d, show_in_presentation: e.target.checked }))} />
              Mostrar en Presentación
            </label>
          </div>

          {error && <div style={{ fontSize: 12, color: '#c0392b' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy} onClick={handleAdd} style={{ background: 'linear-gradient(135deg, #ec6c04, #f07d1e)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              {busy ? 'Guardando…' : 'Agregar campo'}
            </button>
            <button disabled={busy} onClick={() => { setShowNew(false); setError(''); }} style={{ background: '#fff', border: '1px solid #e0e0e0', color: '#525252', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setShowNew(true); setError(''); }} style={{ alignSelf: 'flex-start', background: '#f5f0ff', border: '1px dashed #a78bda', color: '#542c9c', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          + Nuevo campo personalizado
        </button>
      )}

      {error && !showNew && <div style={{ fontSize: 12, color: '#c0392b' }}>{error}</div>}
    </div>
  );
}

// ─── ConfigTab ─────────────────────────────────────────────
function ConfigTab({ participants, setParticipants, indicators, setIndicators, taskTypes, setTaskTypes, dimensions, setDimensions, project, onChangePin, taskFieldDefs = [], addTaskFieldDef, updateTaskFieldDef, deleteTaskFieldDef, reorderTaskFieldDefs }) {
  const [newP, setNewP] = useState("");
  const [newI, setNewI] = useState("");
  const [newType, setNewType] = useState("");
  const [typeMsg, setTypeMsg] = useState("");

  // Email config state
  const [emails, setEmails] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [sendDay, setSendDay] = useState("monday");
  const [sendHour, setSendHour] = useState(8);
  const [daysBack, setDaysBack] = useState(7);
  const [daysForward, setDaysForward] = useState(7);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  const [generating, setGenerating] = useState(false);
  const [reportMsg, setReportMsg] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviting, setInviting] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [newPinConfirm, setNewPinConfirm] = useState("");
  const [pinChangeMsg, setPinChangeMsg] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  const sendInvite = async () => {
    if (!inviteEmail.includes("@")) { setInviteMsg("Correo inválido."); return; }
    if (!project?.id) { setInviteMsg("No hay proyecto activo."); return; }
    setInviting(true);
    setInviteMsg("Enviando invitación...");
    try {
      const headers = await getAuthJsonHeaders();
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: inviteEmail,
          projectId: project.id,
        }),
      });
      const data = await res.json();
      if (data.ok) { setInviteMsg("✓ Invitación enviada a " + inviteEmail); setInviteEmail(""); }
      else setInviteMsg("Error: " + data.error);
    } catch (err) { setInviteMsg("Error: " + err.message); }
    setInviting(false);
    setTimeout(() => setInviteMsg(""), 4000);
  };

  const handleChangePin = () => {
    if (!newPin || newPin.length < 4) { setPinChangeMsg("La clave debe tener al menos 4 caracteres."); return; }
    if (newPin !== newPinConfirm) { setPinChangeMsg("Las claves no coinciden."); return; }
    onChangePin(newPin);
    setNewPin(""); setNewPinConfirm("");
    setPinChangeMsg("✓ Clave actualizada correctamente");
    setTimeout(() => setPinChangeMsg(""), 3000);
  };

  useEffect(() => {
    if (!project?.id) return;
    supabase.from('email_config').select('*').eq('project_id', project.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setEmails(data.emails || []);
          setFrequency(data.frequency || 'weekly');
          setSendDay(data.send_day || 'monday');
          setSendHour(data.send_hour ?? 8);
          setDaysBack(data.days_back ?? 7);
          setDaysForward(data.days_forward ?? 7);
        }
      });
  }, [project?.id]);

  const saveEmailConfig = async () => {
    if (!project?.id) { setEmailMsg("No hay proyecto activo."); return; }
    setEmailSaving(true);
    const { error } = await supabase.from('email_config')
      .upsert(
        { project_id: project.id, emails, frequency, send_day: sendDay, send_hour: sendHour, days_back: daysBack, days_forward: daysForward },
        { onConflict: 'project_id' }
      );
    setEmailSaving(false);
    setEmailMsg(error ? "Error: " + error.message : "Configuración guardada ✓");
    setTimeout(() => setEmailMsg(""), 3000);
  };

  const generateAndSend = async () => {
    if (!emails.length) {
      setReportMsg("Agrega al menos un correo antes de enviar.");
      setTimeout(() => setReportMsg(""), 4000);
      return;
    }
    setGenerating(true);
    setReportMsg("Generando reporte con IA... esto puede tomar 30 segundos.");
    if (!project?.id) {
      setReportMsg("Error: no hay proyecto activo.");
      setGenerating(false);
      return;
    }

    const today = new Date();
    const fmt = (d) => d.toISOString().split("T")[0];
    let weekStart;
    if (daysBack === 0) {
      weekStart = "2020-01-01";
    } else {
      const start = new Date(today);
      start.setDate(today.getDate() - daysBack);
      weekStart = fmt(start);
    }
    const end = new Date(today);
    end.setDate(today.getDate() + daysForward);
    const weekEnd = fmt(end);

    try {
      const headers = await getAuthJsonHeaders();
      const genRes = await fetch('/api/generate-report', {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId: project.id, weekStart, weekEnd }),
      });
      if (!genRes.ok) {
        let errMsg = `Error del servidor (${genRes.status})`;
        try { const e = await genRes.json(); errMsg = e.error || errMsg; } catch { /* keep generic server error */ }
        throw new Error(errMsg);
      }

      // Aprovecha el streaming SSE: muestra progreso en bytes mientras llega
      // el HTML, en vez de esperar el body completo.
      let html = "";
      if (genRes.body && typeof genRes.body.getReader === "function") {
        const reader = genRes.body.getReader();
        const decoder = new TextDecoder();
        let chunks = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          html += decoder.decode(value, { stream: true });
          chunks++;
          if (chunks % 5 === 0) {
            const kb = (html.length / 1024).toFixed(1);
            setReportMsg(`Generando reporte con IA... ${kb} KB recibidos`);
          }
        }
        html += decoder.decode();
      } else {
        // Fallback navegadores sin streaming.
        html = await genRes.text();
      }

      setReportMsg("Reporte generado. Enviando correos...");

      const sendRes = await fetch('/api/send-report', {
        method: 'POST',
        headers,
        body: JSON.stringify({ projectId: project.id, emails, html, weekStart, weekEnd }),
      });
      const sendText = await sendRes.text();
      let sendData;
      try { sendData = JSON.parse(sendText); } catch { throw new Error(`Error del servidor (${sendRes.status}): la función de envío no respondió correctamente`); }
      if (sendData.error) throw new Error(sendData.error);

      await supabase.from('email_config')
        .update({ last_sent: new Date().toISOString() })
        .eq('project_id', project.id);

      setReportMsg("✓ Reporte enviado a " + emails.length + " correo(s)");
    } catch (err) {
      setReportMsg("Error: " + err.message);
    }
    setGenerating(false);
  };

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

  const addType = () => {
    const name = newType.trim();
    if (!name || taskTypes.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    setTaskTypes((prev) => [...prev, { id: Date.now(), name }]);
    setNewType("");
    setTypeMsg("Tipo agregado correctamente");
    setTimeout(() => setTypeMsg(""), 3000);
  };
  const removeType = (id) => {
    if (!confirm("¿Eliminar tipo de tarea?")) return;
    setTaskTypes((prev) => prev.filter((t) => t.id !== id));
  };

  const si = { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-primary)", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", flex: 1 };
  const addBtn = { background: "linear-gradient(135deg, #542c9c, #6e3ebf)", border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, boxShadow: "0 3px 10px rgba(84,44,156,0.3)" };

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Proyecto ───────────────────────── */}
      {project && (
        <ConfigSection title="🏗️ Proyecto">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#f9f8fd", borderRadius: 8, border: "1px solid rgba(84,44,156,0.12)" }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#542c9c", flex: 1 }}>{project.name}</span>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#542c9c", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Código de invitación
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ flex: 1, background: "#1a1a2e", color: "#4dd8e8", fontFamily: "monospace", fontSize: 13, padding: "8px 12px", borderRadius: 8, letterSpacing: 1 }}>
                  {project.invite_code}
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}?join=${project.invite_code}`); setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2000); }}
                  style={{ background: copiedCode ? "#e8f8ee" : "linear-gradient(135deg,#542c9c,#6e3ebf)", color: copiedCode ? "#27ae60" : "#fff", border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}
                >
                  {copiedCode ? "✓ Copiado" : "Copiar link"}
                </button>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#542c9c", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Invitar por correo electrónico
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendInvite()}
                  placeholder="correo@empresa.com"
                  style={{ flex: 1, background: "#fafafa", border: "1px solid #e0e0e0", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", color: "#2d2d2d" }}
                />
                <button
                  onClick={sendInvite} disabled={inviting}
                  style={{ background: inviting ? "#e0e0e0" : "linear-gradient(135deg,#ec6c04,#f07d1e)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}
                >
                  {inviting ? "..." : "Enviar"}
                </button>
              </div>
              {inviteMsg && <div style={{ fontSize: 12, marginTop: 6, color: inviteMsg.startsWith("Error") ? "#c0392b" : "#27ae60", fontWeight: 500 }}>{inviteMsg}</div>}
            </div>
          </div>
        </ConfigSection>
      )}

      {/* ── Cambio de clave ─────────────────── */}
      <ConfigSection title="🔐 Clave de configuración">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            type="password" value={newPin} onChange={e => setNewPin(e.target.value)}
            placeholder="Nueva clave..." style={{ background: "#fafafa", border: "1px solid #e0e0e0", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", color: "#2d2d2d" }}
          />
          <input
            type="password" value={newPinConfirm} onChange={e => setNewPinConfirm(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleChangePin()}
            placeholder="Confirmar nueva clave..." style={{ background: "#fafafa", border: "1px solid #e0e0e0", borderRadius: 8, padding: "8px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", color: "#2d2d2d" }}
          />
          <button onClick={handleChangePin} style={{ background: "linear-gradient(135deg,#542c9c,#6e3ebf)", color: "#fff", border: "none", borderRadius: 8, padding: "9px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            Actualizar clave
          </button>
          {pinChangeMsg && <div style={{ fontSize: 12, color: pinChangeMsg.startsWith("✓") ? "#27ae60" : "#c0392b", fontWeight: 500 }}>{pinChangeMsg}</div>}
        </div>
      </ConfigSection>

      <ConfigSection title="👥 Participantes">
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
      </ConfigSection>

      <ConfigSection title="📊 Indicadores clave">
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
      </ConfigSection>

      <ConfigSection title="🧩 Tipos de tarea">
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input style={si} value={newType} onChange={(e) => setNewType(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addType()} placeholder="Nombre del tipo..." />
          <button onClick={addType} style={addBtn}>Agregar</button>
        </div>
        {typeMsg && <div style={{ marginBottom: 10, color: "#16a34a", fontSize: 12 }}>{typeMsg}</div>}
        {taskTypes.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center" }}>No hay tipos definidos. Usa los valores por defecto al crear tareas.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {taskTypes.map((type) => (
              <div key={type.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fafafa", borderRadius: 8, border: "1px solid rgba(84,44,156,0.08)" }}>
                <span style={{ flex: 1, fontSize: 13, color: "var(--color-text-primary)" }}>{type.name}</span>
                <button onClick={() => removeType(type.id)} style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", color: "var(--color-text-danger)", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </ConfigSection>

      <ConfigSection title="⚖️ Dimensiones de Valor de Aporte">
        <div style={{ fontSize: 12, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Define las dimensiones que se evalúan en cada tarea y su peso relativo en el cálculo de aporte. Puedes renombrar, ajustar pesos y agregar o quitar dimensiones personalizadas.
        </div>
        <DimensionEditor dimensions={dimensions} setDimensions={setDimensions} />
      </ConfigSection>

      <ConfigSection title="🧩 Estructura de la tarjeta (campos personalizados)">
        <div style={{ fontSize: 12, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Agrega los campos que se mostrarán en cada tarjeta de tarea: texto, fechas, listas de opciones, sub-ítems o campos automáticos (fecha de creación, última modificación, etc.). Los campos básicos del sistema (ID, título, estado, etc.) y la calculadora de aporte se mantienen siempre.
        </div>
        <FieldDefEditor
          defs={taskFieldDefs}
          onAdd={addTaskFieldDef}
          onUpdate={updateTaskFieldDef}
          onDelete={deleteTaskFieldDef}
          onReorder={reorderTaskFieldDefs}
        />
      </ConfigSection>

      <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 16px rgba(84,44,156,0.07)", border: "1px solid rgba(84,44,156,0.1)" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#542c9c", borderBottom: "2px solid #ede8f8", paddingBottom: 10, marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
          📧 Reporte IA por correo
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: "linear-gradient(135deg,#ec6c04,#f5a623)", color: "#fff", letterSpacing: "0.05em" }}>PREMIUM</span>
        </div>

        {/* ── Periodicidad ─────────────────────────── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: "1 1 180px" }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#542c9c", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              Periodicidad
            </label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} style={{ ...si, width: "100%" }}>
              <option value="daily">Diario</option>
              <option value="weekly">Semanal</option>
              <option value="biweekly">Quincenal</option>
              <option value="monthly">Mensual</option>
              <option value="bimonthly">Bimensual</option>
              <option value="quarterly">Trimestral</option>
              <option value="semiannual">Semestral</option>
            </select>
          </div>
          {(frequency === "weekly" || frequency === "biweekly") && (
            <div style={{ flex: "1 1 150px" }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#542c9c", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
                Día de envío
              </label>
              <select value={sendDay} onChange={(e) => setSendDay(e.target.value)} style={{ ...si, width: "100%" }}>
                <option value="monday">Lunes</option>
                <option value="tuesday">Martes</option>
                <option value="wednesday">Miércoles</option>
                <option value="thursday">Jueves</option>
                <option value="friday">Viernes</option>
                <option value="saturday">Sábado</option>
                <option value="sunday">Domingo</option>
              </select>
            </div>
          )}
          <div style={{ flex: "1 1 120px" }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#542c9c", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              Hora de envío
            </label>
            <select value={sendHour} onChange={(e) => setSendHour(Number(e.target.value))} style={{ ...si, width: "100%" }}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Rango de análisis ────────────────────── */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div style={{ flex: "1 1 180px" }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#542c9c", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              Días hacia atrás
            </label>
            <select value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value))} style={{ ...si, width: "100%" }}>
              <option value={0}>Desde el inicio</option>
              <option value={7}>7 días</option>
              <option value={10}>10 días</option>
              <option value={15}>15 días</option>
              <option value={25}>25 días</option>
              <option value={30}>30 días</option>
              <option value={60}>60 días</option>
              <option value={90}>90 días</option>
            </select>
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#542c9c", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>
              Días hacia adelante
            </label>
            <select value={daysForward} onChange={(e) => setDaysForward(Number(e.target.value))} style={{ ...si, width: "100%" }}>
              <option value={0}>Solo hasta hoy</option>
              <option value={5}>5 días</option>
              <option value={7}>7 días</option>
              <option value={10}>10 días</option>
              <option value={15}>15 días</option>
              <option value={30}>30 días</option>
            </select>
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#888", marginBottom: 14, padding: "8px 10px", background: "#f9f8fd", borderRadius: 8, lineHeight: 1.5 }}>
          El reporte analizará tareas desde <strong>{daysBack === 0 ? "el inicio" : `hace ${daysBack} días`}</strong> hasta <strong>{daysForward === 0 ? "hoy" : `${daysForward} días en adelante`}</strong>.
          Se enviará automáticamente con periodicidad <strong>{{daily:"diaria",weekly:"semanal",biweekly:"quincenal",monthly:"mensual",bimonthly:"bimensual",quarterly:"trimestral",semiannual:"semestral"}[frequency]}</strong>{(frequency === "weekly" || frequency === "biweekly") ? ` el día ${{"monday":"lunes","tuesday":"martes","wednesday":"miércoles","thursday":"jueves","friday":"viernes","saturday":"sábado","sunday":"domingo"}[sendDay]}` : ""} a las <strong>{String(sendHour).padStart(2,"0")}:00</strong>.
        </div>

        <div style={{ height: 1, background: "#f0f0f0", margin: "0 0 14px" }} />

        {/* ── Destinatarios ────────────────────────── */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "#542c9c", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 8 }}>
            Destinatarios ({emails.length}/10)
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {emails.map((email, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 8 }}>
                <span style={{ fontSize: 13, color: "#2d2d2d", flex: 1 }}>📬 {email}</span>
                <button onClick={() => setEmails(prev => prev.filter((_, idx) => idx !== i))} style={{ background: "#fde8e8", border: "1px solid #f5c6c6", color: "#c0392b", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 13 }}>✕</button>
              </div>
            ))}
          </div>
          {emails.length < 10 && (
            <div style={{ display: "flex", gap: 8 }}>
              <input type="email" style={{ ...si, flex: 1 }}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newEmail.includes("@")) {
                    if (!emails.includes(newEmail)) setEmails(p => [...p, newEmail]);
                    setNewEmail("");
                  }
                }}
                placeholder="correo@ejemplo.com" />
              <button
                onClick={() => {
                  if (newEmail.includes("@") && !emails.includes(newEmail)) {
                    setEmails(p => [...p, newEmail]);
                    setNewEmail("");
                  }
                }}
                style={{ background: "linear-gradient(135deg,#542c9c,#6e3ebf)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13, boxShadow: "0 2px 10px rgba(84,44,156,0.3)" }}>
                Agregar
              </button>
            </div>
          )}
        </div>

        <button onClick={saveEmailConfig} disabled={emailSaving}
          style={{ background: "linear-gradient(135deg,#542c9c,#6e3ebf)", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer", fontWeight: 700, fontSize: 13, marginBottom: 8, boxShadow: "0 2px 10px rgba(84,44,156,0.3)" }}>
          {emailSaving ? "Guardando..." : "Guardar configuración"}
        </button>

        {emailMsg && (
          <div style={{ fontSize: 12, color: "#27ae60", marginBottom: 12, fontWeight: 500 }}>
            {emailMsg}
          </div>
        )}

        <div style={{ height: 1, background: "#f0f0f0", margin: "16px 0" }} />

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "#969696", marginBottom: 10, lineHeight: 1.5 }}>
            Claude IA analiza cada tarea, usuario y resultado en lenguaje natural dentro del rango configurado.
          </div>
          <button onClick={generateAndSend} disabled={generating}
            style={{
              background: generating ? "#e0e0e0" : "linear-gradient(135deg,#ec6c04,#f07d1e)",
              color: "#fff", border: "none", borderRadius: 8,
              padding: "11px 22px", cursor: generating ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: 14, width: "100%",
              boxShadow: generating ? "none" : "0 3px 14px rgba(236,108,4,0.35)",
              transition: "all 0.2s",
            }}>
            {generating ? "⏳ Generando reporte..." : "🤖 Generar y enviar reporte IA"}
          </button>
        </div>

        {reportMsg && (
          <div style={{
            fontSize: 12, marginTop: 8, padding: "10px 14px", borderRadius: 8,
            background: reportMsg.startsWith("Error") ? "#fde8e8" : "#e8f8ee",
            color: reportMsg.startsWith("Error") ? "#c0392b" : "#27ae60",
            fontWeight: 500, lineHeight: 1.5,
          }}>
            {reportMsg}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AuthScreen ───────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [authTab, setAuthTab] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const inp = { background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "11px 14px", fontSize: 14, outline: "none", fontFamily: "inherit", color: "#fff", width: "100%", boxSizing: "border-box", transition: "border-color 0.2s" };
  const lbl = { fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 };

  const handleLogin = async () => {
    if (!email.trim() || !password) { setError("Completa todos los campos."); return; }
    setLoading(true); setError(''); setInfo('');
    const { data, error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    if (data?.user) onAuth(data.user);
  };

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) { setError("Completa todos los campos."); return; }
    if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres."); return; }
    setLoading(true); setError(''); setInfo('');
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name: name.trim() } },
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    if (data?.user && !data?.session) {
      setInfo("Revisa tu correo para confirmar tu cuenta.");
      return;
    }
    if (data?.user) onAuth(data.user);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "linear-gradient(160deg,#0d0d1a 0%,#1a1a2e 50%,#2d1b4e 100%)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9998, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 72, fontWeight: 900, background: "linear-gradient(135deg,#ec6c04,#f5a623,#149cac)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1, letterSpacing: -3 }}>P+</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 5, textTransform: "uppercase", marginTop: 6 }}>Productivity-Plus</div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 4, marginBottom: 28 }}>
            {[['login','Iniciar sesión'],['register','Crear cuenta']].map(([t, l]) => (
              <button key={t} onClick={() => { setAuthTab(t); setError(''); setInfo(''); }}
                style={{ flex: 1, background: authTab === t ? "rgba(236,108,4,0.9)" : "transparent", color: "#fff", border: "none", borderRadius: 8, padding: "9px", cursor: "pointer", fontWeight: authTab === t ? 700 : 400, fontSize: 13, transition: "all 0.2s", fontFamily: "inherit" }}>
                {l}
              </button>
            ))}
          </div>

          {authTab === 'login' ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={lbl}>Correo electrónico</label>
                <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="tu@correo.com" autoFocus />
              </div>
              <div>
                <label style={lbl}>Contraseña</label>
                <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="••••••••" />
              </div>
              {error && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{error}</div>}
              {info && <div style={{ fontSize: 12, color: "#4dd8e8", fontWeight: 500 }}>{info}</div>}
              <button onClick={handleLogin} disabled={loading}
                style={{ background: loading ? "#555" : "linear-gradient(135deg,#ec6c04,#f07d1e)", color: "#fff", border: "none", borderRadius: 10, padding: "12px", cursor: loading ? "default" : "pointer", fontWeight: 700, fontSize: 14, width: "100%", boxShadow: loading ? "none" : "0 4px 20px rgba(236,108,4,0.4)", marginTop: 4, fontFamily: "inherit" }}>
                {loading ? "Ingresando..." : "Ingresar →"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={lbl}>Nombre</label>
                <input style={inp} type="text" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleRegister()} placeholder="Tu nombre completo" autoFocus />
              </div>
              <div>
                <label style={lbl}>Correo electrónico</label>
                <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleRegister()} placeholder="tu@correo.com" />
              </div>
              <div>
                <label style={lbl}>Contraseña</label>
                <input style={inp} type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleRegister()} placeholder="Mínimo 6 caracteres" />
              </div>
              {error && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{error}</div>}
              {info && <div style={{ fontSize: 12, color: "#4dd8e8", fontWeight: 500 }}>{info}</div>}
              <button onClick={handleRegister} disabled={loading}
                style={{ background: loading ? "#555" : "linear-gradient(135deg,#542c9c,#6e3ebf)", color: "#fff", border: "none", borderRadius: 10, padding: "12px", cursor: loading ? "default" : "pointer", fontWeight: 700, fontSize: 14, width: "100%", boxShadow: loading ? "none" : "0 4px 20px rgba(84,44,156,0.4)", marginTop: 4, fontFamily: "inherit" }}>
                {loading ? "Creando cuenta..." : "Crear cuenta →"}
              </button>
            </div>
          )}
        </div>
        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: 2 }}>PRODUCTIVITY-PLUS · GESTIÓN ESTRATÉGICA</div>
      </div>
    </div>
  );
}

// ─── UserSelectScreen ─────────────────────────────────────
const USER_COLORS = ["#ec6c04","#0aa0ab","#542c9c","#e74c3c","#27ae60","#2980b9","#e67e22","#8e44ad","#1abc9c","#c0392b"];
const getUserColor = (name) => USER_COLORS[Math.abs([...(name||"")].reduce((h, c) => h * 31 + c.charCodeAt(0), 0)) % USER_COLORS.length];
const getInitials = (name) => (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

function UserSelectScreen({ participants, activeUsers, onSelect, onConflict }) {
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(null);

  const handleSelect = (p) => {
    const online = activeUsers.some(u => u.userId === p.id);
    if (online) {
      onConflict(p);
      return;
    }
    setSelected(p.id);
    setTimeout(() => onSelect(p), 600);
  };

  const isOnline = (id) => activeUsers.some(u => u.userId === id);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#0d0d1a",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      zIndex: 9998, overflow: "hidden",
    }}>
      <style>{`
        @keyframes cardEntrance { from { opacity: 0; transform: translateY(40px) scale(0.8); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes selectedPulse { 0% { box-shadow: 0 0 0 0 rgba(236,108,4,0.6); } 70% { box-shadow: 0 0 0 30px rgba(236,108,4,0); } 100% { box-shadow: 0 0 0 0 rgba(236,108,4,0); } }
        @keyframes selectedZoom { to { transform: scale(1.15); opacity: 0; } }
        @keyframes onlinePing { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2.5); opacity: 0; } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      `}</style>

      {/* Background grid */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "linear-gradient(rgba(20,156,172,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(20,156,172,0.04) 1px, transparent 1px)",
        backgroundSize: "50px 50px",
      }} />
      <div style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(84,44,156,0.15) 0%, transparent 70%)" }} />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 2, textAlign: "center", marginBottom: 40 }}>
        <div style={{
          fontSize: 52, fontWeight: 900, lineHeight: 1,
          background: "linear-gradient(135deg, #ec6c04 0%, #f5a623 40%, #149cac 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          marginBottom: 12,
        }}>P+</div>
        <div style={{ fontSize: 13, fontWeight: 300, color: "rgba(255,255,255,0.5)", letterSpacing: 8, textTransform: "uppercase", marginBottom: 8 }}>
          PRODUCTIVITY-PLUS
        </div>
        <div style={{ height: 1, background: "linear-gradient(90deg, transparent, #ec6c04, #149cac, transparent)", width: 200, margin: "0 auto 20px" }} />
        <div style={{ fontSize: 18, fontWeight: 600, color: "#fff", letterSpacing: 1 }}>
          Selecciona tu perfil
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 6 }}>
          Elige quién eres para ingresar al tablero
        </div>
      </div>

      {/* User grid */}
      <div style={{
        position: "relative", zIndex: 2,
        display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 16,
        maxWidth: 700, padding: "0 20px",
      }}>
        {participants.map((p, i) => {
          const color = getUserColor(p.name);
          const online = isOnline(p.id);
          const isHovered = hovered === p.id;
          const isSelected = selected === p.id;
          return (
            <div
              key={p.id}
              onMouseEnter={() => setHovered(p.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => !isSelected && handleSelect(p)}
              style={{
                width: 130, padding: "20px 10px", borderRadius: 16,
                background: isSelected ? "rgba(236,108,4,0.15)" : isHovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${isSelected ? color : isHovered ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
                cursor: isSelected ? "default" : "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                animation: isSelected ? "selectedZoom 0.6s ease forwards 0.1s" : `cardEntrance 0.5s ease ${i * 0.07}s both`,
                transition: "background 0.3s, border 0.3s, transform 0.3s",
                transform: isHovered && !isSelected ? "translateY(-4px)" : "none",
              }}
            >
              {/* Avatar */}
              <div style={{ position: "relative" }}>
                <div style={{
                  width: 56, height: 56, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, fontWeight: 800, color: "#fff",
                  boxShadow: isHovered ? `0 0 20px ${color}66` : `0 4px 12px ${color}33`,
                  transition: "box-shadow 0.3s",
                  animation: isSelected ? "selectedPulse 0.8s ease" : isHovered ? "float 2s ease infinite" : "none",
                }}>
                  {getInitials(p.name)}
                </div>
                {/* Online indicator */}
                {online && (
                  <div style={{ position: "absolute", bottom: 2, right: 2 }}>
                    <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#27ae60", border: "2px solid #0d0d1a" }} />
                    <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#27ae60", animation: "onlinePing 1.5s ease infinite" }} />
                  </div>
                )}
              </div>
              {/* Name */}
              <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", textAlign: "center", lineHeight: 1.3 }}>
                {p.name}
              </div>
              {online && (
                <div style={{ fontSize: 9, fontWeight: 600, color: "#27ae60", textTransform: "uppercase", letterSpacing: 1 }}>
                  En línea
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <div style={{ position: "absolute", bottom: 24, fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: 2, zIndex: 2 }}>
        Productivity-Plus · Gestión Estratégica
      </div>
    </div>
  );
}

// ─── IntroScreen ───────────────────────────────────────────
function IntroScreen({ onFinish }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 300);
    const t2 = setTimeout(() => setPhase(2), 1000);
    const t3 = setTimeout(() => setPhase(3), 2000);
    const t4 = setTimeout(() => setPhase(4), 3000);
    const t5 = setTimeout(() => onFinish(), 4200);
    return () => [t1,t2,t3,t4,t5].forEach(clearTimeout);
  }, [onFinish]);

  return (
    <div
      onClick={onFinish}
      style={{
        position: "fixed", inset: 0, background: "#0d0d1a",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        zIndex: 9999, cursor: "pointer", overflow: "hidden",
        opacity: phase === 4 ? 0 : 1,
        transition: phase === 4 ? "opacity 0.9s ease" : "none",
      }}
    >
      <style>{`
        @keyframes expandLine { from { width: 0; opacity: 0; } to { width: 100%; opacity: 1; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleIn { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: scale(1); } }
        @keyframes glowPulse {
          0%, 100% { text-shadow: 0 0 40px rgba(236,108,4,0.4), 0 0 80px rgba(236,108,4,0.2); }
          50%       { text-shadow: 0 0 60px rgba(236,108,4,0.8), 0 0 120px rgba(236,108,4,0.4); }
        }
        @keyframes drawBorder { from { stroke-dashoffset: 600; } to { stroke-dashoffset: 0; } }
        @keyframes floatParticle {
          0%   { transform: translateY(0px) translateX(0px); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(-120px) translateX(20px); opacity: 0; }
        }
        @keyframes scanLine { from { top: 0%; } to { top: 100%; } }
        @keyframes counterUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Fondo con grid perspectiva */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage:
          "linear-gradient(rgba(20,156,172,0.06) 1px, transparent 1px), " +
          "linear-gradient(90deg, rgba(20,156,172,0.06) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
        opacity: phase >= 1 ? 1 : 0, transition: "opacity 1.2s ease",
      }} />

      {/* Gradiente radial central */}
      <div style={{
        position: "absolute", width: 600, height: 600, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(84,44,156,0.18) 0%, transparent 70%)",
        opacity: phase >= 1 ? 1 : 0, transition: "opacity 1s ease",
      }} />

      {/* Línea de scan */}
      {phase >= 1 && phase < 4 && (
        <div style={{
          position: "absolute", left: 0, right: 0, height: 1,
          background: "linear-gradient(90deg, transparent, rgba(236,108,4,0.6), transparent)",
          animation: "scanLine 2.5s linear infinite", zIndex: 1,
        }} />
      )}

      {/* Partículas flotantes */}
      {phase >= 1 && [
        { left:"15%", delay:"0s",   size:3, color:"#ec6c04" },
        { left:"25%", delay:"0.4s", size:2, color:"#149cac" },
        { left:"40%", delay:"0.8s", size:4, color:"#542c9c" },
        { left:"55%", delay:"0.2s", size:2, color:"#ec6c04" },
        { left:"68%", delay:"0.6s", size:3, color:"#149cac" },
        { left:"78%", delay:"1s",   size:2, color:"#542c9c" },
        { left:"88%", delay:"0.3s", size:3, color:"#ec6c04" },
        { left:"10%", delay:"0.7s", size:2, color:"#149cac" },
      ].map((p, i) => (
        <div key={i} style={{
          position: "absolute", bottom: "10%", left: p.left,
          width: p.size, height: p.size, borderRadius: "50%",
          background: p.color, boxShadow: `0 0 6px ${p.color}`,
          animation: `floatParticle ${2.5 + i * 0.3}s ${p.delay} ease-in-out infinite`,
        }} />
      ))}

      {/* Contenido central */}
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>

        {/* SVG Marco animado */}
        {phase >= 1 && (
          <div style={{
            position: "absolute", top: -60, left: -80,
            width: "calc(100% + 160px)", height: "calc(100% + 120px)",
            opacity: phase >= 2 ? 0.6 : 0, transition: "opacity 0.8s ease", pointerEvents: "none",
          }}>
            <svg width="100%" height="100%" viewBox="0 0 500 200" preserveAspectRatio="none">
              <rect x="2" y="2" width="496" height="196" rx="8" fill="none"
                stroke="url(#borderGrad)" strokeWidth="1"
                strokeDasharray="600" strokeDashoffset="600"
                style={{ animation: "drawBorder 1.2s ease forwards 0.5s" }}
              />
              <defs>
                <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%"   stopColor="#ec6c04" stopOpacity="0.8" />
                  <stop offset="50%"  stopColor="#149cac" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#542c9c" stopOpacity="0.8" />
                </linearGradient>
              </defs>
              <line x1="2"   y1="30"  x2="2"   y2="2"   stroke="#ec6c04" strokeWidth="2" opacity="0.9"/>
              <line x1="2"   y1="2"   x2="30"  y2="2"   stroke="#ec6c04" strokeWidth="2" opacity="0.9"/>
              <line x1="498" y1="170" x2="498" y2="198" stroke="#ec6c04" strokeWidth="2" opacity="0.9"/>
              <line x1="498" y1="198" x2="470" y2="198" stroke="#ec6c04" strokeWidth="2" opacity="0.9"/>
            </svg>
          </div>
        )}

        {/* Logo P+ */}
        <div style={{
          fontSize: 100, fontWeight: 900, lineHeight: 1,
          background: "linear-gradient(135deg, #ec6c04 0%, #f5a623 40%, #149cac 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          opacity: phase >= 1 ? 1 : 0,
          transform: phase >= 1 ? "scale(1)" : "scale(0.5)",
          transition: "all 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)",
          animation: phase >= 2 ? "glowPulse 2.5s ease infinite" : "none",
          letterSpacing: -4, marginBottom: 8,
        }}>P+</div>

        {/* Línea separadora */}
        <div style={{
          height: 1,
          background: "linear-gradient(90deg, transparent, #ec6c04, #149cac, #542c9c, transparent)",
          marginBottom: 16,
          opacity: phase >= 2 ? 1 : 0,
          animation: phase >= 2 ? "expandLine 0.6s ease forwards" : "none",
          width: phase >= 2 ? "100%" : 0,
        }} />

        {/* Nombre del producto */}
        <div style={{
          fontSize: 28, fontWeight: 300, color: "#ffffff",
          letterSpacing: 14, textTransform: "uppercase",
          opacity: phase >= 2 ? 1 : 0,
          animation: phase >= 2 ? "fadeUp 0.7s ease forwards" : "none",
          marginBottom: 6,
        }}>PRODUCTIVITY-PLUS</div>

        {/* Subtítulo */}
        <div style={{
          fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,0.45)",
          letterSpacing: 5, textTransform: "uppercase",
          opacity: phase >= 3 ? 1 : 0,
          animation: phase >= 3 ? "fadeIn 0.8s ease forwards" : "none",
          marginBottom: 0,
        }}>Productivity-Plus · Gestión Estratégica</div>

        {/* Línea inferior */}
        <div style={{
          marginTop: 16, height: 1,
          background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
          width: "100%",
          opacity: phase >= 2 ? 1 : 0,
          animation: phase >= 2 ? "expandLine 0.6s ease 0.2s forwards" : "none",
        }} />
      </div>

      {/* Indicador de carga */}
      {phase >= 3 && (
        <div style={{
          position: "absolute", bottom: 40,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          animation: "fadeIn 0.5s ease forwards",
        }}>
          <div style={{ width: 200, height: 2, background: "rgba(255,255,255,0.1)", borderRadius: 1, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              background: "linear-gradient(90deg, #ec6c04, #149cac)",
              borderRadius: 1,
              width: phase >= 3 ? "100%" : "0%",
              transition: "width 1s ease",
            }} />
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: 3, textTransform: "uppercase" }}>Iniciando sistema</span>
        </div>
      )}

      {/* Hint clic */}
      {phase >= 3 && (
        <div style={{
          position: "absolute", bottom: 16, right: 20,
          fontSize: 10, color: "rgba(255,255,255,0.2)", letterSpacing: 2,
          animation: "fadeIn 0.5s ease forwards",
        }}>
          clic para continuar
        </div>
      )}
    </div>
  );
}

// ─── ProjectLandingScreen ──────────────────────────────────
function ProjectLandingScreen({ onProjectLoaded, authUser = null }) {
  const [tab, setTab] = useState('join'); // 'create' | 'join' | 'template'
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [projName, setProjName] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projPin, setProjPin] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [err, setErr] = useState("");
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [tplPin, setTplPin] = useState("");
  const [tplCreating, setTplCreating] = useState(false);
  const [myProjects, setMyProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [deletingProject, setDeletingProject] = useState(null); // project being confirmed for deletion
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);
  const DELETE_CONFIRM_PHRASE = 'Borrar Proyecto';

  useEffect(() => {
    supabase.from('project_templates').select('*').then(({ data }) => { if (data) setTemplates(data); });
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const loadMyProjects = async () => {
      setLoadingProjects(true);
      const seen = new Set();
      const all = [];
      const add = (p) => { if (p?.id && !seen.has(p.id)) { seen.add(p.id); all.push(p); } };

      // Use allSettled so a missing column (migration not run) doesn't break everything
      const [ownedRes, memberByIdRes, memberByEmailRes] = await Promise.allSettled([
        supabase.from('projects').select('*').eq('owner_id', authUser.id),
        supabase.from('project_members').select('project_id, projects(*)').eq('user_id', authUser.id),
        supabase.from('project_members').select('project_id, projects(*)').eq('email', authUser.email),
      ]);
      (ownedRes.value?.data || []).forEach(add);
      (memberByIdRes.value?.data || []).forEach(m => m.projects && add(m.projects));
      (memberByEmailRes.value?.data || []).forEach(m => m.projects && add(m.projects));

      // Fallback: any project ID stored in localStorage (covers projects created before auth)
      const storedIds = [localStorage.getItem('pp_project_id'), localStorage.getItem('pp_last_project_id')].filter(Boolean);
      await Promise.all(storedIds.map(async (pid) => {
        const { data: p } = await supabase.from('projects').select('*').eq('id', Number(pid)).single();
        if (p) {
          add(p);
          // Auto-register in project_members so future loads work without localStorage
          await supabase.from('project_members').upsert(
            { project_id: p.id, email: authUser.email, name: authUser.user_metadata?.full_name || authUser.email },
            { onConflict: 'project_id,email' }
          );
        }
      }));

      setMyProjects(all);
      setLoadingProjects(false);
    };
    loadMyProjects();
  }, [authUser]);

  const isPremium = authUser?.user_metadata?.plan === 'premium';
  const projectLimit = isPremium ? 10 : 3;
  const ownedCount = myProjects.filter(p => p.owner_id === authUser?.id).length;
  const atLimit = ownedCount >= projectLimit;

  // Returns the authenticated user that will actually back the JWT on the
  // next request. We must use auth.getUser() (server round-trip) instead of
  // auth.getSession() (local cache only): a cached session can look fine
  // while its access_token is already expired, causing RLS to see
  // auth.uid() = NULL even though the React layer thinks we're logged in.
  // If validation fails, try refreshing once before giving up.
  const getSessionUserOrFail = async () => {
    const probe = await supabase.auth.getUser();
    if (!probe.error && probe.data?.user) {
      return { user: probe.data.user };
    }
    console.warn('[auth] getUser failed, attempting refresh', probe.error);
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed?.session?.user) {
      console.error('[auth] refresh failed', refreshErr);
      return { error: 'Tu sesión expiró. Vuelve a iniciar sesión para crear proyectos.' };
    }
    // Re-validate after refresh to be sure.
    const recheck = await supabase.auth.getUser();
    if (recheck.error || !recheck.data?.user) {
      return { error: 'No se pudo validar tu sesión. Cierra sesión y vuelve a entrar.' };
    }
    return { user: recheck.data.user };
  };

  const confirmDeleteProject = async () => {
    if (!deletingProject) return;
    if (deleteConfirmText !== DELETE_CONFIRM_PHRASE) {
      setErr(`Debes escribir exactamente "${DELETE_CONFIRM_PHRASE}" para confirmar.`);
      return;
    }
    setDeletingBusy(true);
    setErr('');
    const { error } = await supabase.from('projects').delete().eq('id', deletingProject.id);
    setDeletingBusy(false);
    if (error) {
      console.error('[deleteProject] error:', error);
      setErr('No se pudo borrar el proyecto: ' + (error.message || 'desconocido'));
      return;
    }
    // Clean up local references so we don't try to reopen the dead project.
    const stored = localStorage.getItem('pp_project_id');
    if (stored && Number(stored) === Number(deletingProject.id)) {
      localStorage.removeItem('pp_project_id');
    }
    const storedLast = localStorage.getItem('pp_last_project_id');
    if (storedLast && Number(storedLast) === Number(deletingProject.id)) {
      localStorage.removeItem('pp_last_project_id');
    }
    setMyProjects(prev => prev.filter(p => p.id !== deletingProject.id));
    setDeletingProject(null);
    setDeleteConfirmText('');
  };

  const createProject = async () => {
    if (!projName.trim()) { setErr("El nombre del proyecto es requerido."); return; }
    if (!projPin || projPin.length < 4) { setErr("La clave debe tener al menos 4 caracteres."); return; }
    if (atLimit) {
      setErr(`Límite alcanzado: ${projectLimit} proyectos ${isPremium ? '(Premium)' : '(cuenta gratuita)'}. ${!isPremium ? 'Actualiza a Premium para crear hasta 10 proyectos.' : ''}`);
      return;
    }
    setCreating(true); setErr("");
    const session = await getSessionUserOrFail();
    if (session.error) { setErr(session.error); setCreating(false); return; }
    const ownerId = session.user.id;
    const config = {
      pin: projPin,
      dimensions: DEFAULT_DIMENSIONS,
    };
    console.info('[createProject] sending RPC create_project_secure', { sessionUserId: session.user.id, sessionEmail: session.user.email });

    // Preferred path: server-side RPC that derives owner_id from auth.uid().
    // Removes any room for client/server JWT desync to cause an RLS denial.
    let data = null;
    let error = null;
    const rpc = await supabase.rpc('create_project_secure', {
      p_name: projName.trim(),
      p_description: projDesc.trim(),
      p_config: config,
    });
    if (!rpc.error && rpc.data) {
      data = rpc.data;
    } else if (rpc.error?.code === '42883' || /function .* does not exist/i.test(rpc.error?.message || '')) {
      // Migration 009 not applied yet — fall back to the legacy direct insert.
      console.warn('[createProject] RPC not found, falling back to direct insert');
      const payload = { name: projName.trim(), description: projDesc.trim(), config, owner_id: ownerId };
      const ins = await supabase.from('projects').insert(payload).select().single();
      data = ins.data; error = ins.error;
    } else {
      error = rpc.error;
    }

    if (error || !data) {
      // Server-side observability: ask the DB what it sees in the JWT.
      let diag = null;
      try {
        const d = await supabase.rpc('whoami_diag');
        diag = d.error ? { rpcError: d.error.message } : d.data;
      } catch (e) { diag = { caught: String(e) }; }
      console.error('[createProject] failed', {
        code: error?.code,
        status: error?.status,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        ownerIdSent: ownerId,
        sessionUserId: session.user.id,
        serverWhoami: diag,
      });
      const msg = error?.message || 'desconocido';
      const isAuthNull = /auth\.uid is NULL/i.test(msg) || diag?.uid === null;
      const isRls = error?.code === '42501' || /row-level security/i.test(msg) || error?.status === 403;
      setErr(isAuthNull
        ? 'El servidor no reconoce tu sesión (auth.uid es null). Cierra sesión y vuelve a entrar.'
        : isRls
          ? 'Permiso denegado por el servidor. Revisa la consola y cierra/abre sesión.'
          : 'Error creando proyecto: ' + msg);
      setCreating(false);
      return;
    }
    await supabase.from('project_members').upsert(
      { project_id: data.id, email: session.user.email, name: session.user.user_metadata?.full_name || session.user.email, user_id: ownerId },
      { onConflict: 'project_id,email' }
    );
    localStorage.setItem('pp_project_id', String(data.id));
    onProjectLoaded(data);
  };

  const createFromTemplate = async () => {
    if (!selectedTemplate) return;
    if (!tplPin || tplPin.length < 4) { setErr("La clave debe tener al menos 4 caracteres."); return; }
    if (atLimit) {
      setErr(`Límite alcanzado: ${projectLimit} proyectos ${isPremium ? '(Premium)' : '(cuenta gratuita)'}. ${!isPremium ? 'Actualiza a Premium para crear hasta 10 proyectos.' : ''}`);
      return;
    }
    setTplCreating(true); setErr("");
    const session = await getSessionUserOrFail();
    if (session.error) { setErr(session.error); setTplCreating(false); return; }
    const ownerId = session.user.id;
    const tpl = selectedTemplate;
    const config = {
      pin: tplPin,
      dimensions: tpl.config?.dimensions || DEFAULT_DIMENSIONS,
    };
    const { data: proj, error } = await supabase.from('projects').insert({ name: tpl.name, description: tpl.description, config, owner_id: ownerId }).select().single();
    if (error || !proj) {
      console.error('[createFromTemplate] insert error:', error);
      const msg = error?.message || 'desconocido';
      const isRls = error?.code === '42501' || /row-level security/i.test(msg);
      setErr(isRls
        ? 'Tu sesión no coincide con el dueño esperado. Cierra sesión y vuelve a entrar.'
        : 'Error creando proyecto: ' + msg);
      setTplCreating(false);
      return;
    }
    await supabase.from('project_members').upsert(
      { project_id: proj.id, email: session.user.email, name: session.user.user_metadata?.full_name || session.user.email, user_id: ownerId },
      { onConflict: 'project_id,email' }
    );
    // Insert sample tasks
    const taskSchema = Array.isArray(tpl.tasks_schema) ? tpl.tasks_schema : [];
    if (taskSchema.length) {
      const sampleTasks = [];
      for (const [i, t] of taskSchema.entries()) {
        const { data: claimedId } = await supabase.rpc('claim_task_id');
        sampleTasks.push({
          id: claimedId || Date.now() + i, title: t.title, type: t.type || 'Operativa', status: t.status || 'Sin iniciar',
          project_id: proj.id, estimated_time: 5, difficulty: 5, strategic_value: 5,
          progress_percent: 0, subtasks: [], indicators: [],
        });
      }
      await supabase.from('tasks').insert(sampleTasks);
    }
    // Insert sample indicators
    const inds = Array.isArray(tpl.indicators) ? tpl.indicators : [];
    if (inds.length) {
      await supabase.from('indicators').insert(inds.map((name) => ({ name, project_id: proj.id })));
    }
    localStorage.setItem('pp_project_id', String(proj.id));
    onProjectLoaded(proj);
  };

  const joinProject = async () => {
    const code = joinCode.trim();
    if (!code) { setErr("Ingresa el código de invitación."); return; }
    setJoining(true); setErr("");
    const data = await joinProjectByCode(code, authUser);
    if (!data) { setErr("Código inválido o proyecto no encontrado."); setJoining(false); return; }
    localStorage.setItem('pp_project_id', String(data.id));
    onProjectLoaded(data);
  };

  const btnBase = { border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontWeight: 700, fontSize: 14, width: "100%", transition: "all 0.2s" };
  const inp = { background: "#fafafa", border: "1.5px solid #e0e0e0", borderRadius: 8, padding: "10px 14px", fontSize: 14, outline: "none", fontFamily: "inherit", color: "#2d2d2d", width: "100%", boxSizing: "border-box", transition: "border-color 0.2s" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0d0d1a 0%,#1a1a2e 50%,#2d1b4e 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 460 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 72, fontWeight: 900, background: "linear-gradient(135deg,#ec6c04,#f5a623,#149cac)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1, letterSpacing: -3 }}>P+</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 5, textTransform: "uppercase", marginTop: 6 }}>Productivity-Plus</div>
        </div>

        {/* Logged-in user */}
        {authUser && (
          <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            {authUser.email} · <button onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', fontFamily: 'inherit' }}>Cerrar sesión</button>
          </div>
        )}

        {/* My Projects */}
        {authUser && (loadingProjects ? (
          <div style={{ textAlign: 'center', marginBottom: 20, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Cargando proyectos...</div>
        ) : myProjects.length > 0 ? (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 10, textAlign: 'center' }}>Mis proyectos</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myProjects.map(proj => {
                const isOwner = proj.owner_id === authUser.id;
                return (
                  <div key={proj.id} style={{ position: 'relative', display: 'flex', alignItems: 'stretch', gap: 0 }}>
                    <button
                      onClick={() => { localStorage.setItem('pp_project_id', String(proj.id)); onProjectLoaded(proj); }}
                      style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRight: isOwner ? 'none' : '1px solid rgba(255,255,255,0.12)', borderRadius: isOwner ? '12px 0 0 12px' : 12, padding: '14px 18px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s', fontFamily: 'inherit', color: 'inherit' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: proj.description ? 3 : 0 }}>{proj.name}</div>
                      {proj.description && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 }}>{proj.description}</div>}
                      {isOwner && <div style={{ fontSize: 10, color: '#ec6c04', marginTop: 5, fontWeight: 700, letterSpacing: 0.5 }}>PROPIETARIO</div>}
                    </button>
                    {isOwner && (
                      <button
                        title="Borrar proyecto"
                        onClick={(e) => { e.stopPropagation(); setDeletingProject(proj); setDeleteConfirmText(''); setErr(''); }}
                        style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)', borderLeft: 'none', borderRadius: '0 12px 12px 0', color: '#f87171', cursor: 'pointer', padding: '0 14px', fontSize: 16, fontFamily: 'inherit', transition: 'all 0.2s' }}>
                        🗑
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ textAlign: 'center', margin: '16px 0 4px', fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>— o crea / únete a otro proyecto —</div>
          </div>
        ) : null)}

        {/* Card */}
        <div style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 4, marginBottom: 28 }}>
            {[['join','Unirse'],['create','Crear'],['template','Plantillas']].map(([t, l]) => (
              <button key={t} onClick={() => { setTab(t); setErr(""); setSelectedTemplate(null); }}
                style={{ flex: 1, background: tab === t ? "rgba(236,108,4,0.9)" : "transparent", color: "#fff", border: "none", borderRadius: 8, padding: "9px", cursor: "pointer", fontWeight: tab === t ? 700 : 400, fontSize: 12, transition: "all 0.2s" }}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'join' ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Código de invitación</label>
                <input style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                  value={joinCode} onChange={e => setJoinCode(e.target.value)} onKeyDown={e => e.key === "Enter" && joinProject()}
                  placeholder="Pega el código aquí..." autoFocus />
              </div>
              {err && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{err}</div>}
              <button onClick={joinProject} disabled={joining}
                style={{ ...btnBase, background: joining ? "#555" : "linear-gradient(135deg,#ec6c04,#f07d1e)", color: "#fff", boxShadow: joining ? "none" : "0 4px 20px rgba(236,108,4,0.4)", marginTop: 4 }}>
                {joining ? "Verificando..." : "Unirse al proyecto →"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Nombre del proyecto *</label>
                <input style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                  value={projName} onChange={e => setProjName(e.target.value)} placeholder="Ej: Equipo Comercial Q2" autoFocus />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Descripción (opcional)</label>
                <input style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                  value={projDesc} onChange={e => setProjDesc(e.target.value)} placeholder="Breve descripción del proyecto..." />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Clave de configuración *</label>
                <input type="password" style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                  value={projPin} onChange={e => setProjPin(e.target.value)} onKeyDown={e => e.key === "Enter" && createProject()} placeholder="Mínimo 4 caracteres..." />
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>Solo el dueño del proyecto conoce esta clave</div>
              </div>
              {authUser && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: atLimit ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${atLimit ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 8, padding: '8px 12px' }}>
                  <span style={{ fontSize: 11, color: atLimit ? '#f87171' : 'rgba(255,255,255,0.45)' }}>
                    Proyectos creados: {ownedCount} / {projectLimit}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: isPremium ? '#f5a623' : 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>
                    {isPremium ? 'Premium' : 'Gratuito'}
                  </span>
                </div>
              )}
              {err && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{err}</div>}
              <button onClick={createProject} disabled={creating || atLimit}
                style={{ ...btnBase, background: (creating || atLimit) ? '#555' : 'linear-gradient(135deg,#542c9c,#6e3ebf)', color: '#fff', boxShadow: (creating || atLimit) ? 'none' : '0 4px 20px rgba(84,44,156,0.4)', marginTop: 4, opacity: atLimit ? 0.6 : 1, cursor: atLimit ? 'not-allowed' : 'pointer' }}>
                {creating ? 'Creando proyecto...' : atLimit ? `Límite de ${projectLimit} proyectos alcanzado` : 'Crear proyecto →'}
              </button>
            </div>
          )}

          {tab === 'template' && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {templates.length === 0 && (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "20px 0" }}>Cargando plantillas...</div>
              )}
              {!selectedTemplate ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {templates.map(tpl => (
                    <div key={tpl.id} onClick={() => setSelectedTemplate(tpl)} style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "14px 16px", cursor: "pointer", transition: "all 0.2s" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{tpl.name}</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>{tpl.description}</div>
                      <div style={{ marginTop: 8, fontSize: 11, color: "rgba(236,108,4,0.8)" }}>
                        {(Array.isArray(tpl.tasks_schema) ? tpl.tasks_schema : []).length} tareas de ejemplo
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => setSelectedTemplate(null)} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>← Volver</button>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{selectedTemplate.name}</span>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Clave de configuración *</label>
                    <input type="password" style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                      value={tplPin} onChange={e => setTplPin(e.target.value)} placeholder="Mínimo 4 caracteres..." autoFocus />
                  </div>
                  {authUser && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: atLimit ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${atLimit ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 8, padding: '8px 12px' }}>
                      <span style={{ fontSize: 11, color: atLimit ? '#f87171' : 'rgba(255,255,255,0.45)' }}>
                        Proyectos creados: {ownedCount} / {projectLimit}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: isPremium ? '#f5a623' : 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>
                        {isPremium ? 'Premium' : 'Gratuito'}
                      </span>
                    </div>
                  )}
                  {err && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{err}</div>}
                  <button onClick={createFromTemplate} disabled={tplCreating || atLimit}
                    style={{ ...btnBase, background: (tplCreating || atLimit) ? '#555' : 'linear-gradient(135deg,#ec6c04,#f07d1e)', color: '#fff', boxShadow: (tplCreating || atLimit) ? 'none' : '0 4px 20px rgba(236,108,4,0.4)', opacity: atLimit ? 0.6 : 1, cursor: atLimit ? 'not-allowed' : 'pointer' }}>
                    {tplCreating ? 'Creando...' : atLimit ? `Límite de ${projectLimit} proyectos alcanzado` : `Crear proyecto desde "${selectedTemplate.name}" →`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: 2 }}>
          PRODUCTIVITY-PLUS · GESTIÓN ESTRATÉGICA
        </div>
      </div>

      {/* ── Confirm-delete-project modal ─────────────────── */}
      {deletingProject && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
             onClick={() => { if (!deletingBusy) { setDeletingProject(null); setDeleteConfirmText(''); setErr(''); } }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background: 'rgba(20,18,28,0.98)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 16, padding: '28px 28px 24px', maxWidth: 460, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#f87171', marginBottom: 8, letterSpacing: 0.3 }}>⚠ Borrar proyecto</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.55, marginBottom: 14 }}>
              Vas a borrar <strong style={{ color: '#fff' }}>"{deletingProject.name}"</strong>. Se eliminarán para siempre todas sus tareas, indicadores, OKRs, sprints, plantillas de campos, historial y miembros. <strong style={{ color: '#fcd34d' }}>Esta acción no se puede deshacer.</strong>
            </div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Escribe <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 6px', borderRadius: 4, color: '#fcd34d' }}>{DELETE_CONFIRM_PHRASE}</code> para confirmar
            </label>
            <input
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deletingBusy}
              placeholder={DELETE_CONFIRM_PHRASE}
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#fff', outline: 'none', fontFamily: 'inherit', marginBottom: 12 }}
            />
            {err && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                disabled={deletingBusy}
                onClick={() => { setDeletingProject(null); setDeleteConfirmText(''); setErr(''); }}
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '9px 18px', color: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                Cancelar
              </button>
              <button
                disabled={deletingBusy || deleteConfirmText !== DELETE_CONFIRM_PHRASE}
                onClick={confirmDeleteProject}
                style={{ background: deleteConfirmText === DELETE_CONFIRM_PHRASE && !deletingBusy ? 'linear-gradient(135deg,#dc2626,#ef4444)' : 'rgba(220,38,38,0.3)', border: 'none', borderRadius: 8, padding: '9px 18px', color: '#fff', cursor: deleteConfirmText === DELETE_CONFIRM_PHRASE && !deletingBusy ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
                {deletingBusy ? 'Borrando…' : 'Borrar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DependenciesTab ───────────────────────────────────────
const NODE_W = 170;
const NODE_H = 76;
const NODE_GAP_X = 60;
const NODE_GAP_Y = 16;

// Parse "12,15,18" or legacy "12" → ["12","15","18"]
const parseDeps = (depStr) => {
  if (!depStr) return [];
  return String(depStr).split(',').map(s => s.trim()).filter(Boolean);
};

function computeDepLayout(tasks) {
  const byId = {};
  tasks.forEach(t => { byId[String(t.id)] = t; });
  const levels = {};
  const computing = new Set();
  const getLevel = (id) => {
    if (levels[id] !== undefined) return levels[id];
    if (computing.has(id)) return 0;
    computing.add(id);
    const t = byId[id];
    const depIds = parseDeps(t?.dependentTask);
    if (!t || depIds.length === 0) { levels[id] = 0; }
    else { levels[id] = Math.max(...depIds.map(did => getLevel(did))) + 1; }
    computing.delete(id);
    return levels[id];
  };
  tasks.forEach(t => getLevel(String(t.id)));

  const byLevel = {};
  tasks.forEach(t => {
    const lvl = levels[String(t.id)] ?? 0;
    if (!byLevel[lvl]) byLevel[lvl] = [];
    byLevel[lvl].push(t);
  });

  const positions = {};
  Object.entries(byLevel).forEach(([lvl, ts]) => {
    ts.forEach((t, i) => {
      positions[String(t.id)] = {
        x: Number(lvl) * (NODE_W + NODE_GAP_X) + 24,
        y: i * (NODE_H + NODE_GAP_Y) + 24,
      };
    });
  });

  const maxLvl = Math.max(...Object.keys(byLevel).map(Number), 0);
  const maxRows = Math.max(...Object.values(byLevel).map(a => a.length), 1);
  return {
    positions,
    levels,
    svgW: (maxLvl + 1) * (NODE_W + NODE_GAP_X) + 48,
    svgH: maxRows * (NODE_H + NODE_GAP_Y) + 48,
    byLevel,
  };
}

function DependenciesTab({ tasks, onEditTask, sprints = [] }) {
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

// ─── OKRsTab ───────────────────────────────────────────────
function OKRsTab({ projectId, okrs, setOkrs, keyResults, setKeyResults, tasks }) {
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', quarter: Math.ceil((new Date().getMonth() + 1) / 3), year: new Date().getFullYear() });
  const [addingKrFor, setAddingKrFor] = useState(null);
  const [krForm, setKrForm] = useState({ title: '', target_value: 100, unit: '%' });

  const btn = (v) => ({ border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12, padding: '6px 14px', transition: 'all 0.2s', background: v === 'primary' ? 'linear-gradient(135deg,#542c9c,#6e3ebf)' : v === 'danger' ? 'linear-gradient(135deg,#c0392b,#e74c3c)' : '#f4f4f4', color: (v === 'primary' || v === 'danger') ? '#fff' : '#666' });
  const si = { background: '#fafafa', border: '1.5px solid #e0e0e0', borderRadius: 8, color: '#2d2d2d', padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };

  const resetForm = () => { setForm({ title: '', description: '', quarter: Math.ceil((new Date().getMonth() + 1) / 3), year: new Date().getFullYear() }); setCreating(false); setEditId(null); };

  const saveOkr = async () => {
    if (!form.title.trim()) return;
    if (editId) {
      await supabase.from('okrs').update({ title: form.title, description: form.description, quarter: form.quarter, year: form.year }).eq('id', editId).eq('project_id', projectId);
      setOkrs(prev => prev.map(o => o.id === editId ? { ...o, ...form } : o));
    } else {
      const { data } = await supabase.from('okrs').insert({ ...form, project_id: projectId, status: 'active' }).select().single();
      if (data) setOkrs(prev => [...prev, data]);
    }
    resetForm();
  };

  const deleteOkr = async (id) => {
    if (!confirm('¿Eliminar este objetivo y todos sus resultados clave?')) return;
    await supabase.from('okrs').delete().eq('id', id).eq('project_id', projectId);
    setOkrs(prev => prev.filter(o => o.id !== id));
    setKeyResults(prev => prev.filter(kr => kr.okr_id !== id));
  };

  const toggleStatus = async (okr) => {
    const ns = okr.status === 'active' ? 'closed' : 'active';
    await supabase.from('okrs').update({ status: ns }).eq('id', okr.id).eq('project_id', projectId);
    setOkrs(prev => prev.map(o => o.id === okr.id ? { ...o, status: ns } : o));
  };

  const saveKr = async () => {
    if (!krForm.title.trim() || !addingKrFor) return;
    const { data } = await supabase.from('key_results').insert({ ...krForm, okr_id: addingKrFor, project_id: projectId, current_value: 0 }).select().single();
    if (data) setKeyResults(prev => [...prev, data]);
    setKrForm({ title: '', target_value: 100, unit: '%' });
    setAddingKrFor(null);
  };

  const updateKrValue = async (kr, delta) => {
    const nv = Math.max(0, Math.min(Number(kr.target_value), Number(kr.current_value) + delta));
    await supabase.from('key_results').update({ current_value: nv }).eq('id', kr.id).eq('project_id', projectId);
    setKeyResults(prev => prev.map(k => k.id === kr.id ? { ...k, current_value: nv } : k));
  };

  const deleteKr = async (id) => {
    await supabase.from('key_results').delete().eq('id', id).eq('project_id', projectId);
    setKeyResults(prev => prev.filter(k => k.id !== id));
  };

  const getKrPct = (kr) => {
    const linked = tasks.filter(t => t.krId === kr.id);
    if (linked.length) return (linked.filter(t => t.status === 'Finalizada').length / linked.length) * 100;
    return Number(kr.target_value) > 0 ? (Number(kr.current_value) / Number(kr.target_value)) * 100 : 0;
  };

  const grouped = {};
  okrs.forEach(o => { const k = `${o.year}-Q${o.quarter}`; if (!grouped[k]) grouped[k] = []; grouped[k].push(o); });
  const periods = Object.keys(grouped).sort().reverse();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#542c9c' }}>OKRs · Objetivos y Resultados Clave</div>
        <button onClick={() => { setCreating(true); setEditId(null); setForm({ title: '', description: '', quarter: Math.ceil((new Date().getMonth() + 1) / 3), year: new Date().getFullYear() }); }} style={{ ...btn('primary'), marginLeft: 'auto' }}>+ Nuevo objetivo</button>
      </div>

      {(creating || editId) && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 14px rgba(84,44,156,0.07)', marginBottom: 16, border: '2px solid rgba(84,44,156,0.15)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#542c9c', marginBottom: 12 }}>{editId ? 'Editar objetivo' : 'Nuevo objetivo'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={{ gridColumn: 'span 2' }}><input style={si} placeholder="Título del objetivo *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} autoFocus /></div>
            <div style={{ gridColumn: 'span 2' }}><input style={si} placeholder="Descripción (opcional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
            <select style={si} value={form.quarter} onChange={e => setForm(f => ({ ...f, quarter: Number(e.target.value) }))}>
              {[1,2,3,4].map(q => <option key={q} value={q}>Q{q}</option>)}
            </select>
            <input type="number" style={si} min={2020} max={2099} value={form.year} onChange={e => setForm(f => ({ ...f, year: Number(e.target.value) }))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveOkr} style={btn('primary')}>Guardar</button>
            <button onClick={resetForm} style={btn()}>Cancelar</button>
          </div>
        </div>
      )}

      {okrs.length === 0 && !creating && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#969696', fontSize: 14 }}>
          No hay objetivos registrados.<br /><span style={{ fontSize: 12 }}>Crea objetivos para medir el progreso de tu equipo.</span>
        </div>
      )}

      {periods.map(period => (
        <div key={period} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#542c9c', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>{period.replace('-', ' · ')}</div>
          {grouped[period].map(okr => {
            const krs = keyResults.filter(kr => kr.okr_id === okr.id);
            const avgPct = krs.length ? krs.reduce((s, kr) => s + getKrPct(kr), 0) / krs.length : 0;
            const isActive = okr.status === 'active';
            return (
              <div key={okr.id} style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 14px rgba(84,44,156,0.07)', marginBottom: 12, borderLeft: `4px solid ${isActive ? '#542c9c' : '#ccc'}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2d2d' }}>{okr.title}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: isActive ? '#e8f8ee' : '#f4f4f4', color: isActive ? '#27ae60' : '#969696', textTransform: 'uppercase' }}>{isActive ? 'Activo' : 'Cerrado'}</span>
                    </div>
                    {okr.description && <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{okr.description}</div>}
                    {krs.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, height: 8, background: '#f0e8ff', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${avgPct}%`, background: avgPct >= 80 ? '#27ae60' : avgPct >= 40 ? '#ec6c04' : '#c0392b', borderRadius: 4, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#542c9c', flexShrink: 0 }}>{avgPct.toFixed(0)}%</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => { setEditId(okr.id); setCreating(false); setForm({ title: okr.title, description: okr.description || '', quarter: okr.quarter, year: okr.year }); }} style={{ ...btn(), padding: '6px 10px' }}>✏️</button>
                    <button onClick={() => toggleStatus(okr)} style={{ ...btn(), fontSize: 11 }}>{isActive ? '🔒 Cerrar' : '🔓 Reabrir'}</button>
                    <button onClick={() => deleteOkr(okr.id)} style={{ ...btn('danger'), padding: '6px 10px' }}>🗑️</button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {krs.map(kr => {
                    const pct = getKrPct(kr);
                    const linked = tasks.filter(t => t.krId === kr.id);
                    const fromTasks = linked.length > 0;
                    return (
                      <div key={kr.id} style={{ background: '#faf8ff', borderRadius: 10, padding: '10px 14px', border: '1px solid #e8e0f4' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#2d2d2d', flex: 1 }}>{kr.title}</span>
                          {!fromTasks && (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <button onClick={() => updateKrValue(kr, -10)} style={{ ...btn(), padding: '2px 8px' }}>−</button>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#542c9c', minWidth: 60, textAlign: 'center' }}>{Number(kr.current_value)}/{Number(kr.target_value)} {kr.unit}</span>
                              <button onClick={() => updateKrValue(kr, 10)} style={{ ...btn(), padding: '2px 8px' }}>+</button>
                            </div>
                          )}
                          {fromTasks && (
                            <span style={{ fontSize: 11, color: '#542c9c', fontWeight: 600 }}>{linked.filter(t => t.status === 'Finalizada').length}/{linked.length} tareas</span>
                          )}
                          <button onClick={() => deleteKr(kr.id)} style={{ ...btn('danger'), padding: '2px 8px' }}>✕</button>
                        </div>
                        <div style={{ height: 5, background: '#e8e0f4', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 80 ? '#27ae60' : pct >= 40 ? '#ec6c04' : '#c0392b', borderRadius: 3, transition: 'width 0.4s' }} />
                        </div>
                      </div>
                    );
                  })}

                  {addingKrFor === okr.id ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <input style={{ ...si, flex: 2, minWidth: 160 }} placeholder="Resultado clave *" value={krForm.title} onChange={e => setKrForm(f => ({ ...f, title: e.target.value }))} autoFocus />
                      <input type="number" style={{ ...si, width: 70 }} placeholder="Meta" value={krForm.target_value} onChange={e => setKrForm(f => ({ ...f, target_value: Number(e.target.value) }))} />
                      <input style={{ ...si, width: 55 }} placeholder="%" value={krForm.unit} onChange={e => setKrForm(f => ({ ...f, unit: e.target.value }))} />
                      <button onClick={saveKr} style={btn('primary')}>✓</button>
                      <button onClick={() => { setAddingKrFor(null); setKrForm({ title: '', target_value: 100, unit: '%' }); }} style={btn()}>✕</button>
                    </div>
                  ) : isActive && (
                    <button onClick={() => setAddingKrFor(okr.id)} style={{ ...btn(), textAlign: 'left', fontSize: 11, padding: '5px 12px' }}>+ Agregar resultado clave</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── SprintsTab ────────────────────────────────────────────
function SprintsTab({ projectId, sprints, setSprints, tasks }) {
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', goal: '', start_date: '', end_date: '' });
  const today = new Date().toISOString().split('T')[0];

  const btn = (v) => ({ border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12, padding: '6px 14px', transition: 'all 0.2s', background: v === 'green' ? 'linear-gradient(135deg,#27ae60,#2ecc71)' : v === 'danger' ? 'linear-gradient(135deg,#c0392b,#e74c3c)' : v === 'primary' ? 'linear-gradient(135deg,#542c9c,#6e3ebf)' : '#f4f4f4', color: (v === 'green' || v === 'danger' || v === 'primary') ? '#fff' : '#666' });
  const si = { background: '#fafafa', border: '1.5px solid #e0e0e0', borderRadius: 8, color: '#2d2d2d', padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };

  const activeSprint = sprints.find(s => s.status === 'active');

  const saveSprint = async () => {
    if (!form.name.trim()) return;
    const { data } = await supabase.from('sprints').insert({ ...form, project_id: projectId, status: 'planning' }).select().single();
    if (data) setSprints(prev => [...prev, data]);
    setForm({ name: '', goal: '', start_date: '', end_date: '' });
    setCreating(false);
  };

  const startSprint = async (id) => {
    if (activeSprint) { alert('Ya hay un sprint activo. Ciérralo antes de iniciar otro.'); return; }
    await supabase.from('sprints').update({ status: 'active' }).eq('id', id).eq('project_id', projectId);
    setSprints(prev => prev.map(s => s.id === id ? { ...s, status: 'active' } : s));
  };

  const closeSprint = async (id) => {
    await supabase.from('sprints').update({ status: 'closed' }).eq('id', id).eq('project_id', projectId);
    setSprints(prev => prev.map(s => s.id === id ? { ...s, status: 'closed' } : s));
  };

  const deleteSprint = async (id) => {
    if (!confirm('¿Eliminar este sprint?')) return;
    await supabase.from('sprints').delete().eq('id', id).eq('project_id', projectId);
    setSprints(prev => prev.filter(s => s.id !== id));
  };

  const SprintCard = ({ sprint }) => {
    const spTasks = tasks.filter(t => t.sprintId === sprint.id);
    const done = spTasks.filter(t => t.status === 'Finalizada').length;
    const blocked = spTasks.filter(t => t.status === 'Bloqueada').length;
    const pct = spTasks.length ? Math.round((done / spTasks.length) * 100) : 0;
    const isActive = sprint.status === 'active';
    const isPlanning = sprint.status === 'planning';
    const sc = isActive ? '#ec6c04' : isPlanning ? '#542c9c' : '#969696';

    // Burndown data
    const bdPoints = [];
    if (sprint.start_date && sprint.end_date && spTasks.length) {
      const start = new Date(sprint.start_date);
      const end = new Date(sprint.end_date);
      const days = Math.max(1, Math.ceil((end - start) / 86400000));
      for (let i = 0; i <= Math.min(days, 14); i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const ds = d.toISOString().split('T')[0];
        if (ds > today) break;
        const remaining = spTasks.filter(t => !t.finalizedAt || t.finalizedAt.split(' ')[0] > ds).length;
        bdPoints.push({ x: i, y: remaining });
      }
    }
    const bdMax = Math.max(1, spTasks.length);
    const BDW = 260, BDH = 70;

    return (
      <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 14px rgba(84,44,156,0.07)', marginBottom: 12, borderLeft: `4px solid ${sc}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#2d2d2d' }}>{sprint.name}</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: isActive ? '#fff3ea' : '#f4f4f4', color: sc, textTransform: 'uppercase' }}>{sprint.status}</span>
            </div>
            {sprint.goal && <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>{sprint.goal}</div>}
            <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#666', flexWrap: 'wrap' }}>
              {sprint.start_date && <span>📅 {sprint.start_date}</span>}
              {sprint.end_date && <span>🏁 {sprint.end_date}</span>}
              <span style={{ color: '#542c9c', fontWeight: 700 }}>{spTasks.length} tareas</span>
              {spTasks.length > 0 && <span style={{ color: '#27ae60', fontWeight: 600 }}>{done} ✓</span>}
              {blocked > 0 && <span style={{ color: '#c0392b', fontWeight: 600 }}>{blocked} bloq.</span>}
            </div>
            {spTasks.length > 0 && (
              <div style={{ marginTop: 8, height: 6, background: '#f0e8ff', borderRadius: 3, overflow: 'hidden', maxWidth: 240 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct >= 80 ? '#27ae60' : '#ec6c04', borderRadius: 3, transition: 'width 0.4s' }} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {isPlanning && <button onClick={() => startSprint(sprint.id)} style={btn('green')}>▶ Iniciar</button>}
            {isActive && <button onClick={() => closeSprint(sprint.id)} style={btn()}>⏹ Cerrar</button>}
            <button onClick={() => deleteSprint(sprint.id)} style={{ ...btn('danger'), padding: '6px 10px' }}>🗑️</button>
          </div>
        </div>

        {bdPoints.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#542c9c', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Burndown</div>
            <svg width={BDW} height={BDH + 16} style={{ display: 'block', overflow: 'visible' }}>
              <line x1={0} y1={0} x2={BDW} y2={BDH} stroke="#ddd" strokeWidth={1} strokeDasharray="4" />
              <polyline points={bdPoints.map((p, i) => `${(i / Math.max(bdPoints.length - 1, 1)) * BDW},${(p.y / bdMax) * BDH}`).join(' ')} fill="none" stroke="#ec6c04" strokeWidth={2} strokeLinejoin="round" />
              {bdPoints.map((p, i) => <circle key={i} cx={(i / Math.max(bdPoints.length - 1, 1)) * BDW} cy={(p.y / bdMax) * BDH} r={3} fill="#ec6c04" />)}
              <text x={2} y={10} style={{ fontSize: 9, fill: '#aaa', fontFamily: 'inherit' }}>{bdMax}</text>
              <text x={2} y={BDH - 2} style={{ fontSize: 9, fill: '#aaa', fontFamily: 'inherit' }}>0</text>
            </svg>
          </div>
        )}

        {isActive && spTasks.length > 0 && (
          <div style={{ marginTop: 12, borderTop: '1px solid #f0e8ff', paddingTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#542c9c', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Tareas en este sprint</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {spTasks.map(t => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: '#fafafe', borderRadius: 6, border: '1px solid #e8e0f4' }}>
                  <div style={{ width: 7, height: 7, borderRadius: 2, background: STATUS_COLORS[t.status] || '#888', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, flex: 1, color: '#2d2d2d' }}>#{t.id} {t.title}</span>
                  <span style={{ fontSize: 10, color: STATUS_COLORS[t.status], fontWeight: 600 }}>{t.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const active = sprints.filter(s => s.status === 'active');
  const planning = sprints.filter(s => s.status === 'planning');
  const closed = sprints.filter(s => s.status === 'closed');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#542c9c' }}>Sprints</div>
        <button onClick={() => setCreating(true)} style={{ ...btn('primary'), marginLeft: 'auto' }}>+ Nuevo sprint</button>
      </div>

      {creating && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 14px rgba(84,44,156,0.07)', marginBottom: 16, border: '2px solid rgba(84,44,156,0.15)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#542c9c', marginBottom: 12 }}>Nuevo sprint</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={{ gridColumn: 'span 2' }}><input style={si} placeholder="Nombre del sprint *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
            <div style={{ gridColumn: 'span 2' }}><input style={si} placeholder="Objetivo del sprint..." value={form.goal} onChange={e => setForm(f => ({ ...f, goal: e.target.value }))} /></div>
            <input type="date" style={si} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
            <input type="date" style={si} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveSprint} style={btn('primary')}>Guardar</button>
            <button onClick={() => { setCreating(false); setForm({ name: '', goal: '', start_date: '', end_date: '' }); }} style={btn()}>Cancelar</button>
          </div>
        </div>
      )}

      {active.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#ec6c04', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Sprint activo</div>}
      {active.map(s => <SprintCard key={s.id} sprint={s} />)}

      {planning.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#542c9c', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, marginTop: 16 }}>En planificación</div>}
      {planning.map(s => <SprintCard key={s.id} sprint={s} />)}

      {closed.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#969696', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, marginTop: 16 }}>Cerrados</div>}
      {closed.map(s => <SprintCard key={s.id} sprint={s} />)}

      {sprints.length === 0 && !creating && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#969696', fontSize: 14 }}>
          No hay sprints registrados.<br /><span style={{ fontSize: 12 }}>Crea un sprint para organizar el trabajo en ciclos cortos.</span>
        </div>
      )}
    </div>
  );
}

// ─── PresentationTab (Presentación Sprint) ────────────────
// Vista enfocada en un participante. Muestra todas sus tareas como tarjetas
// con tarjeta resumen al hover/click: aporte, tiempo de cierre, comentarios,
// subtareas, indicador, custom fields opt-in. Útil para reuniones de sprint
// y para que cada persona explique su trabajo al equipo.
function PresentationTab({ tasks, participants, taskFieldDefs, sprints }) {
  const [selectedPersona, setSelectedPersona] = useState("__all__");
  const [selectedSprint, setSelectedSprint] = useState("__all__");
  const [statusFilter, setStatusFilter] = useState("__all__");
  const [hoverTaskId, setHoverTaskId] = useState(null);
  const [pinnedTaskId, setPinnedTaskId] = useState(null);

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
          <select value={selectedPersona} onChange={e => setSelectedPersona(e.target.value)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", fontSize: 14, minWidth: 180 }}>
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

      {/* Grid de tarjetas */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {visibleTasks.length === 0 ? (
          <div style={{ gridColumn: "1/-1", padding: 40, textAlign: "center", color: "#999", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
            No hay tareas con esos filtros.
          </div>
        ) : visibleTasks.map(task => (
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

function PresentationCard({ task, taskFieldDefs, tasks, colorByStatus, isActive, onHover, onLeave, onClick, pinned, focusedPersona }) {
  const status = task.status || "Sin iniciar";
  const statusColor = colorByStatus[status] || "#888";
  const progress = parseFloat(task.progress_percent || task.progressPercent) || 0;
  const aporte = parseFloat(task.aporte_snapshot || task.aporteSnapshot) || 0;

  // Tiempo de cierre real cuando aplique
  const closedAt = task.closed_at || task.closedAt;
  const createdAt = task.inserted_at || task.insertedAt || task.created_at_colombia;
  const diasCierre = (closedAt && createdAt)
    ? Math.max(1, Math.round((new Date(closedAt) - new Date(createdAt)) / 86400000))
    : null;

  const customFields = task.custom_fields || task.customFields || {};
  const visibleCustomFields = (taskFieldDefs || []).filter(d =>
    !d.deleted_at && d.type !== "auto" && d.show_in_presentation
  );

  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const subtasksDone = subtasks.filter(s => s.done).length;

  // Dependencias (CSV "12,34" → IDs múltiples). A quién obstaculizo y quién me obstaculiza.
  const myDeps = parseDeps(task.dependent_task || task.dependentTask);
  const blockingMe = myDeps
    .map(id => tasks.find(t => String(t.id) === id))
    .filter(Boolean);
  const blockedByThis = tasks.filter(t =>
    parseDeps(t.dependent_task || t.dependentTask).includes(String(task.id))
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Tarea ${task.id}: ${task.title}. Estado ${status}. Progreso ${progress}%`}
      aria-pressed={pinned}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onFocus={onHover}
      onBlur={onLeave}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        position: "relative",
        background: "#fff",
        border: `1px solid ${isActive ? statusColor : "#e0e0e0"}`,
        borderRadius: 10,
        padding: 14,
        cursor: "pointer",
        transition: "all 200ms ease",
        boxShadow: isActive ? `0 8px 24px rgba(0,0,0,0.15), 0 0 0 2px ${statusColor}33` : "0 1px 3px rgba(0,0,0,0.05)",
        transform: isActive ? "translateY(-2px)" : "none",
        outline: "none",
      }}
      onKeyUp={(e) => { if (e.key === "Escape") onLeave(); }}
    >
      {pinned && (
        <div style={{ position: "absolute", top: 8, right: 8, fontSize: 10, color: statusColor, fontWeight: 700 }}>📌 FIJADA</div>
      )}

      {/* Cabecera */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ background: statusColor, color: "#fff", padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 600 }}>
          {status}
        </span>
        <span style={{ fontSize: 11, color: "#999" }}>#{task.id}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{progress}%</span>
      </div>

      {/* Título */}
      <div style={{ fontSize: 14, fontWeight: 600, color: "#222", marginBottom: 6, lineHeight: 1.3 }}>
        {task.title || "Sin título"}
      </div>

      {/* Responsable + indicador */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11, color: "#666", marginBottom: 8 }}>
        {task.responsible && <span>👤 {task.responsible}</span>}
        {task.indicator && <span>🎯 {task.indicator}</span>}
        {aporte > 0 && <span>⚡ Aporte {aporte.toFixed(1)}</span>}
      </div>

      {/* Barra de progreso */}
      <div style={{ height: 4, background: "#f0f0f0", borderRadius: 2, overflow: "hidden", marginBottom: isActive ? 12 : 0 }}>
        <div style={{ width: `${progress}%`, height: "100%", background: statusColor, transition: "width 300ms" }} />
      </div>

      {/* Panel desplegado al hover/click */}
      {isActive && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #f0f0f0", fontSize: 12, color: "#555", lineHeight: 1.5 }}>
          {task.expected_delivery && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Entregable</div>
              <div>{task.expected_delivery || task.expectedDelivery}</div>
            </div>
          )}

          {task.comments && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Comentarios y observaciones</div>
              <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 6, marginTop: 4, whiteSpace: "pre-wrap" }}>{task.comments}</div>
            </div>
          )}

          {subtasks.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Subtareas ({subtasksDone}/{subtasks.length})</div>
              <ul style={{ margin: "4px 0 0 0", paddingLeft: 18 }}>
                {subtasks.map((s, i) => (
                  <li key={i} style={{ textDecoration: s.done ? "line-through" : "none", color: s.done ? "#999" : "#444" }}>{s.text}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            {(task.start_date || task.startDate) && (
              <div>
                <div style={{ fontSize: 10, color: "#888" }}>Inicio</div>
                <div>{task.start_date || task.startDate}</div>
              </div>
            )}
            {(task.end_date || task.endDate) && (
              <div>
                <div style={{ fontSize: 10, color: "#888" }}>Fin</div>
                <div>{task.end_date || task.endDate}</div>
              </div>
            )}
            {diasCierre !== null && (
              <div>
                <div style={{ fontSize: 10, color: "#888" }}>Tiempo de cierre</div>
                <div>{diasCierre} día{diasCierre === 1 ? "" : "s"}</div>
              </div>
            )}
            {task.type && (
              <div>
                <div style={{ fontSize: 10, color: "#888" }}>Tipo</div>
                <div>{task.type}</div>
              </div>
            )}
          </div>

          {/* Dependencias visualizadas como chips, estilo Red de tareas. */}
          {(blockingMe.length > 0 || blockedByThis.length > 0) && (
            <div style={{ marginBottom: 10, padding: 10, background: "#fff8f0", borderLeft: "3px solid #ef7218", borderRadius: 4 }}>
              <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 8 }}>
                Enlaces de tareas
                {focusedPersona && <span style={{ color: "#bbb", fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 6 }}>· solo {focusedPersona} en color</span>}
              </div>
              {blockingMe.length > 0 && (
                <div style={{ marginBottom: blockedByThis.length > 0 ? 8 : 0 }}>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>⬅️ Esta tarea depende de:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {blockingMe.map(b => <LinkedTaskChip key={b.id} task={b} colorByStatus={colorByStatus} focusedPersona={focusedPersona} />)}
                  </div>
                </div>
              )}
              {blockedByThis.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>➡️ De esta tarea dependen:</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {blockedByThis.map(b => <LinkedTaskChip key={b.id} task={b} colorByStatus={colorByStatus} focusedPersona={focusedPersona} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Custom fields opt-in */}
          {visibleCustomFields.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>Campos personalizados</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {visibleCustomFields.map(def => {
                  const v = customFields[def.key];
                  if (v === undefined || v === null || v === "") return null;
                  let display = v;
                  if (def.type === "multiselect" && Array.isArray(v)) display = v.join(", ");
                  else if (def.type === "subitems" && Array.isArray(v)) {
                    const done = v.filter(i => i.done).length;
                    display = `${done}/${v.length}`;
                  } else if (typeof v === "object") display = JSON.stringify(v);
                  return (
                    <div key={def.key}>
                      <div style={{ fontSize: 10, color: "#888" }}>{def.label}</div>
                      <div style={{ fontSize: 12 }}>{String(display)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {visibleCustomFields.length === 0 && (taskFieldDefs || []).some(d => !d.deleted_at && d.type !== "auto") && (
            <div style={{ fontSize: 10, color: "#bbb", fontStyle: "italic", textAlign: "center", marginTop: 4 }}>
              Ningún campo personalizado marcado para mostrar aquí. Actívalo desde Configuración → Campos personalizados.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── LinkedTaskChip ────────────────────────────────────────
// Pastilla para una tarea enlazada (dependencia o dependiente) en la vista
// de Presentación. Se colorea por estado y se vuelve gris cuando el usuario
// filtra por una persona específica y la tarea pertenece a otro responsable.
function LinkedTaskChip({ task, colorByStatus, focusedPersona }) {
  const status = task.status || "Sin iniciar";
  const isOtherPerson = focusedPersona && task.responsible !== focusedPersona;
  const statusColor = colorByStatus[status] || "#888";

  // Cuando hay foco en una persona y la tarea no le pertenece, se aplana visualmente.
  const bg = isOtherPerson ? "#f0f0f0" : "#ffffff";
  const border = isOtherPerson ? "1px solid #d0d0d0" : `1px solid ${statusColor}55`;
  const textColor = isOtherPerson ? "#999" : "#333";
  const chipColor = isOtherPerson ? "#bbb" : statusColor;

  return (
    <div
      title={`#${task.id} ${task.title} — Resp: ${task.responsible || "N/A"}${isOtherPerson ? " (otra persona)" : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: bg,
        border,
        borderRadius: 14,
        padding: "3px 9px",
        fontSize: 11,
        color: textColor,
        maxWidth: 220,
        cursor: "default",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: chipColor, flexShrink: 0 }} />
      <span style={{ fontWeight: 600 }}>#{task.id}</span>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</span>
      {task.responsible && (
        <span style={{ color: isOtherPerson ? "#bbb" : "#999", fontStyle: "italic", marginLeft: 2 }}>· {task.responsible.split(" ")[0]}</span>
      )}
    </div>
  );
}

// ─── FocusTab (Mi Día) ─────────────────────────────────────
function FocusTab({ tasks, activeUser, updateTask, dimensions }) {
  const today = new Date().toISOString().split('T')[0];

  const myTasks = useMemo(() => {
    if (!activeUser) return [];
    return tasks
      .filter(t => t.responsible === activeUser.name && !['Finalizada', 'Cancelada'].includes(t.status))
      .sort((a, b) => {
        const ao = a.endDate && a.endDate < today ? 1 : 0;
        const bo = b.endDate && b.endDate < today ? 1 : 0;
        if (bo !== ao) return bo - ao;
        return calcAporte(b, dimensions) - calcAporte(a, dimensions);
      });
  }, [tasks, activeUser, dimensions, today]);

  const setStatus = async (task, newStatus) => {
    await updateTask({ ...task, status: newStatus, ...(newStatus === 'Finalizada' && !task.finalizedAt ? { finalizedAt: getColombiaNow() } : {}) });
  };

  const emoji = { 'Sin iniciar': '⏳', 'En proceso': '🔄', 'En pausa': '⏸', 'Bloqueada': '🔒', 'Finalizada': '✅' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#542c9c' }}>
          Mi Día {activeUser && <span style={{ fontWeight: 400, fontSize: 14, color: '#888' }}>· {activeUser.name}</span>}
        </div>
        {myTasks.length > 0 && <span style={{ fontSize: 12, color: '#969696', marginLeft: 'auto' }}>{myTasks.length} tarea{myTasks.length !== 1 ? 's' : ''} activa{myTasks.length !== 1 ? 's' : ''}</span>}
      </div>

      {!activeUser && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#969696' }}>Inicia sesión con tu perfil para ver tus tareas.</div>
      )}

      {activeUser && myTasks.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#27ae60', marginBottom: 8 }}>¡Todo al día!</div>
          <div style={{ fontSize: 13, color: '#969696' }}>No tienes tareas activas asignadas.</div>
        </div>
      )}

      {myTasks.map(t => {
        const isOverdue = t.endDate && t.endDate < today;
        const aporte = calcAporte(t, dimensions);
        return (
          <div key={t.id} style={{
            background: '#fff', borderRadius: 14, padding: '14px 18px', marginBottom: 10,
            boxShadow: '0 2px 14px rgba(84,44,156,0.07)',
            borderLeft: `4px solid ${isOverdue ? '#c0392b' : STATUS_COLORS[t.status] || '#888'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: '#969696' }}>#{t.id}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#2d2d2d' }}>{t.title}</span>
                  {isOverdue && <span style={{ fontSize: 10, fontWeight: 700, background: '#fde8e8', color: '#c0392b', padding: '1px 7px', borderRadius: 8 }}>VENCIDA</span>}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#888', flexWrap: 'wrap' }}>
                  <span>{emoji[t.status] || '•'} {t.status}</span>
                  {t.endDate && <span>🏁 {t.endDate}</span>}
                  <span style={{ color: '#ec6c04', fontWeight: 600 }}>★ {aporte.toFixed(1)}</span>
                  {t.progressPercent > 0 && <span>{Number(t.progressPercent).toFixed(0)}%</span>}
                </div>
                {t.subtasks?.length > 0 && (
                  <div style={{ marginTop: 5, height: 4, background: '#f0e8ff', borderRadius: 2, overflow: 'hidden', maxWidth: 180 }}>
                    <div style={{ height: '100%', width: `${t.progressPercent || 0}%`, background: '#ec6c04', borderRadius: 2 }} />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                {['En proceso', 'En pausa', 'Finalizada'].filter(s => s !== t.status).map(s => (
                  <button key={s} onClick={() => setStatus(t, s)} style={{
                    border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 11, padding: '5px 10px',
                    background: s === 'Finalizada' ? 'linear-gradient(135deg,#27ae60,#2ecc71)' : s === 'En proceso' ? 'linear-gradient(135deg,#ec6c04,#f07d1e)' : '#f4f4f4',
                    color: (s === 'Finalizada' || s === 'En proceso') ? '#fff' : '#666',
                    title: s,
                  }}>
                    {s === 'Finalizada' ? '✓' : s === 'En proceso' ? '▶' : '⏸'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────

const dbToTask = (r) => ({
  id: r.id,
  createdAt: r.created_at_colombia,
  indicator: r.indicator || (Array.isArray(r.indicators) && r.indicators[0]?.name) || '',
  indicators: Array.isArray(r.indicators)
    ? r.indicators.map((i) =>
        typeof i === 'string' ? { name: i, isPrimary: false } : i
      )
    : r.indicator
    ? [{ name: r.indicator, isPrimary: true }]
    : [],
  title: r.title || '',
  startDate: r.start_date || '',
  endDate: r.end_date || '',
  estimatedTime: r.estimated_time ?? 5,
  type: r.type || 'Operativa',
  status: r.status || 'Sin iniciar',
  validationClose: r.validation_close || null,
  extProgress1: r.ext_progress1 || '',
  extProgress2: r.ext_progress2 || '',
  difficulty: r.difficulty ?? 5,
  strategicValue: r.strategic_value ?? 5,
  expectedDelivery: r.expected_delivery || '',
  responsible: r.responsible || '',
  comments: r.comments || '',
  progressPercent: r.progress_percent ?? 0,
  subtasks: (r.subtasks || []).map(s =>
    typeof s === 'string' ? { text: s, done: false } : s
  ),
  dependentTask: r.dependent_task || '',
  aporteSnapshot: r.aporte_snapshot ?? null,
  finalizedAt: r.finalized_at || null,
  dimensionValues: r.dimension_values || {},
  krId: r.kr_id || null,
  sprintId: r.sprint_id || null,
  customFields: (r.custom_fields && typeof r.custom_fields === 'object' && !Array.isArray(r.custom_fields)) ? r.custom_fields : {},
  updatedAt: r.updated_at || null,
  closedAt: r.closed_at || null,
  lastModifiedBy: r.last_modified_by || '',
});

const taskToDb = (t) => ({
  id: t.id,
  created_at_colombia: t.createdAt,
  indicator: t.indicator || (Array.isArray(t.indicators) && t.indicators[0]?.name) || '',
  indicators: t.indicators || [],
  title: t.title,
  start_date: t.startDate,
  end_date: t.endDate,
  estimated_time: t.estimatedTime,
  type: t.type,
  status: t.status,
  validation_close: t.validationClose,
  ext_progress1: t.extProgress1,
  ext_progress2: t.extProgress2,
  difficulty: t.difficulty,
  strategic_value: t.strategicValue,
  expected_delivery: t.expectedDelivery,
  responsible: t.responsible,
  comments: t.comments,
  progress_percent: t.progressPercent,
  subtasks: t.subtasks,
  dependent_task: t.dependentTask,
  aporte_snapshot: t.aporteSnapshot,
  finalized_at: t.finalizedAt,
  dimension_values: t.dimensionValues || {},
  kr_id: t.krId || null,
  sprint_id: t.sprintId || null,
  custom_fields: (t.customFields && typeof t.customFields === 'object' && !Array.isArray(t.customFields)) ? t.customFields : {},
  last_modified_by: t.lastModifiedBy || '',
  // updated_at / closed_at are managed by the DB trigger set_task_auto_fields.
});

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [indicators, setIndicators] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [nextId, setNextId] = useState(1);
  const [activeTab, setActiveTab] = useState("board");
  const [currentUserId, setCurrentUserId] = useState(null);
  const [dimensions, setDimensions] = useState(DEFAULT_DIMENSIONS);
  const [showIntro, setShowIntro] = useState(true);
  const [authUser, setAuthUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [activeUser, setActiveUser] = useState(null);
  const [activeUsers, setActiveUsers] = useState([]);
  const [kickedMsg, setKickedMsg] = useState(null);
  const [conflictUser, setConflictUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projectId, setProjectId] = useState(null);
  const [project, setProject] = useState(null);
  const [showProjectLanding, setShowProjectLanding] = useState(false);
  const [depEditTask, setDepEditTask] = useState(null);
  const [okrs, setOkrs] = useState([]);
  const [keyResults, setKeyResults] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [taskFieldDefs, setTaskFieldDefs] = useState([]);
  // false when migration 008 is not yet applied (custom_fields column / table
  // missing). Used to gracefully degrade taskToDb / addTaskFieldDef.
  const [hasCustomFieldsSchema, setHasCustomFieldsSchema] = useState(true);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [dismissedNotifs, setDismissedNotifs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pp_dismissed_notifs') || '[]'); } catch { return []; }
  });
  const sessionIdRef = useRef(crypto.randomUUID());

  const loadAllForProject = async (pid, proj, authUser = null) => {
    setLoading(true);
    try {
      const q = (table) => pid ? supabase.from(table).select('*').eq('project_id', pid) : supabase.from(table).select('*');
      const [
        { data: tasksData },
        { data: partsData },
        { data: indsData },
        { data: typesData },
        { data: configData },
        { data: okrsData },
        { data: sprintsData },
        { data: fieldDefsData, error: fieldDefsErr },
      ] = await Promise.all([
        q('tasks').order('id'),
        q('participants').order('id'),
        q('indicators').order('id'),
        pid ? supabase.from('task_types').select('*').eq('project_id', pid).order('name', { ascending: true }) : supabase.from('task_types').select('*').order('name', { ascending: true }),
        q('app_config'),
        pid ? supabase.from('okrs').select('*').eq('project_id', pid).order('year').order('quarter') : Promise.resolve({ data: [] }),
        pid ? supabase.from('sprints').select('*').eq('project_id', pid).order('created_at') : Promise.resolve({ data: [] }),
        pid
          ? supabase.from('task_field_defs').select('*').eq('project_id', pid).is('deleted_at', null).order('position', { ascending: true }).order('id', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (tasksData) setTasks(tasksData.map(dbToTask));
      if (partsData) setParticipants(partsData.map(p => ({ id: p.id, name: p.name, isSuperUser: p.is_super_user })));
      if (indsData) setIndicators(indsData);
      if (typesData) setTaskTypes(typesData.map(t => ({ id: t.id, name: t.name })));
      if (configData) {
        configData.forEach(row => {
          if (row.key === 'nextId') setNextId(Number(row.value));
          if (row.key === 'currentUserId') setCurrentUserId(row.value === null ? null : Number(row.value));
        });
      }

      if (okrsData) {
        setOkrs(okrsData);
        if (okrsData.length) {
          const okrIds = okrsData.map(o => o.id);
          const { data: krsData } = await supabase.from('key_results').select('*').in('okr_id', okrIds).order('id');
          if (krsData) setKeyResults(krsData);
        }
      }
      if (sprintsData) setSprints(sprintsData);
      // task_field_defs may fail silently on old DBs (pre-migration 008);
      // treat absent as "no custom fields configured" so the app still works.
      if (fieldDefsErr) {
        if (fieldDefsErr.code === '42P01') {
          console.warn('task_field_defs table not found — apply migration 008 to enable custom fields.');
          setHasCustomFieldsSchema(false);
        } else {
          console.error('Error cargando task_field_defs:', fieldDefsErr);
          setHasCustomFieldsSchema(true);
        }
        setTaskFieldDefs([]);
      } else {
        setHasCustomFieldsSchema(true);
        setTaskFieldDefs(Array.isArray(fieldDefsData) ? fieldDefsData : []);
      }

      // Load dimensions and pin from project config
      const p = proj || project;
      if (p?.config) {
        if (Array.isArray(p.config.dimensions) && p.config.dimensions.length) setDimensions(p.config.dimensions);
      }

      if (!partsData?.length && pid) {
        const { data: createdDefault } = await supabase
          .from('participants')
          .insert({ name: 'Usuario', is_super_user: true, project_id: pid })
          .select()
          .single();
        if (createdDefault) setParticipants([{ id: createdDefault.id, name: createdDefault.name, isSuperUser: true }]);
      }

      // Auto-set active user from auth
      if (authUser && pid) {
        const userName = authUser.user_metadata?.full_name || authUser.email.split('@')[0];
        const isOwner = (proj || p)?.owner_id === authUser.id;
        let part = partsData?.find(p2 => p2.auth_user_id === authUser.id || (p2.email && p2.email === authUser.email));
        if (!part) {
          const { data: created } = await supabase.from('participants').insert({
            name: userName, is_super_user: isOwner, project_id: pid,
            auth_user_id: authUser.id, email: authUser.email
          }).select().single();
          if (created) {
            part = created;
            setParticipants(prev => [...prev.filter(p2 => p2.id !== created.id), { id: created.id, name: created.name, isSuperUser: isOwner }]);
          }
        }
        if (part) {
          setActiveUser({ id: part.id, name: part.name, isSuperUser: isOwner });
          setCurrentUserId(part.id);
        }
      }
    } catch (err) {
      console.error('Error cargando datos:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    const init = async () => {
      // 1. Check Supabase auth session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        // showIntro will lead to showAuth after animation
        return;
      }
      const user = session.user;
      setAuthUser(user);

      // 2. Handle ?join=CODE invite link
      const params = new URLSearchParams(window.location.search);
      const joinCode = params.get('join');
      if (joinCode) {
        const proj = await joinProjectByCode(joinCode, user);
        if (proj) {
          localStorage.setItem('pp_project_id', String(proj.id));
          setProjectId(proj.id); setProject(proj);
          window.history.replaceState({}, '', window.location.pathname);
          await loadAllForProject(proj.id, proj, user);
          return;
        }
      }

      // 3. Load stored project
      const stored = localStorage.getItem('pp_project_id');
      if (stored) {
        const pid = Number(stored);
        const { data: proj } = await supabase.from('projects').select('*').eq('id', pid).single();
        if (proj) {
          // Ensure user is registered as member (self-healing for projects created before auth)
          if (user) {
            supabase.from('project_members').upsert(
              { project_id: proj.id, email: user.email, name: user.user_metadata?.full_name || user.email },
              { onConflict: 'project_id,email' }
            );
          }
          setProjectId(pid); setProject(proj);
          await loadAllForProject(pid, proj, user);
          return;
        }
        localStorage.removeItem('pp_project_id');
      }

      // 4. No project — show landing
      setShowProjectLanding(true);
      setLoading(false);
    };

    init();

    // Auth state subscription
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAuthUser(null); setActiveUser(null); setProject(null);
        setProjectId(null); setTasks([]); setParticipants([]);
        setShowAuth(true); setShowIntro(true); setShowProjectLanding(false);
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
    // Initialization must run once; subsequent project changes are handled explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Suscripciones Realtime ─────────────────────────────────
  useEffect(() => {
    if (!projectId) return undefined;
    const projectFilter = `project_id=eq.${projectId}`;
    const channel = supabase
      .channel(`productivity-plus-realtime-${projectId}`)

      // TASKS
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: projectFilter }, (payload) => {
        setTasks(prev => {
          if (prev.find(t => t.id === payload.new.id)) return prev;
          return [...prev, dbToTask(payload.new)].sort((a, b) => a.id - b.id);
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: projectFilter }, (payload) => {
        setTasks(prev => prev.map(t => t.id === payload.new.id ? dbToTask(payload.new) : t));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tasks', filter: projectFilter }, (payload) => {
        setTasks(prev => prev.filter(t => t.id !== payload.old.id));
      })

      // PARTICIPANTS
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'participants', filter: projectFilter }, (payload) => {
        setParticipants(prev => {
          if (prev.find(p => p.id === payload.new.id)) return prev;
          return [...prev, { id: payload.new.id, name: payload.new.name, isSuperUser: payload.new.is_super_user }];
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'participants', filter: projectFilter }, (payload) => {
        setParticipants(prev => prev.map(p =>
          p.id === payload.new.id ? { id: payload.new.id, name: payload.new.name, isSuperUser: payload.new.is_super_user } : p
        ));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'participants', filter: projectFilter }, (payload) => {
        setParticipants(prev => prev.filter(p => p.id !== payload.old.id));
      })

      // INDICATORS
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'indicators', filter: projectFilter }, (payload) => {
        setIndicators(prev => {
          if (prev.find(i => i.id === payload.new.id)) return prev;
          return [...prev, { id: payload.new.id, name: payload.new.name }];
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'indicators', filter: projectFilter }, (payload) => {
        setIndicators(prev => prev.filter(i => i.id !== payload.old.id));
      })

      // APP_CONFIG
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_config', filter: projectFilter }, (payload) => {
        const { key, value } = payload.new;
        if (key === 'nextId') setNextId(Number(value));
        if (key === 'currentUserId') setCurrentUserId(value === null ? null : Number(value));
      })

      // TASK_FIELD_DEFS — schema of custom card fields per project.
      // Treats soft-deleted rows (deleted_at NOT NULL) as removals so the
      // UI stays in sync without an extra query.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_field_defs', filter: projectFilter }, (payload) => {
        const row = payload.new;
        if (row.deleted_at) return;
        setTaskFieldDefs(prev => {
          if (prev.find(d => d.id === row.id)) return prev;
          return [...prev, row].sort((a, b) => (a.position - b.position) || (a.id - b.id));
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'task_field_defs', filter: projectFilter }, (payload) => {
        const row = payload.new;
        setTaskFieldDefs(prev => {
          const without = prev.filter(d => d.id !== row.id);
          if (row.deleted_at) return without;
          return [...without, row].sort((a, b) => (a.position - b.position) || (a.id - b.id));
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'task_field_defs', filter: projectFilter }, (payload) => {
        setTaskFieldDefs(prev => prev.filter(d => d.id !== payload.old.id));
      })

      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [projectId]);

  // ── Presence: track active users in real time ──────────────
  const presenceChannelRef = useRef(null);
  const activeUserRef = useRef(null);

  useEffect(() => { activeUserRef.current = activeUser; }, [activeUser]);

  // Single channel per session — key is our unique sessionId
  useEffect(() => {
    if (!projectId) return undefined;
    const channel = supabase.channel(`productivity-plus-presence-${projectId}`, {
      config: { presence: { key: sessionIdRef.current } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        // Flatten all presences into a list, dedupe by userId (newest wins)
        const byUser = {};
        Object.values(state).forEach(presences => {
          presences.forEach(p => {
            if (!p.userId) return; // observer with no track data
            const existing = byUser[p.userId];
            if (!existing || (p.onlineAt || '') > (existing.onlineAt || '')) {
              byUser[p.userId] = p;
            }
          });
        });
        const users = Object.values(byUser).map(p => ({
          userId: p.userId, name: p.name, sessionId: p.sessionId,
        }));
        setActiveUsers(users);

        // Check if someone newer took our userId
        const currentActive = activeUserRef.current;
        if (!currentActive) return;
        const newestForMyUser = byUser[currentActive.id];
        if (newestForMyUser && newestForMyUser.sessionId !== sessionIdRef.current) {
          // Someone newer has our userId — we get kicked
          setKickedMsg(`Alguien acaba de ingresar como "${currentActive.name}". Tu sesión ha sido cerrada.`);
          setActiveUser(null);
          channel.untrack();
        }
      })
      .subscribe();

    presenceChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); presenceChannelRef.current = null; };
  }, [projectId]);

  // Track/untrack our presence when activeUser changes
  useEffect(() => {
    const channel = presenceChannelRef.current;
    if (!channel) return;

    if (!activeUser) {
      channel.untrack();
      return;
    }

    const doTrack = () => {
      channel.track({
        name: activeUser.name,
        sessionId: sessionIdRef.current,
        userId: activeUser.id,
        onlineAt: new Date().toISOString(),
      });
    };

    // Small delay to ensure channel is SUBSCRIBED
    const timer = setTimeout(doTrack, 150);
    return () => clearTimeout(timer);
  }, [activeUser]);

  const handleForceEntry = () => {
    if (!conflictUser) return;
    setKickedMsg(null);
    const p = conflictUser;
    setConflictUser(null);
    // Force enter — our newer onlineAt will kick the old session via sync
    setActiveUser(p);
    setCurrentUserId(p.id);
  };

  const handleChangeUser = () => {
    if (presenceChannelRef.current) {
      presenceChannelRef.current.untrack();
    }
    setActiveUser(null);
  };

  const createTask = async (task) => {
    if (task.status === 'Finalizada' && !task.finalizedAt) {
      task = { ...task, finalizedAt: getColombiaNow() };
    }
    const dbTask = { ...taskToDb(task), project_id: projectId || undefined };
    if (Array.isArray(dimensions) && dimensions.length) {
      dbTask.aporte_snapshot = calcAporte(task, dimensions);
    }
    // Strip fields added by migration 008 when the schema is not yet applied
    // so the insert does not fail with 42703 on an older DB.
    if (!hasCustomFieldsSchema) {
      delete dbTask.custom_fields;
      delete dbTask.last_modified_by;
    }
    const { error } = await supabase.from('tasks').insert(dbTask);
    if (!error) {
      setTasks(prev => [...prev, task]);
    } else {
      console.error('Error creando tarea:', error);
      alert('Error al guardar la tarea: ' + error.message);
    }
  };

  const updateTask = async (task) => {
    if (task.status === 'Finalizada' && !task.finalizedAt) {
      task = { ...task, finalizedAt: getColombiaNow() };
    }
    // Stamp the editor for the "last modified by" auto field. Server-side
    // updated_at / closed_at are handled by the set_task_auto_fields trigger.
    if (activeUser?.name) {
      task = { ...task, lastModifiedBy: activeUser.name };
    }
    const dbTask = { ...taskToDb(task) };
    if (Array.isArray(dimensions) && dimensions.length) {
      dbTask.aporte_snapshot = calcAporte(task, dimensions);
    }
    if (!hasCustomFieldsSchema) {
      delete dbTask.custom_fields;
      delete dbTask.last_modified_by;
    }
    let updateQuery = supabase.from('tasks').update(dbTask).eq('id', task.id);
    if (projectId) updateQuery = updateQuery.eq('project_id', projectId);
    const { error } = await updateQuery;
    if (!error) {
      // Log significant field changes to task_history
      if (projectId && activeUser) {
        const oldTask = tasks.find(t => t.id === task.id);
        if (oldTask) {
          const tracked = [
            { field: 'status', oldV: oldTask.status, newV: task.status },
            { field: 'responsible', oldV: oldTask.responsible, newV: task.responsible },
            { field: 'progressPercent', oldV: String(oldTask.progressPercent), newV: String(task.progressPercent) },
          ];
          // Diff custom fields too. We only audit keys present in either
          // old or new map — defs that didn't exist when the row was written
          // still surface here if the value differs.
          const oldCustom = oldTask.customFields || {};
          const newCustom = task.customFields || {};
          const allCustomKeys = new Set([...Object.keys(oldCustom), ...Object.keys(newCustom)]);
          // Stable serializer: sort object keys recursively so that two
          // semantically equal objects produce the same string, avoiding
          // phantom diffs in task_history.
          const stableStringify = (v) => {
            if (v === undefined || v === null) return '';
            if (Array.isArray(v)) {
              try { return '[' + v.map(stableStringify).join(',') + ']'; } catch { return String(v); }
            }
            if (typeof v === 'object') {
              try {
                const keys = Object.keys(v).sort();
                return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
              } catch { return String(v); }
            }
            return JSON.stringify(v);
          };
          const stringify = stableStringify;
          allCustomKeys.forEach((k) => {
            const ov = stringify(oldCustom[k]);
            const nv = stringify(newCustom[k]);
            if (ov !== nv) {
              tracked.push({ field: `customField:${k}`, oldV: ov, newV: nv });
            }
          });
          for (const f of tracked) {
            if (f.oldV !== f.newV) {
              supabase.from('task_history').insert({ task_id: task.id, project_id: projectId, changed_by: activeUser.name, field_name: f.field, old_value: f.oldV, new_value: f.newV }).then(() => {});
            }
          }
        }
      }
      setTasks(prev => prev.map(t => t.id === task.id ? task : t));
    } else {
      console.error('Error actualizando tarea:', error);
      alert('Error al actualizar la tarea: ' + error.message);
    }
  };

  const deleteTask = async (id) => {
    let deleteQuery = supabase.from('tasks').delete().eq('id', id);
    if (projectId) deleteQuery = deleteQuery.eq('project_id', projectId);
    const { error } = await deleteQuery;
    if (!error) {
      setTasks(prev => prev.filter(t => t.id !== id));
    } else {
      console.error('Error eliminando tarea:', error);
    }
  };

  const saveParticipants = async (updaterFn) => {
    const prev = participants;
    const next = typeof updaterFn === 'function' ? updaterFn(prev) : updaterFn;
    const toInsert = next.filter(n => !prev.find(p => p.id === n.id));
    const toUpdate = next.filter(n => prev.find(p => p.id === n.id));
    const toDelete = prev.filter(p => !next.find(n => n.id === p.id));
    for (const p of toInsert)
      await supabase.from('participants').insert({ id: p.id, name: p.name, is_super_user: p.isSuperUser, project_id: projectId || undefined });
    for (const p of toUpdate)
      await supabase.from('participants').update({ name: p.name, is_super_user: p.isSuperUser }).eq('id', p.id).eq('project_id', projectId);
    for (const p of toDelete)
      await supabase.from('participants').delete().eq('id', p.id).eq('project_id', projectId);
    setParticipants(next);
  };

  const saveIndicators = async (updaterFn) => {
    const prev = indicators;
    const next = typeof updaterFn === 'function' ? updaterFn(prev) : updaterFn;
    const toInsert = next.filter(n => !prev.find(p => p.id === n.id));
    const toDelete = prev.filter(p => !next.find(n => n.id === p.id));
    for (const i of toInsert)
      await supabase.from('indicators').insert({ id: i.id, name: i.name, project_id: projectId || undefined });
    for (const i of toDelete)
      await supabase.from('indicators').delete().eq('id', i.id).eq('project_id', projectId);
    setIndicators(next);
  };

  const saveTaskTypes = async (updaterFn) => {
    const prev = taskTypes;
    const next = typeof updaterFn === 'function' ? updaterFn(prev) : updaterFn;
    const toInsert = next.filter(n => !prev.find(p => p.id === n.id));
    const toUpdate = next.filter(n => prev.find(p => p.id === n.id));
    const toDelete = prev.filter(p => !next.find(n => n.id === p.id));
    for (const t of toInsert)
      await supabase.from('task_types').insert({ name: t.name, project_id: projectId || undefined });
    for (const t of toUpdate)
      await supabase.from('task_types').update({ name: t.name }).eq('id', t.id).eq('project_id', projectId);
    for (const t of toDelete)
      await supabase.from('task_types').delete().eq('id', t.id).eq('project_id', projectId);
    const { data, error } = await supabase.from('task_types').select('*').eq('project_id', projectId).order('name', { ascending: true });
    if (!error && data) setTaskTypes(data.map((t) => ({ id: t.id, name: t.name })));
    return next;
  };

  const saveDimensions = async (dims) => {
    setDimensions(dims);
    if (projectId && project) {
      const newConfig = { ...(project.config || {}), dimensions: dims };
      await supabase.from('projects').update({ config: newConfig }).eq('id', projectId);
      setProject(prev => ({ ...prev, config: newConfig }));
    }
  };

  // ── Custom field defs CRUD ──────────────────────────────────
  // Realtime keeps `taskFieldDefs` in sync, so each helper also returns the
  // server row so callers (e.g. form modal) can react immediately.
  const addTaskFieldDef = async (payload) => {
    if (!projectId) return { error: new Error('No project selected') };
    let key = String(payload.key || '').trim();
    // Resolve collisions against ALL keys ever used in this project,
    // including soft-deleted ones, to avoid mixing archived historical values
    // (stored in tasks.custom_fields[key]) with new ones under the same key.
    if (key) {
      const { data: allKeys } = await supabase
        .from('task_field_defs')
        .select('key')
        .eq('project_id', projectId);
      const used = new Set((allKeys || []).map(r => r.key));
      if (used.has(key)) {
        const base = key.slice(0, 47);
        let n = 2;
        while (used.has(`${base}_${n}`) && n < 1000) n += 1;
        key = `${base}_${n}`;
      }
    }
    const insertPayload = {
      project_id: projectId,
      key,
      label: String(payload.label || '').trim(),
      type: payload.type,
      config: payload.config || {},
      position: typeof payload.position === 'number' ? payload.position : taskFieldDefs.length,
      required: !!payload.required,
      show_on_card: !!payload.show_on_card,
      show_in_presentation: !!payload.show_in_presentation,
    };
    let { data, error } = await supabase.from('task_field_defs').insert(insertPayload).select().single();
    // Graceful: si la migración 011 aún no se aplicó, reintenta sin la columna nueva.
    if (error && /show_in_presentation/i.test(error.message || '')) {
      const fallback = { ...insertPayload };
      delete fallback.show_in_presentation;
      ({ data, error } = await supabase.from('task_field_defs').insert(fallback).select().single());
    }
    if (!error && data) {
      setTaskFieldDefs(prev => {
        if (prev.find(d => d.id === data.id)) return prev;
        return [...prev, data].sort((a, b) => (a.position - b.position) || (a.id - b.id));
      });
    }
    return { data, error };
  };

  const updateTaskFieldDefById = async (id, patch) => {
    if (!projectId) return { error: new Error('No project selected') };
    const safePatch = { ...patch };
    // Never let the client move a def to another project or undelete via update.
    delete safePatch.project_id;
    delete safePatch.id;
    let { data, error } = await supabase
      .from('task_field_defs')
      .update(safePatch)
      .eq('id', id)
      .eq('project_id', projectId)
      .select()
      .single();
    // Graceful: si la migración 011 aún no se aplicó, reintenta sin la columna nueva.
    if (error && /show_in_presentation/i.test(error.message || '')) {
      const fallback = { ...safePatch };
      delete fallback.show_in_presentation;
      ({ data, error } = await supabase
        .from('task_field_defs')
        .update(fallback)
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single());
    }
    if (!error && data) {
      setTaskFieldDefs(prev => prev.map(d => d.id === id ? data : d).sort((a, b) => (a.position - b.position) || (a.id - b.id)));
    }
    return { data, error };
  };

  const deleteTaskFieldDef = async (id) => {
    if (!projectId) return { error: new Error('No project selected') };
    // Soft delete to preserve historical values stored in tasks.custom_fields.
    const { error } = await supabase
      .from('task_field_defs')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId);
    if (!error) {
      setTaskFieldDefs(prev => prev.filter(d => d.id !== id));
    }
    return { error };
  };

  const reorderTaskFieldDefs = async (orderedIds) => {
    if (!projectId) return;
    // Optimistic local reorder
    setTaskFieldDefs(prev => {
      const map = new Map(prev.map(d => [d.id, d]));
      return orderedIds
        .map((id, idx) => map.get(id) ? { ...map.get(id), position: idx } : null)
        .filter(Boolean);
    });
    // Persist in parallel to minimise the realtime "list dancing" effect
    // (each UPDATE fires a separate event; doing them at once batches the
    // perceived re-render). For larger schemas consider an RPC.
    const ops = orderedIds.map((id, i) =>
      supabase.from('task_field_defs').update({ position: i }).eq('id', id).eq('project_id', projectId)
    );
    const results = await Promise.all(ops);
    const firstErr = results.find(r => r.error);
    if (firstErr) {
      console.error('Error reordenando campos:', firstErr.error);
    }
  };

  const saveProjectPin = async (pin) => {
    if (projectId && project) {
      const newConfig = { ...(project.config || {}), pin };
      await supabase.from('projects').update({ config: newConfig }).eq('id', projectId);
      setProject(prev => ({ ...prev, config: newConfig }));
    }
  };

  const currentUser = useMemo(() => participants.find((p) => p.id === currentUserId) || null, [participants, currentUserId]);

  const exportCSV = () => {
    if (tasks.length === 0) { alert("No hay tareas para exportar."); return; }
    // Compute custom-field columns from the active defs so each tenant gets
    // exactly its schema. Soft-deleted defs are skipped; their values stay
    // in tasks.custom_fields for audit but aren't exported.
    // Skip type='auto' defs: their underlying columns (created/updated/closed/
    // last_modified_by) are already covered by builtin headers, so re-exporting
    // them would duplicate columns in Excel.
    const activeDefs = (taskFieldDefs || []).filter(d => !d.deleted_at && d.type !== 'auto');
    const formatForCsv = (def, t) => {
      const v = readCustomFieldValue(def, t);
      if (v === undefined || v === null) return '';
      if (def.type === 'multiselect') return Array.isArray(v) ? v.join(' | ') : String(v);
      if (def.type === 'subitems') return Array.isArray(v) ? v.map(i => (i.done ? '✓ ' : '○ ') + (i.text || '')).join(' | ') : '';
      return String(v);
    };
    const data = tasks.map((t) => {
      const row = {
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
        "Subtareas": t.subtasks.map(s => (s.done ? "✓ " : "○ ") + (s.text || s)).join(" | "),
        "Tarea dependiente (ID)": t.dependentTask || "",
      };
      // Append one column per active custom field. Label collisions with
      // builtin headers OR with another custom field get the [key] suffix,
      // which is guaranteed unique by the DB unique index. Two custom fields
      // sharing a label is a realistic scenario; collapsing them silently
      // would lose data in Excel.
      const used = new Set(Object.keys(row));
      activeDefs.forEach(def => {
        let header = def.label || def.key;
        if (used.has(header)) header = `${header} [${def.key}]`;
        if (used.has(header)) header = `${header} (campo personalizado) [${def.key}]`;
        used.add(header);
        row[header] = formatForCsv(def, t);
      });
      return row;
    });
    // Union of all keys across rows preserves builtin order, then custom
    // fields in the order returned by activeDefs. Some rows may be missing
    // custom keys if their task was created before a def was added — fall
    // back to empty cells for those.
    const headers = Array.from(data.reduce((s, row) => {
      Object.keys(row).forEach(k => s.add(k));
      return s;
    }, new Set()));
    const escapeCell = (value) => {
      const text = String(value ?? "");
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    };
    const csv = [
      headers.map(escapeCell).join(","),
      ...data.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
    ].join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `productivity-plus_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const today = new Date().toISOString().split('T')[0];
  const alerts = useMemo(() => {
    const result = [];
    tasks.forEach(t => {
      if (t.endDate && t.endDate < today && !['Finalizada', 'Cancelada'].includes(t.status))
        result.push({ id: `overdue-${t.id}`, type: 'danger', msg: `Vencida: #${t.id} "${t.title}"` });
      if (t.status === 'Bloqueada')
        result.push({ id: `blocked-${t.id}`, type: 'warning', msg: `Bloqueada: #${t.id} "${t.title}"` });
    });
    return result;
  }, [tasks, today]);
  const visibleAlerts = alerts.filter(a => !dismissedNotifs.includes(a.id));
  const dismissAlert = (id) => {
    const next = [...dismissedNotifs, id];
    setDismissedNotifs(next);
    localStorage.setItem('pp_dismissed_notifs', JSON.stringify(next));
  };

  const TABS = [
    { id: "board", label: "Tablero" },
    { id: "gantt", label: "Gantt" },
    { id: "metrics", label: "Métricas" },
    { id: "deps", label: "Red de Tareas" },
    { id: "okrs", label: "OKRs" },
    { id: "sprints", label: "Sprints" },
    { id: "focus", label: "Mi Día" },
    { id: "presentation", label: "Presentación" },
    { id: "config", label: "Configuración" },
  ];

  return (
    <>
      {showProjectLanding && !loading && (
        <ProjectLandingScreen authUser={authUser} onProjectLoaded={(proj) => {
          setProject(proj);
          setProjectId(proj.id);
          setShowProjectLanding(false);
          loadAllForProject(proj.id, proj, authUser);
        }} />
      )}

      {loading && (
        <div style={{
          position: 'fixed', inset: 0, background: '#0d0d1a',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 99999, gap: 20,
        }}>
          <div style={{
            fontSize: 72, fontWeight: 900,
            background: 'linear-gradient(135deg, #ec6c04, #149cac)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>P+</div>
          <div style={{ width: 200, height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: 'linear-gradient(90deg, #ec6c04, #149cac)',
              borderRadius: 1, animation: 'expandLine 1.5s ease infinite alternate',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: 4, textTransform: 'uppercase' }}>
            Conectando base de datos...
          </span>
        </div>
      )}
      {!loading && showIntro && <IntroScreen onFinish={() => { setShowIntro(false); if (!authUser) setShowAuth(true); }} />}
      {!loading && !showIntro && showAuth && (
        <AuthScreen onAuth={async (user) => {
          setAuthUser(user);
          setShowAuth(false);
          // Handle pending join code
          const params = new URLSearchParams(window.location.search);
          const joinCode = params.get('join');
          if (joinCode) {
            const proj = await joinProjectByCode(joinCode, user);
            if (proj) {
              localStorage.setItem('pp_project_id', String(proj.id));
              setProjectId(proj.id); setProject(proj);
              window.history.replaceState({}, '', window.location.pathname);
              await loadAllForProject(proj.id, proj, user);
              return;
            }
          }
          // Check for stored project
          const stored = localStorage.getItem('pp_project_id');
          if (stored) {
            const pid = Number(stored);
            const { data: proj } = await supabase.from('projects').select('*').eq('id', pid).single();
            if (proj) { setProjectId(pid); setProject(proj); await loadAllForProject(pid, proj, user); return; }
            localStorage.removeItem('pp_project_id');
          }
          setShowProjectLanding(true);
          setLoading(false);
        }} />
      )}
      {/* Conflict modal — user is already active, offer to take over or pick another */}
      {conflictUser && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 99997,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1a1a2e", borderRadius: 20, padding: "40px 36px", maxWidth: 420,
            border: "1px solid rgba(236,108,4,0.3)", textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            animation: "cardEntrance 0.4s ease",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👤</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#ec6c04", marginBottom: 12 }}>Usuario ya activo</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, marginBottom: 24 }}>
              <strong style={{ color: "#fff" }}>{conflictUser.name}</strong> ya tiene una sesión abierta en otro navegador. ¿Qué deseas hacer?
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => setConflictUser(null)}
                style={{
                  background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)",
                  border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 24px", fontSize: 13,
                  fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
                }}
              >Elegir otro perfil</button>
              <button
                onClick={handleForceEntry}
                style={{
                  background: "linear-gradient(135deg, #ec6c04, #f07d1e)", color: "#fff",
                  border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 13,
                  fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(236,108,4,0.4)",
                }}
              >Tomar sesión</button>
            </div>
          </div>
        </div>
      )}
      {/* Kicked-out modal — shown to the session that was displaced */}
      {kickedMsg && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 99997,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1a1a2e", borderRadius: 20, padding: "40px 36px", maxWidth: 400,
            border: "1px solid rgba(236,108,4,0.3)", textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            animation: "cardEntrance 0.4s ease",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#ec6c04", marginBottom: 12 }}>Sesión cerrada</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, marginBottom: 24 }}>{kickedMsg}</div>
            <button
              onClick={() => setKickedMsg(null)}
              style={{
                background: "linear-gradient(135deg, #ec6c04, #f07d1e)", color: "#fff",
                border: "none", borderRadius: 10, padding: "10px 32px", fontSize: 13,
                fontWeight: 700, cursor: "pointer",
              }}
            >Elegir otro perfil</button>
          </div>
        </div>
      )}
      <div style={{ opacity: showIntro || showAuth || showProjectLanding ? 0 : 1, pointerEvents: showIntro || showAuth || showProjectLanding ? "none" : "auto", transition: "opacity 0.6s ease 0.2s" }}>
    <style>{`
      @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes shimmer { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      @media print {
        nav, [data-noprint], .no-print { display: none !important; }
        body { background: #fff !important; }
        .print-page { page-break-after: always; }
      }
    `}</style>
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #f8f4ff 0%, #e6f7f8 50%, #fff3ea 100%)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}>
      <div style={{ background: "linear-gradient(90deg, #1a1a2e 0%, #2d1b4e 100%)", boxShadow: "0 2px 0 #ec6c04", padding: "10px 20px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 800, fontSize: 18, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ background: "linear-gradient(135deg, #ec6c04, #f07d1e)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Productivity</span>
          <span style={{ color: "#ffffff", fontWeight: 300, fontSize: 16 }}>-Plus</span>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ec6c04", marginLeft: 2, animation: "pulse 2s ease-in-out infinite", display: "inline-block" }} />
        </div>
        {project && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 1 }}>|</span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{project.name}</span>
            <button
              onClick={() => { const pid = localStorage.getItem('pp_project_id'); if (pid) localStorage.setItem('pp_last_project_id', pid); localStorage.removeItem('pp_project_id'); setProject(null); setProjectId(null); setShowProjectLanding(true); setActiveUser(null); }}
              title="Cambiar proyecto"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", borderRadius: 5, padding: "2px 7px", cursor: "pointer", fontSize: 10, fontWeight: 500 }}
            >↩</button>
          </div>
        )}
        <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.15)" }} />
        {/* Active users indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {activeUsers.map((u) => {
            const color = getUserColor(u.name);
            return (
              <div key={u.userId} title={u.name} style={{ position: "relative" }}>
                <div style={{
                  width: 30, height: 30, borderRadius: "50%",
                  background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 800, color: "#fff",
                  border: u.userId === activeUser?.id ? "2px solid #ec6c04" : "2px solid rgba(255,255,255,0.2)",
                  transition: "border 0.3s",
                }}>{getInitials(u.name)}</div>
                <div style={{
                  position: "absolute", bottom: -1, right: -1,
                  width: 9, height: 9, borderRadius: "50%",
                  background: "#27ae60", border: "2px solid #1a1a2e",
                }} />
              </div>
            );
          })}
          {activeUsers.length === 0 && (
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>Sin usuarios activos</span>
          )}
        </div>
        <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.15)" }} />
        {/* Current user + change */}
        {activeUser && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Sesión:</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{activeUser.name}</span>
            {currentUser?.isSuperUser && (
              <span style={{ fontSize: 9, background: "linear-gradient(135deg, #ec6c04, #f07d1e)", color: "#fff", padding: "2px 7px", borderRadius: 8, fontWeight: 700 }}>SUPER</span>
            )}
            <button onClick={handleChangeUser} style={{
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "3px 10px",
              cursor: "pointer", fontSize: 10, fontWeight: 500, transition: "all 0.2s",
            }}>Cambiar</button>
          </div>
        )}
        {authUser && (
          <button onClick={() => supabase.auth.signOut()} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", borderRadius:6, padding:"3px 10px", cursor:"pointer", fontSize:10, fontWeight:500 }}>
            Salir
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {/* Notifications bell */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowNotifPanel(p => !p)}
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: visibleAlerts.length > 0 ? "#f87171" : "rgba(255,255,255,0.5)", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 14, lineHeight: 1, position: "relative" }}
            >
              🔔
              {visibleAlerts.length > 0 && (
                <span style={{ position: "absolute", top: 0, right: 0, transform: "translate(40%,-40%)", background: "#c0392b", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{visibleAlerts.length}</span>
              )}
            </button>
            {showNotifPanel && (
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "#1a1a2e", borderRadius: 14, padding: 16, minWidth: 300, maxHeight: 380, overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 9999, border: "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>Alertas{visibleAlerts.length > 0 ? ` (${visibleAlerts.length})` : ""}</div>
                {visibleAlerts.length === 0 ? (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "20px 0" }}>Sin alertas activas ✓</div>
                ) : visibleAlerts.map(a => (
                  <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 7, padding: "8px 10px", background: "rgba(255,255,255,0.05)", borderRadius: 8, borderLeft: `3px solid ${a.type === 'danger' ? '#e74c3c' : '#ec6c04'}` }}>
                    <span style={{ fontSize: 11, flex: 1, color: "rgba(255,255,255,0.8)", lineHeight: 1.4 }}>{a.msg}</span>
                    <button onClick={() => dismissAlert(a.id)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 13, padding: 0, flexShrink: 0, lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* PDF export */}
          <button onClick={() => window.print()} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
            🖨 PDF
          </button>
          <button onClick={exportCSV} style={{
            background: "rgba(20,156,172,0.2)",
            border: "1px solid rgba(20,156,172,0.5)",
            color: "#4dd8e8",
            borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 500,
          }}>
            ↓ Exportar CSV
          </button>
        </div>
      </div>

      <div style={{ background: "#ffffff", borderBottom: "1px solid #e8e0f4", padding: "0 20px", display: "flex", gap: 0, boxShadow: "0 2px 8px rgba(84,44,156,0.06)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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
          <BoardTab tasks={tasks} createTask={createTask} updateTask={updateTask} deleteTask={deleteTask} participants={participants} indicators={indicators} currentUser={currentUser} taskTypes={taskTypes} weights={dimensions} dimensions={dimensions} editTaskFromDep={depEditTask} onDepEditDone={() => setDepEditTask(null)} projectId={projectId} nextId={nextId} keyResults={keyResults} sprints={sprints} taskFieldDefs={taskFieldDefs} />
        )}
        {activeTab === "gantt" && <GanttTab tasks={tasks} participants={participants} indicators={indicators} taskTypes={taskTypes} />}
        {activeTab === "metrics" && <MetricsTab tasks={tasks} participants={participants} taskTypes={taskTypes} />}
        {activeTab === "deps" && (
          <DependenciesTab
            tasks={tasks}
            onEditTask={(t) => { setDepEditTask(t); setActiveTab("board"); }}
            sprints={sprints}
          />
        )}
        {activeTab === "okrs" && (
          <OKRsTab projectId={projectId} okrs={okrs} setOkrs={setOkrs} keyResults={keyResults} setKeyResults={setKeyResults} tasks={tasks} />
        )}
        {activeTab === "sprints" && (
          <SprintsTab projectId={projectId} sprints={sprints} setSprints={setSprints} tasks={tasks} />
        )}
        {activeTab === "focus" && (
          <FocusTab tasks={tasks} activeUser={activeUser} updateTask={updateTask} dimensions={dimensions} />
        )}
        {activeTab === "presentation" && (
          <PresentationTab
            tasks={tasks}
            participants={participants}
            taskFieldDefs={taskFieldDefs}
            sprints={sprints}
          />
        )}
        {activeTab === "config" && (() => {
          const isOwner = project?.owner_id === authUser?.id;
          return isOwner ? (
            <ConfigTab
              participants={participants} setParticipants={saveParticipants}
              indicators={indicators} setIndicators={saveIndicators}
              taskTypes={taskTypes} setTaskTypes={saveTaskTypes}
              dimensions={dimensions} setDimensions={saveDimensions}
              project={project}
              onChangePin={saveProjectPin}
              taskFieldDefs={taskFieldDefs}
              addTaskFieldDef={addTaskFieldDef}
              updateTaskFieldDef={updateTaskFieldDefById}
              deleteTaskFieldDef={deleteTaskFieldDef}
              reorderTaskFieldDefs={reorderTaskFieldDefs}
            />
          ) : (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:340, gap:16 }}>
              <div style={{ background:"#fff", borderRadius:16, padding:"32px 36px", boxShadow:"0 4px 32px rgba(84,44,156,0.12)", textAlign:"center", maxWidth:360 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
                <div style={{ fontSize:16, fontWeight:700, color:"#542c9c", marginBottom:8 }}>Acceso restringido</div>
                <div style={{ fontSize:13, color:"#969696", lineHeight:1.6 }}>Solo el dueño del proyecto puede acceder a la configuración.</div>
              </div>
            </div>
          );
        })()}
      </div>
      <div style={{ position: "fixed", bottom: 12, left: 16, display: "flex", flexDirection: "column", gap: 1, zIndex: 50 }}>
        <span style={{ fontSize: 10, color: "#969696", fontWeight: 400, letterSpacing: "0.03em" }}>Desarrollado por Jeferson Marmolejo</span>
        <span style={{ fontSize: 9, color: "#b0b0b0", letterSpacing: "0.05em" }}>Productivity-Plus v1.0.0</span>
      </div>
    </div>
      </div>
    </>
  );
}
