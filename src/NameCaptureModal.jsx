// Modal global al primer login: captura el nombre completo del usuario.
// Se dispara si auth.user.user_metadata.full_name está vacío.
// Después de guardar, propaga el nombre a:
//   - auth.users (user_metadata.full_name)
//   - project_members.name de TODAS las membresías (RPC sync_my_name_across_projects)
//   - participants.name de TODAS las filas con auth_user_id = user.id
// Estos updates aseguran que el nombre aparezca consistente en
// tareas, comentarios, reportes y retros.

import React, { useState, useId } from "react";
import { useDialog } from "./useDialog";

export default function NameCaptureModal({ supabase, authUser, onComplete }) {
  const titleId = useId();
  // Modal obligatorio (sin cierre): el hook aporta foco inicial, trampa de foco
  // y devolución de foco. Sin onClose, Escape es no-op (es requerido). H-008.
  const dialogRef = useDialog();
  const existing = authUser?.user_metadata?.full_name || "";
  const [name, setName] = useState(existing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Si ya hay nombre válido (>= 3 chars, no es el email), no muestra modal.
  const hasName = existing && existing.length >= 3 && !existing.includes("@");
  if (!authUser || hasName) return null;

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 3) { setError("Tu nombre debe tener al menos 3 caracteres."); return; }
    if (trimmed.length > 80) { setError("El nombre es demasiado largo (máx 80)."); return; }
    if (!/^[\p{L}\p{M}\s'.\-]+$/u.test(trimmed)) {
      setError("Usa solo letras, espacios y - . ' (sin números o símbolos raros).");
      return;
    }

    setSaving(true);
    setError("");
    try {
      // 1. Guarda en auth.user_metadata
      const { error: e1 } = await supabase.auth.updateUser({ data: { full_name: trimmed } });
      if (e1) throw e1;

      // 2. Propaga a project_members + participants vía RPC
      const { error: e2 } = await supabase.rpc("sync_my_name_across_projects", { p_name: trimmed });
      if (e2) console.warn("[NameCaptureModal] sync RPC failed:", e2.message);

      onComplete?.(trimmed);
    } catch (err) {
      setError("No se pudo guardar: " + (err.message || err));
    }
    setSaving(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(13,13,26,0.92)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100001, backdropFilter: "blur(6px)",
      animation: "wpncFadeIn 0.3s ease",
    }}>
      <style>{`
        @keyframes wpncFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wpncSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{
        background: "#fff", borderRadius: 20, padding: 36, maxWidth: 480, width: "92%",
        boxShadow: "0 24px 80px rgba(0,0,0,0.4)", animation: "wpncSlideUp 0.4s ease",
        textAlign: "center", outline: "none",
      }}>
        <div style={{ fontSize: 60, marginBottom: 12 }}>👋</div>
        <h2 id={titleId} style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1e1e3a" }}>
          Antes de continuar, ¿cómo te llamas?
        </h2>
        <p style={{ margin: "12px 0 22px", color: "#666", fontSize: 14, lineHeight: 1.55 }}>
          Tu nombre completo aparecerá en tus tareas, comentarios, reportes y retros. Úsalo tal como te gustaría que el equipo te identificara.
        </p>

        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !saving) save(); }}
          placeholder="María González"
          maxLength={80}
          style={{
            width: "100%", padding: "12px 16px", border: "2px solid #e0e0e0",
            borderRadius: 10, fontSize: 16, fontFamily: "inherit",
            boxSizing: "border-box", outline: "none", color: "#1e1e3a",
            textAlign: "center", fontWeight: 600,
          }}
        />

        {error && (
          <div style={{ marginTop: 10, fontSize: 12, color: "#c0392b", fontWeight: 600 }}>
            {error}
          </div>
        )}

        <button
          onClick={save}
          disabled={saving || name.trim().length < 3}
          style={{
            marginTop: 18,
            background: saving || name.trim().length < 3
              ? "#ddd"
              : "linear-gradient(135deg,#542c9c,#6e3ebf)",
            color: "#fff", border: "none", borderRadius: 10,
            padding: "12px 32px", fontSize: 14, fontWeight: 700,
            cursor: saving || name.trim().length < 3 ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            transition: "transform 0.15s",
          }}
        >
          {saving ? "Guardando…" : "Continuar →"}
        </button>

        <div style={{ fontSize: 11, color: "#bbb", marginTop: 14 }}>
          Podrás cambiarlo después desde tu menú de perfil.
        </div>
      </div>
    </div>
  );
}
