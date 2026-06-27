import { useState } from "react";
import { getUserColor, getInitials } from '../lib/format';

// ─── UserSelectScreen ─────────────────────────────────────
// getUserColor / getInitials viven ahora en ./lib/format (importados arriba).

export default function UserSelectScreen({ participants, activeUsers, onSelect, onConflict }) {
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
            <button
              type="button"
              key={p.id}
              onMouseEnter={() => setHovered(p.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => !isSelected && handleSelect(p)}
              disabled={isSelected}
              aria-label={`Seleccionar perfil ${p.name}${online ? " (en línea)" : ""}`}
              style={{
                width: 130, padding: "20px 10px", borderRadius: 16,
                background: isSelected ? "rgba(236,108,4,0.15)" : isHovered ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${isSelected ? color : isHovered ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.06)"}`,
                cursor: isSelected ? "default" : "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                animation: isSelected ? "selectedZoom 0.6s ease forwards 0.1s" : `cardEntrance 0.5s ease ${i * 0.07}s both`,
                transition: "background 0.3s, border 0.3s, transform 0.3s",
                transform: isHovered && !isSelected ? "translateY(-4px)" : "none",
                fontFamily: "inherit",
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
            </button>
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
