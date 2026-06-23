import { parseDeps } from "../../lib/deps";

// Tarjeta rica de tarea para la vista de Presentación. La comparten PresentationTab
// y SuperTaskExpanded, por eso vive en su propio módulo hoja. Extraída del monolito (H-002).
// colorByStatus se pasa por prop (STATUS_COLORS) para no acoplar a constantes aquí.
export function PresentationCard({ task, taskFieldDefs, tasks, colorByStatus, isActive, onHover, onLeave, onClick, pinned, focusedPersona }) {
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

// Pastilla para una tarea enlazada (dependencia o dependiente) en la Presentación.
// Se colorea por estado y se aplana en gris cuando hay foco en otra persona.
function LinkedTaskChip({ task, colorByStatus, focusedPersona }) {
  const status = task.status || "Sin iniciar";
  const isOtherPerson = focusedPersona && task.responsible !== focusedPersona;
  const statusColor = colorByStatus[status] || "#888";

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
