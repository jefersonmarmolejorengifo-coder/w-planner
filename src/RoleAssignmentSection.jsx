// Sección dentro de Configuración para que el owner asigne roles SM/PO a
// los miembros del proyecto. Solo se renderiza dentro de ConfigTab (que ya
// es owner-only por el gating de tab content en ProductivityPlus).
//
// Datos: RPC project_members_with_role(p_project_id)
// Asignación: RPC set_project_member_role(p_project_id, p_member_user_id, p_role)
// Cambiar rol resetea el progreso del tour del usuario destino para que
// vea el tour correspondiente la próxima vez que entre al proyecto.

import React, { useEffect, useState } from "react";

const ROLE_LABELS = {
  po: { label: "Product Owner", emoji: "👔", color: "#542c9c" },
  scrum_master: { label: "Scrum Master", emoji: "🎯", color: "#149cac" },
  participant: { label: "Participante", emoji: "💪", color: "#ec6c04" },
};

export default function RoleAssignmentSection({ supabase, projectId, currentUserId }) {
  const [members, setMembers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingFor, setSavingFor] = useState(null);
  const [okFor, setOkFor] = useState(null);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    const { data, error: e } = await supabase.rpc("project_members_with_role", { p_project_id: projectId });
    if (e) setError(e.message);
    else setMembers(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [projectId]);

  const changeRole = async (m, newRole) => {
    if (newRole === m.role) return;
    setSavingFor(m.user_id);
    setError("");
    const { error: e } = await supabase.rpc("set_project_member_role", {
      p_project_id: projectId,
      p_member_user_id: m.user_id,
      p_role: newRole,
    });
    if (e) {
      setError(`No se pudo cambiar el rol de ${m.name || m.email}: ${e.message}`);
    } else {
      setMembers(prev => prev.map(x => x.user_id === m.user_id ? { ...x, role: newRole } : x));
      setOkFor(m.user_id);
      setTimeout(() => setOkFor(null), 2000);
    }
    setSavingFor(null);
  };

  if (loading && !members) {
    return <div style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 16px rgba(84,44,156,0.07)" }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#542c9c", marginBottom: 14 }}>🎭 Roles del equipo</div>
      <div style={{ fontSize: 12, color: "#999" }}>Cargando miembros…</div>
    </div>;
  }

  return (
    <div data-tour="config-roles" style={{ background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 16px rgba(84,44,156,0.07)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#542c9c" }}>🎭 Roles del equipo</div>
        <div style={{ fontSize: 11, color: "#888" }}>
          {members?.length || 0} miembro{members?.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#666", marginBottom: 14, lineHeight: 1.5, padding: "10px 12px", background: "#faf8ff", borderRadius: 8, border: "1px solid #efe6ff" }}>
        Los miembros invitados llegan como <b>Participante</b>. Como dueño del proyecto, asígnales <b>Product Owner</b> o <b>Scrum Master</b> según corresponda. Cambiar el rol activa el tour del nuevo rol y desbloquea las funciones específicas.
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#c0392b", padding: 10, background: "#fde8e8", borderRadius: 8, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(members || []).map(m => {
          const def = ROLE_LABELS[m.role] || ROLE_LABELS.participant;
          const initials = (m.name || m.email).split(/\s+/).map(s => s[0]).join("").slice(0, 2).toUpperCase();
          return (
            <div key={m.user_id || m.email} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 12px", background: "#fafafa",
              borderRadius: 10, border: "1px solid #f0f0f0",
              borderLeft: `3px solid ${def.color}`,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: "50%",
                background: def.color, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, flexShrink: 0,
              }}>{initials || "?"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#1e1e3a", display: "flex", alignItems: "center", gap: 6 }}>
                  {m.name || m.email}
                  {m.is_owner && <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 8, background: "#fff4e0", color: "#c95903" }}>OWNER</span>}
                </div>
                <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.email}</div>
              </div>
              <select
                value={m.role}
                onChange={(e) => changeRole(m, e.target.value)}
                disabled={savingFor === m.user_id}
                style={{
                  background: "#fff", border: `1.5px solid ${def.color}`,
                  borderRadius: 8, padding: "6px 10px", fontSize: 12,
                  fontWeight: 600, color: def.color, fontFamily: "inherit",
                  cursor: savingFor === m.user_id ? "wait" : "pointer",
                }}
              >
                <option value="po">👔 Product Owner</option>
                <option value="scrum_master">🎯 Scrum Master</option>
                <option value="participant">💪 Participante</option>
              </select>
              {savingFor === m.user_id && (
                <span style={{ fontSize: 10, color: "#888" }}>…</span>
              )}
              {okFor === m.user_id && (
                <span style={{ fontSize: 11, color: "#27ae60", fontWeight: 700 }}>✓</span>
              )}
            </div>
          );
        })}
        {members?.length === 0 && (
          <div style={{ fontSize: 12, color: "#999", padding: 14, textAlign: "center", fontStyle: "italic" }}>
            Aún no hay miembros invitados. Usa la sección <b>🏗️ Proyecto</b> arriba para invitar a tu equipo por correo.
          </div>
        )}
      </div>
    </div>
  );
}
