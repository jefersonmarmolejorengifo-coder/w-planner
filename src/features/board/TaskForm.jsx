import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { STATUS_COLORS, ESTADOS, DEFAULT_TASK_TYPES } from "../../constants";
import { calcAporte, calcProgressFromSubtasks, DEFAULT_DIMENSIONS } from "../../lib/aporte";
import { parseDeps } from "../../lib/deps";
import { CustomFieldsRenderer } from "../../lib/CustomFieldsRenderer";
import { inp, readonlyInp } from "../../lib/formStyles";
import { useConfirm } from "../../ui/ConfirmDialog";

// Estados que cuentan como "cierre" de una tarjeta. Privado de TaskForm.
const CLOSE_STATES = ["Finalizada", "Cancelada"];

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

// ─── TaskSuperLinksEditor ──────────────────────────────────
// Permite linkear una tarea a una o varias super-tareas con peso. Persiste
// inmediatamente en task_super_links (toggle = insert/delete; cambio de
// peso = update). Pensado para vivir dentro del modal de TaskForm.
function TaskSuperLinksEditor({ taskId, projectId }) {
  const [superTasks, setSuperTasks] = useState([]);
  const [links, setLinks] = useState({}); // super_task_id -> weight
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!projectId || !taskId) return;
      const [stRes, lkRes] = await Promise.all([
        supabase.from("super_tasks")
          .select("id, title, color, icon, target_aporte")
          .eq("project_id", projectId)
          .is("deleted_at", null)
          .order("position", { ascending: true }),
        supabase.from("task_super_links")
          .select("super_task_id, weight")
          .eq("task_id", taskId),
      ]);
      if (cancelled) return;
      if (stRes.error) {
        if (stRes.error.code === "42P01") {
          setError("Aplica la migración 014 para enlazar a super-tareas.");
        } else {
          setError(stRes.error.message);
        }
        setLoading(false);
        return;
      }
      setError("");
      setSuperTasks(stRes.data || []);
      const lmap = {};
      (lkRes.data || []).forEach(l => { lmap[l.super_task_id] = parseFloat(l.weight); });
      setLinks(lmap);
      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [taskId, projectId]);

  const toggleLink = async (superId) => {
    if (links[superId] !== undefined) {
      // Quitar
      setBusy(true);
      const { error: err } = await supabase
        .from("task_super_links")
        .delete()
        .eq("task_id", taskId)
        .eq("super_task_id", superId);
      setBusy(false);
      if (err) { setError(err.message); return; }
      setLinks(prev => {
        const next = { ...prev };
        delete next[superId];
        return next;
      });
    } else {
      // Agregar con peso 1.0 por defecto
      setBusy(true);
      const { error: err } = await supabase
        .from("task_super_links")
        .insert({ task_id: taskId, super_task_id: superId, weight: 1.0 });
      setBusy(false);
      if (err) { setError(err.message); return; }
      setLinks(prev => ({ ...prev, [superId]: 1.0 }));
    }
  };

  const updateWeight = async (superId, w) => {
    const next = Math.max(0.1, Math.min(5, Number(w) || 1));
    setLinks(prev => ({ ...prev, [superId]: next }));
    // Debounce simple: actualiza el server tras 400ms sin más cambios.
    if (updateWeight._timers) {
      clearTimeout(updateWeight._timers[superId]);
    } else {
      updateWeight._timers = {};
    }
    updateWeight._timers[superId] = setTimeout(async () => {
      const { error: err } = await supabase
        .from("task_super_links")
        .update({ weight: next })
        .eq("task_id", taskId)
        .eq("super_task_id", superId);
      if (err) setError(err.message);
    }, 400);
  };

  if (loading) {
    return <div style={{ fontSize: 12, color: "#888", padding: 8 }}>Cargando super-tareas…</div>;
  }
  if (error) {
    return <div style={{ fontSize: 12, color: "#c0392b", padding: 8, background: "#fde8e8", borderRadius: 6 }}>{error}</div>;
  }
  if (superTasks.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "#999", padding: 10, background: "#fafafa", border: "1px dashed #e0e0e0", borderRadius: 6, fontStyle: "italic" }}>
        Aún no hay super-tareas en este proyecto. Crea una desde la pestaña "Super-tareas".
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 2 }}>
        Marca las super-tareas a las que esta tarea aporta. El peso multiplica el aporte cuando se cierre (1.0 = aporte completo, 0.5 = mitad, etc.).
      </div>
      {superTasks.map(st => {
        const selected = links[st.id] !== undefined;
        const weight = links[st.id] ?? 1.0;
        return (
          <div key={st.id} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px",
            background: selected ? `${st.color}10` : "#fafafa",
            border: `1px solid ${selected ? st.color + "55" : "#f0f0f0"}`,
            borderRadius: 8,
            transition: "all 150ms",
          }}>
            <input
              type="checkbox"
              checked={selected}
              disabled={busy}
              onChange={() => toggleLink(st.id)}
              style={{ cursor: "pointer" }}
            />
            <span style={{ fontSize: 18 }}>{st.icon || "🎯"}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: selected ? 600 : 400, color: selected ? "#222" : "#555" }}>
              {st.title}
              <span style={{ color: "#999", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>
                · target {st.target_aporte}
              </span>
            </span>
            {selected && (
              <>
                <label style={{ fontSize: 10, color: "#666" }}>peso</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  value={weight}
                  onChange={(e) => updateWeight(st.id, e.target.value)}
                  style={{
                    width: 64,
                    padding: "4px 6px",
                    border: `1px solid ${st.color}55`,
                    borderRadius: 5,
                    fontSize: 12,
                    textAlign: "center",
                  }}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── TaskCommentsThread helpers ────────────────────────────
// Estos helpers son puros pero acceden a Date.now/Date que React 19 marca
// como "impuros" si están en el render. Sacarlos del componente evita el
// warning de react-hooks/purity.
const commentTimeAgo = (iso) => {
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "hace un momento";
  if (sec < 3600) return `hace ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `hace ${Math.floor(sec / 3600)} h`;
  if (sec < 604800) return `hace ${Math.floor(sec / 86400)} d`;
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
};
const commentInitials = (name) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
};
const commentColorOf = (name) => {
  if (!name) return "#9aa";
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 50%, 55%)`;
};

// ─── TaskCommentsThread ────────────────────────────────────
// Bitácora de avance por tarea. Lista cronológica de comentarios cortos
// con autor + timestamp. Cualquier miembro del proyecto puede comentar.
// El autor puede editar o borrar el suyo. Realtime via Supabase channel.
function TaskCommentsThread({ taskId, projectId }) {
  const confirm = useConfirm();
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState("");
  const [authUser, setAuthUser] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Obtener auth user actual una sola vez.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAuthUser(data?.user || null));
  }, []);

  // Cargar comentarios + realtime
  useEffect(() => {
    if (!taskId) return;
    let mounted = true;
    const load = async () => {
      const { data, error: err } = await supabase
        .from('task_comments')
        .select('*')
        .eq('task_id', taskId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (!mounted) return;
      if (err) {
        // Tabla puede no existir si la migración 013 no se aplicó.
        if (err.code === '42P01') {
          setError("Aplica la migración 013 para usar la bitácora.");
        } else {
          setError(err.message);
        }
        return;
      }
      setComments(data || []);
      setError("");
    };
    load();

    const channel = supabase
      .channel(`task-comments-${taskId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` }, () => load())
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [taskId]);

  const post = async () => {
    const text = draft.trim();
    if (!text || !authUser?.id || !projectId) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase.from('task_comments').insert({
      task_id: taskId,
      project_id: projectId,
      author_user_id: authUser.id,
      author_name: authUser.user_metadata?.full_name || authUser.email || "Anónimo",
      text,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDraft("");
  };

  const saveEdit = async (id) => {
    const text = editDraft.trim();
    if (!text) return;
    setBusy(true);
    const { error: err } = await supabase
      .from('task_comments')
      .update({ text })
      .eq('id', id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setEditingId(null);
    setEditDraft("");
  };

  const remove = async (id) => {
    if (!(await confirm("¿Borrar este comentario?", { title: 'Borrar comentario', confirmText: 'Borrar', danger: true }))) return;
    const { error: err } = await supabase
      .from('task_comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (err) setError(err.message);
  };


  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {error && (
        <div style={{ fontSize: 11, color: "#c0392b", padding: 6, background: "#fde8e8", borderRadius: 6 }}>{error}</div>
      )}

      {/* Lista de comentarios */}
      <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "2px 0" }}>
        {comments.length === 0 ? (
          <div style={{ fontSize: 12, color: "#888", textAlign: "center", padding: 12, fontStyle: "italic" }}>
            Aún no hay comentarios. Sé la primera persona en registrar un avance.
          </div>
        ) : comments.map(c => (
          <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
              background: commentColorOf(c.author_name), color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700,
            }}>{commentInitials(c.author_name)}</div>
            <div style={{ flex: 1, background: "#fafafa", borderRadius: 8, padding: "8px 10px", border: "1px solid #f0f0f0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#444" }}>{c.author_name}</span>
                <span style={{ fontSize: 10, color: "#999" }}>
                  {commentTimeAgo(c.created_at)}
                  {c.updated_at && c.updated_at !== c.created_at && " · editado"}
                </span>
              </div>
              {editingId === c.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <textarea value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
                    style={{ width: "100%", minHeight: 60, border: "1px solid #ddd", borderRadius: 6, padding: 6, fontSize: 13, fontFamily: "inherit" }}
                    autoFocus />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button disabled={busy} onClick={() => saveEdit(c.id)} style={{ background: "#542c9c", color: "#fff", border: "none", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Guardar</button>
                    <button onClick={() => { setEditingId(null); setEditDraft(""); }} style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#222", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>{c.text}</div>
              )}
              {authUser?.id === c.author_user_id && editingId !== c.id && (
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button onClick={() => { setEditingId(c.id); setEditDraft(c.text); }} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 10, padding: 0, textDecoration: "underline" }}>Editar</button>
                  <button onClick={() => remove(c.id)} style={{ background: "none", border: "none", color: "#c0392b", cursor: "pointer", fontSize: 10, padding: 0, textDecoration: "underline" }}>Borrar</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Nuevo comentario */}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              post();
            }
          }}
          placeholder="Registra un avance, una duda, un bloqueo... (Enter para enviar, Shift+Enter para nueva línea)"
          style={{ flex: 1, minHeight: 50, padding: 8, border: "1px solid #ddd", borderRadius: 6, fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
        />
        <button
          onClick={post}
          disabled={busy || !draft.trim() || !authUser?.id}
          style={{
            background: busy || !draft.trim() ? "#ddd" : "linear-gradient(135deg,#542c9c,#6e3ebf)",
            color: "#fff", border: "none", borderRadius: 6, padding: "10px 14px",
            cursor: busy || !draft.trim() ? "not-allowed" : "pointer",
            fontWeight: 600, fontSize: 13, whiteSpace: "nowrap",
          }}
        >
          {busy ? "..." : "Comentar"}
        </button>
      </div>
    </div>
  );
}

// ─── TaskForm ──────────────────────────────────────────────
// Formulario de creación/edición de una tarjeta. Dirigido 100% por props
// (task + setTask + catálogos). Extraído del monolito (H-002, núcleo fase A/B).
export default function TaskForm({ task, setTask, participants, indicators, taskTypes, currentUser, weights, dimensions, keyResults = [], sprints = [], taskHistory = [], tasks = [], customFieldDefs = [], projectId }) {
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

          {/* Dropdown de Sprint y OKR filtrado por la fecha de creación de la
              tarjeta: aparecen primero los que la contienen, los fuera de
              rango bajan con un aviso. Estos campos son default (no removibles). */}
          {(() => {
            // Normaliza la fecha de la tarjeta a YYYY-MM-DD para comparar con
            // start_date/end_date que vienen como DATE de Postgres.
            const taskDateISO = (() => {
              const s = String(task.createdAt || '');
              const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);          // es-CO "20/05/2026"
              if (m) return `${m[3]}-${m[2]}-${m[1]}`;
              const i = s.match(/(\d{4})-(\d{2})-(\d{2})/);            // ISO
              if (i) return `${i[1]}-${i[2]}-${i[3]}`;
              const d = new Date();                                    // fallback hoy
              return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            })();
            const inRange = (start, end) => !!start && !!end && taskDateISO >= String(start) && taskDateISO <= String(end);

            const activeSprints = sprints.filter(s => s.status !== 'closed');
            const sortedSprints = [...activeSprints].sort((a, b) => {
              const ai = inRange(a.start_date, a.end_date) ? 0 : 1;
              const bi = inRange(b.start_date, b.end_date) ? 0 : 1;
              if (ai !== bi) return ai - bi;
              return String(a.start_date || '').localeCompare(String(b.start_date || ''));
            });
            const sortedKRs = [...keyResults].sort((a, b) => {
              const ai = inRange(a.okr_start_date, a.okr_end_date) ? 0 : 1;
              const bi = inRange(b.okr_start_date, b.okr_end_date) ? 0 : 1;
              if (ai !== bi) return ai - bi;
              return String(a.okr_start_date || '').localeCompare(String(b.okr_start_date || ''));
            });

            return (
              <>
                {activeSprints.length > 0 && (
                  <F label="Sprint" half>
                    <select style={inp} value={task.sprintId || ""} onChange={e => upd("sprintId", e.target.value ? Number(e.target.value) : null)}>
                      <option value="">— Sin sprint —</option>
                      {sortedSprints.map(s => {
                        const ok = inRange(s.start_date, s.end_date);
                        const status = s.status === 'active' ? '▶' : '◐';
                        return (
                          <option key={s.id} value={s.id}>
                            [{status}] {s.name}{!ok ? '  ⚠ fuera de rango' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </F>
                )}

                {keyResults.length > 0 && (
                  <F label="Resultado clave (OKR)" half>
                    <select style={inp} value={task.krId || ""} onChange={e => upd("krId", e.target.value ? Number(e.target.value) : null)}>
                      <option value="">— Sin KR —</option>
                      {sortedKRs.map(kr => {
                        const ok = inRange(kr.okr_start_date, kr.okr_end_date);
                        return (
                          <option key={kr.id} value={kr.id}>
                            {kr.title}{!ok ? '  ⚠ fuera de rango' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </F>
                )}
              </>
            );
          })()}

          {/* Enlace a super-tareas: una tarea puede alimentar varias super-tareas
              con pesos distintos. Se persiste inmediatamente en task_super_links. */}
          {task.id && projectId && (
            <F label="Super-tareas que alimenta">
              <TaskSuperLinksEditor taskId={task.id} projectId={projectId} />
            </F>
          )}

          <F label="Descripción y observaciones">
            <textarea
              style={{ ...inp, minHeight: 110, resize: "vertical" }}
              value={task.comments}
              onChange={(e) => upd("comments", e.target.value)}
              placeholder={"¿Qué quieres lograr?\n¿Quién gana con esto?\nPasos 1. 2. 3.\n¿Cómo sabrás que quedó bien?\n¿Qué te puede frenar?"}
            />
          </F>

          {/* Bitácora de avance: thread cronológico de comentarios cortos por
              cualquier miembro del proyecto. Se persiste en task_comments. */}
          {task.id && (
            <F label="Bitácora de avance">
              <TaskCommentsThread taskId={task.id} projectId={task.projectId || task.project_id} />
            </F>
          )}

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
