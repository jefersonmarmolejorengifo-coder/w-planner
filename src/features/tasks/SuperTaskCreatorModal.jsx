import { useState, useId } from "react";
import { supabase } from "../../supabaseClient";
import { useDialog } from "../../useDialog";

// Modal de creación de super-tareas (objetivos que agrupan tareas con pesos).
// Extraído del monolito (H-002) y cargado con React.lazy: solo se descarga cuando
// el usuario abre el creador.
export default function SuperTaskCreatorModal({ projectId, tasks, onClose, onCreated }) {
  const titleId = useId();
  const dialogRef = useDialog(onClose);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("🎯");
  const [color, setColor] = useState("#542c9c");
  const [targetAporte, setTargetAporte] = useState(100);
  const [selectedTasks, setSelectedTasks] = useState({}); // id → weight
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const PRESET_ICONS = ["🎯","🚀","🏆","💎","⭐","🔥","🌟","🏺","🌊","🎨","🛡️","🧭"];
  const PRESET_COLORS = ["#542c9c","#0aa0ab","#ef7218","#27ae60","#e74c3c","#f1c40f","#9b59b6","#2980b9","#16a085","#d35400"];

  const toggleTask = (taskId, weight = 1.0) => {
    setSelectedTasks(prev => {
      const next = { ...prev };
      if (next[taskId] !== undefined) delete next[taskId];
      else next[taskId] = weight;
      return next;
    });
  };

  const create = async () => {
    if (!title.trim()) { setError("El título es obligatorio"); return; }
    setBusy(true);
    setError("");
    const { data: st, error: stErr } = await supabase.from("super_tasks").insert({
      project_id: projectId,
      title: title.trim(),
      description: description.trim() || null,
      icon, color,
      target_aporte: Number(targetAporte) || 100,
    }).select().single();
    if (stErr) {
      setError(stErr.message);
      setBusy(false);
      return;
    }
    // Linkea las tareas seleccionadas
    const linkPayload = Object.entries(selectedTasks).map(([taskId, weight]) => ({
      task_id: Number(taskId),
      super_task_id: st.id,
      weight: Number(weight) || 1.0,
    }));
    if (linkPayload.length) {
      const { error: lkErr } = await supabase.from("task_super_links").insert(linkPayload);
      if (lkErr) {
        setError("Super-tarea creada pero falló enlazar tareas: " + lkErr.message);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    onCreated();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ background: "#fff", borderRadius: 12, padding: 24, maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto", outline: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 id={titleId} style={{ margin: 0, color: "#542c9c", fontSize: 18 }}>{icon} Nueva super-tarea</h3>
          <button onClick={onClose} aria-label="Cerrar" style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "#888" }}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4 }}>Título *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Lanzar app v1.0"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4 }}>Target de aporte</label>
            <input type="number" value={targetAporte} onChange={(e) => setTargetAporte(e.target.value)} min="1"
              style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14, boxSizing: "border-box" }} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4 }}>Descripción</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            placeholder="¿Qué significa cerrar este objetivo? ¿Cómo sabes que está completo?"
            style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4 }}>Ícono</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {PRESET_ICONS.map(i => (
                <button key={i} onClick={() => setIcon(i)} style={{ background: icon === i ? color + "22" : "#fafafa", border: `1px solid ${icon === i ? color : "#e0e0e0"}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 18 }}>{i}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 4 }}>Color</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{ background: c, border: c === color ? "3px solid #333" : "1px solid #ddd", borderRadius: 6, width: 28, height: 28, cursor: "pointer", padding: 0 }} />
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, color: "#666", marginBottom: 6, fontWeight: 600 }}>
            Tareas a enlazar ({Object.keys(selectedTasks).length} seleccionadas)
          </label>
          <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, padding: 8 }}>
            {tasks.length === 0 && <div style={{ color: "#999", fontSize: 12, padding: 8 }}>No hay tareas aún</div>}
            {tasks.map(t => {
              const selected = selectedTasks[t.id] !== undefined;
              const weight = selectedTasks[t.id] ?? 1.0;
              return (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 4, background: selected ? color + "11" : "transparent" }}>
                  <input type="checkbox" checked={selected} onChange={() => toggleTask(t.id)} />
                  <span style={{ flex: 1, fontSize: 12, color: "#333" }}>
                    <b>#{t.id}</b> {t.title} <span style={{ color: "#888" }}>· {t.responsible || "N/A"}</span>
                  </span>
                  {selected && (
                    <>
                      <span style={{ fontSize: 10, color: "#888" }}>peso</span>
                      <input type="number" step="0.1" min="0.1" max="5" value={weight}
                        onChange={(e) => setSelectedTasks(prev => ({ ...prev, [t.id]: Number(e.target.value) }))}
                        style={{ width: 60, padding: "2px 6px", border: "1px solid #ddd", borderRadius: 4, fontSize: 11 }} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {error && <div style={{ background: "#fde8e8", border: "1px solid #f5c6c6", color: "#c0392b", padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy} style={{ background: "#fff", border: "1px solid #ddd", color: "#555", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>Cancelar</button>
          <button onClick={create} disabled={busy || !title.trim()} style={{ background: busy || !title.trim() ? "#ddd" : `linear-gradient(135deg, ${color}, ${color}cc)`, color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: busy ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700 }}>
            {busy ? "Creando..." : "Crear super-tarea"}
          </button>
        </div>
      </div>
    </div>
  );
}
