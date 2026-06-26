import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { getAuthJsonHeaders } from "../../lib/authHeaders";
import { ConfigSection } from "../../lib/ConfigSection";
import RoleAssignmentSection from "../../RoleAssignmentSection";
import DimensionEditor from "./DimensionEditor";
import FieldDefEditor from "./FieldDefEditor";
import PremiumPanel from "./PremiumPanel";
import ReportsConfigSection from "./ReportsConfigSection";
import { useConfirm } from "../../ui/ConfirmDialog";

// Pestaña de configuración del proyecto (owner-only): datos del proyecto,
// invitaciones, roles, PIN, participantes, indicadores, tipos de tarea,
// dimensiones de aporte, campos personalizados, panel premium y reportes IA.
// Extraída del monolito y cargada con React.lazy (H-002, fase final de ConfigTab).
export default function ConfigTab({ participants, setParticipants, indicators, setIndicators, taskTypes, setTaskTypes, dimensions, setDimensions, project, onChangePin, taskFieldDefs = [], addTaskFieldDef, updateTaskFieldDef, deleteTaskFieldDef, reorderTaskFieldDefs }) {
  const confirm = useConfirm();
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

  const toggleSuper = (id) => {
    const target = participants.find((p) => p.id === id);
    if (!target) return;
    if (target.name === "Jeferson Marmolejo") return;
    setParticipants((prev) => prev.map((p) => {
      if (p.id === id) return { ...p, isSuperUser: true };
      return { ...p, isSuperUser: false };
    }));
  };
  const removeP = async (id) => { if (await confirm("¿Eliminar participante?", { title: 'Eliminar participante', confirmText: 'Eliminar', danger: true })) setParticipants((prev) => prev.filter((p) => p.id !== id)); };

  const addI = () => {
    const name = newI.trim();
    if (!name || indicators.some((i) => i.name.toLowerCase() === name.toLowerCase())) return;
    setIndicators((prev) => [...prev, { id: Date.now(), name }]);
    setNewI("");
  };
  const removeI = async (id) => { if (await confirm("¿Eliminar indicador?", { title: 'Eliminar indicador', confirmText: 'Eliminar', danger: true })) setIndicators((prev) => prev.filter((i) => i.id !== id)); };

  const addType = () => {
    const name = newType.trim();
    if (!name || taskTypes.some((t) => t.name.toLowerCase() === name.toLowerCase())) return;
    setTaskTypes((prev) => [...prev, { id: Date.now(), name }]);
    setNewType("");
    setTypeMsg("Tipo agregado correctamente");
    setTimeout(() => setTypeMsg(""), 3000);
  };
  const removeType = async (id) => {
    if (!(await confirm("¿Eliminar tipo de tarea?", { title: 'Eliminar tipo de tarea', confirmText: 'Eliminar', danger: true }))) return;
    setTaskTypes((prev) => prev.filter((t) => t.id !== id));
  };

  const si = { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-primary)", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none", fontFamily: "inherit", flex: 1 };
  const addBtn = { background: "linear-gradient(135deg, #542c9c, #6e3ebf)", border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, boxShadow: "0 3px 10px rgba(84,44,156,0.3)" };

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Proyecto ───────────────────────── */}
      {project && (
        <ConfigSection title="🏗️ Proyecto" tourId="config-project">
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

      {/* ── Roles del equipo (Fase A onboarding) ────────────
          Asignación de PO / SM / Participante a los miembros del proyecto.
          Solo el owner ve esta sección. */}
      {project?.id && (
        <RoleAssignmentSection supabase={supabase} projectId={project.id} />
      )}

      {/* ── Cambio de clave ─────────────────── */}
      <ConfigSection title="🔐 Clave de configuración" tourId="config-pin">
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

      <ConfigSection title="👥 Participantes" tourId="config-people">
        {/* Fase D: la lista de participantes se alimenta automáticamente de
            los miembros invitados (project_members) cuando entran y registran
            su nombre. Los ficticios del seed quedan marcados como LEGACY.
            No hay 'agregar a mano': se invita por email desde la sección
            🏗️ Proyecto y el participante se crea solo al registrarse. */}
        <div style={{ fontSize: 12, color: "#666", marginBottom: 14, lineHeight: 1.5, padding: "10px 12px", background: "#faf8ff", borderRadius: 8, border: "1px solid #efe6ff" }}>
          Esta lista se alimenta automáticamente: cuando invitas a alguien por correo (sección <b>🏗️ Proyecto</b>) y se registra, aparece aquí con su nombre real. Los ficticios del proyecto demo o de seeds antiguos quedan marcados como <b>LEGACY</b> y siguen siendo asignables, pero no son cuentas reales.
        </div>
        {participants.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-secondary)", textAlign: "center", padding: 14, fontStyle: "italic" }}>
            Aún no hay participantes. Invita a tu equipo por correo en la sección <b>🏗️ Proyecto</b>.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(() => {
              const real = participants.filter(p => !p.isLegacy);
              const legacy = participants.filter(p => p.isLegacy);
              const Row = (p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fafafa", borderRadius: 8, border: "1px solid rgba(84,44,156,0.08)", opacity: p.isLegacy ? 0.85 : 1 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    background: p.isLegacy ? "linear-gradient(135deg, #999, #bbb)"
                              : p.isSuperUser ? "linear-gradient(135deg, #ec6c04, #f07d1e)"
                              : "linear-gradient(135deg, #542c9c, #6e3ebf)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700, color: "#ffffff",
                  }}>
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span style={{ flex: 1, fontSize: 13, color: "var(--color-text-primary)" }}>{p.name}</span>
                  {p.isLegacy && (
                    <span title="Participante ficticio sin cuenta real — sigue siendo asignable" style={{ fontSize: 9, background: "#e8e8e8", color: "#666", padding: "2px 8px", borderRadius: 8, fontWeight: 700 }}>
                      LEGACY
                    </span>
                  )}
                  {p.isSuperUser && !p.isLegacy && (
                    <span style={{ fontSize: 10, background: "linear-gradient(135deg, #ec6c04, #f07d1e)", color: "#ffffff", padding: "2px 8px", borderRadius: 8, fontWeight: 700 }}>
                      SUPER
                    </span>
                  )}
                  {!p.isLegacy && (
                    <button
                      onClick={() => toggleSuper(p.id)}
                      style={{ background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-secondary)", borderRadius: 6, padding: "3px 9px", cursor: "pointer", fontSize: 11 }}
                    >
                      {p.isSuperUser ? "Quitar super" : "Hacer super"}
                    </button>
                  )}
                  <button onClick={() => removeP(p.id)} title={p.isLegacy ? "Quitar este participante ficticio" : "Quitar (las tareas mantienen su valor histórico)"} style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", color: "var(--color-text-danger)", borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              );
              return (
                <>
                  {real.length > 0 && real.map(Row)}
                  {legacy.length > 0 && (
                    <>
                      {real.length > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 12, marginBottom: 4 }}>Ficticios (legacy)</div>}
                      {legacy.map(Row)}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </ConfigSection>

      <ConfigSection title="📊 Indicadores clave" tourId="config-indicators">
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

      <ConfigSection title="🧩 Tipos de tarea" tourId="config-types">
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

      <ConfigSection title="⚖️ Dimensiones de Valor de Aporte" tourId="config-calculator">
        <div style={{ fontSize: 12, color: "#888", marginBottom: 12, lineHeight: 1.5 }}>
          Define las dimensiones que se evalúan en cada tarea y su peso relativo en el cálculo de aporte. Puedes renombrar, ajustar pesos y agregar o quitar dimensiones personalizadas.
        </div>
        <DimensionEditor dimensions={dimensions} setDimensions={setDimensions} />
      </ConfigSection>

      <ConfigSection title="🧩 Estructura de la tarjeta (campos personalizados)" tourId="config-fields">
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

      <PremiumPanel projectId={project?.id} />

      <ReportsConfigSection projectId={project?.id} />

      {/* Vista legacy del Reporte IA — solo visible si el usuario hace clic en "Mostrar configuración antigua". Conservada como respaldo durante la transición a report_configs. */}
      <details style={{ background: "#fff", borderRadius: 14, padding: 12, boxShadow: "0 2px 16px rgba(84,44,156,0.07)", border: "1px solid rgba(84,44,156,0.1)" }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "#999", padding: 6 }}>Configuración antigua (solo respaldo)</summary>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#542c9c", borderBottom: "2px solid #ede8f8", paddingBottom: 10, marginBottom: 16, marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
          📧 Reporte IA por correo (legacy)
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
            La IA analiza cada tarea, usuario y resultado en lenguaje natural dentro del rango configurado.
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
      </details>
    </div>
  );
}
