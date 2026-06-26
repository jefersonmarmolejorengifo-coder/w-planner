import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
// La versión que muestra el footer sale de package.json (fuente única de verdad).
// Bumpéala ahí siguiendo SemVer (MAYOR.MENOR.PARCHE) y el footer se actualiza solo.
// Named import → Vite hace tree-shaking y solo entra `version` al bundle.
import { version as APP_VERSION } from "../package.json";
import { supabase } from './supabaseClient';
import { REPORT_TYPE_LABEL, STATUS_COLORS, STATUS_LIGHT, ESTADOS, DEFAULT_TASK_TYPES } from './constants';
import { getAuthJsonHeaders } from './lib/authHeaders';
import { getUserColor, getInitials } from './lib/format';
import { CustomFieldsRenderer } from './lib/CustomFieldsRenderer';

// Paneles pesados cargados bajo demanda (H-002, code-splitting con React.lazy):
// salen del bundle inicial y se descargan solo cuando el usuario los abre.
const PlanSelectionModal = lazy(() => import('./features/billing/PlanSelectionModal'));
const ConsolidatedDashboard = lazy(() => import('./features/dashboard/ConsolidatedDashboard'));
const SuperTasksTab = lazy(() => import('./features/tasks/SuperTasksTab'));
const FocusTab = lazy(() => import('./features/focus/FocusTab'));
const EvolutionTab = lazy(() => import('./features/evolution/EvolutionTab'));
const ChatEnterpriseTab = lazy(() => import('./features/chat/ChatEnterpriseTab'));
const OKRsTab = lazy(() => import('./features/okrs/OKRsTab'));
const DependenciesTab = lazy(() => import('./features/deps/DependenciesTab'));
const SprintsTab = lazy(() => import('./features/sprints/SprintsTab'));
const MetricsTab = lazy(() => import('./features/metrics/MetricsTab'));
const PresentationTab = lazy(() => import('./features/presentation/PresentationTab'));
const ConfigTab = lazy(() => import('./features/config/ConfigTab'));
const BoardTab = lazy(() => import('./features/board/BoardTab'));
const GanttTab = lazy(() => import('./features/board/GanttTab'));
import Onboarding from './Onboarding';
import NameCaptureModal from './NameCaptureModal';
import { DEFAULT_DIMENSIONS } from './lib/aporte';
import { useProjectData } from './hooks/useProjectData';
import { usePresence } from './hooks/usePresence';
import { useReferralCapture, getReferralCode } from './hooks/useReferralCapture';
import { useReferralSync } from './hooks/useReferralSync';

// getAuthJsonHeaders vive ahora en ./lib/authHeaders (importado arriba).

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

// STATUS_COLORS/STATUS_LIGHT/TIPOS/DEFAULT_TASK_TYPES/ESTADOS viven en ./constants.
// TYPE_COLORS (solo lo usaba MetricsTab) vive ahora en su feature.
// CLOSE_STATES vive ahora en ./features/board/TaskForm (privado de TaskForm). H-002.
const DEFAULT_PIN = "020419*";
// DEFAULT_DIMENSIONS vive ahora en ./lib/aporte (importado arriba). H-002.

// getColombiaNow vive ahora en ./lib/format (importado arriba).

// daysBetween (solo lo usaba MetricsTab) vive ahora en su feature.

// emptyTask, formatCardCustomField, TaskCard, TaskCardWithClick, Modal, BoardTab
// y GanttTab viven ahora en ./features/board/* y se cargan con React.lazy
// (BoardTab arrastra a TaskForm a su chunk). H-002, núcleo fase C.

// MetricsSection/MetricCard/MetricRow/MetricsTab viven ahora en
// ./features/metrics/MetricsTab y se cargan con React.lazy. H-002.
// (MetricsTab extraído a ./features/metrics/MetricsTab — ver lazy import.)

// ─── DimensionEditor ───────────────────────────────────────
// DimensionEditor vive ahora en ./features/config/DimensionEditor (importado para ConfigTab). H-002.

// ConfigSection vive ahora en ./lib/ConfigSection (importado arriba). H-002.

// FieldDefEditor (+ FIELD_TYPE_LABELS/FIELD_TYPE_HINTS) vive ahora en
// ./features/config/FieldDefEditor (importado para ConfigTab). H-002.

// ─── ReportsConfigSection ──────────────────────────────────
// Reemplaza la antigua "Reporte IA por correo" por 3 cards independientes:
// Scrum bi-semanal, Semanal PO y Mensual del Equipo.
// Cada uno con destinatarios, schedule y botón de envío manual independientes.
// Persiste en report_configs (migración 012).
// PremiumPanel vive ahora en ./features/config/PremiumPanel (importado para ConfigTab). H-002.

// REPORT_TYPES + DAY_NAMES_ES + ReportsConfigSection + ReportCard viven ahora en
// ./features/config/ReportsConfigSection (importado para ConfigTab). H-002.

// (ReportCard extraído junto con ReportsConfigSection — ver import.)

// ─── ConfigTab ─────────────────────────────────────────────
// ConfigTab vive ahora en ./features/config/ConfigTab y se carga con
// React.lazy (ver bloque de imports). Última fase de la descomposición de
// ConfigTab (H-002). RoleAssignmentSection, ConfigSection, los editores y
// ReportsConfigSection migraron con él.

// ─── AuthScreen ───────────────────────────────────────────
// Inicio de sesión por LINK MÁGICO (passwordless). El usuario escribe su correo
// y recibe un enlace; al abrirlo vuelve a la app y la sesión entra sola (la
// detecta supabase-js en la URL y App la rutea en onAuthStateChange SIGNED_IN).
// shouldCreateUser:true → mismo flujo sirve para entrar y para registrarse. El
// nombre se captura después con NameCaptureModal al primer login.
function AuthScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const inp = { background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "13px 14px", fontSize: 15, outline: "none", fontFamily: "inherit", color: "#fff", width: "100%", boxSizing: "border-box", transition: "border-color 0.2s" };
  const lbl = { fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 };

  const sendLink = async () => {
    const mail = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { setError("Escribe un correo válido."); return; }
    setLoading(true); setError('');
    const { error: err } = await supabase.auth.signInWithOtp({
      email: mail,
      options: {
        // Vuelve a esta misma URL (conserva ?join=... para invitaciones).
        emailRedirectTo: window.location.origin + window.location.search,
        shouldCreateUser: true,
      },
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSent(true);
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
          {sent ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 44, marginBottom: 10 }}>📬</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 8 }}>Revisa tu correo</div>
              <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
                Te enviamos un enlace de acceso a<br />
                <b style={{ color: "#fff" }}>{email.trim().toLowerCase()}</b>.<br />
                Ábrelo desde este dispositivo para entrar.
              </div>
              <button onClick={() => { setSent(false); setError(''); }}
                style={{ marginTop: 22, background: "transparent", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 10, padding: "10px 18px", cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" }}>
                Usar otro correo
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Entra sin contraseña</div>
                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                  Escribe tu correo y te enviamos un enlace seguro para entrar. Si es tu primera vez, tu cuenta se crea sola.
                </div>
              </div>
              <div>
                <label style={lbl}>Correo electrónico</label>
                <input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && sendLink()} placeholder="tu@correo.com" autoFocus />
              </div>
              {error && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{error}</div>}
              <button onClick={sendLink} disabled={loading}
                style={{ background: loading ? "#555" : "linear-gradient(135deg,#ec6c04,#f07d1e)", color: "#fff", border: "none", borderRadius: 10, padding: "13px", cursor: loading ? "default" : "pointer", fontWeight: 700, fontSize: 14, width: "100%", boxShadow: loading ? "none" : "0 4px 20px rgba(236,108,4,0.4)", marginTop: 4, fontFamily: "inherit" }}>
                {loading ? "Enviando enlace..." : "Enviarme el enlace →"}
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
// getUserColor / getInitials viven ahora en ./lib/format (importados arriba).

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
// ─── Visión consolidada (dashboard del dueño) ─────────────────
// Agrega el análisis de TODOS los tableros del dueño en una sola vista. Solo
// para cuentas de pago (capacity.tier != 'free' y status active). Incluye una
// sesión de "Reportes IA" que lista y muestra los reportes archivados
// (report_history) de cada tablero. RLS: el dueño solo ve sus propios tableros.
const TASK_DONE = "Finalizada", TASK_BLOCKED = "Bloqueada";

// ConsolidatedDashboard vive ahora en ./features/dashboard/ConsolidatedDashboard
// y se carga con React.lazy (ver import arriba). H-002.

// ─── Resumen del tablero activo (pastilla + panel) ────────────
// Pastilla en el header que abre un panel con la info general del tablero
// puntual: KPIs, distribución por estado, top aportantes y los reportes de IA
// archivados de ESE tablero. Reusa el estilo del dashboard consolidado.
function BoardSummaryPill({ projectId, projectName }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [s, setS] = useState(null);
  const [reports, setReports] = useState([]);
  const [openReport, setOpenReport] = useState(null);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [{ data: tk }, { data: rh }] = await Promise.all([
        supabase.from("tasks").select("status, responsible, aporte_snapshot, end_date").eq("project_id", projectId),
        supabase.from("report_history").select("id, report_type, period_start, period_end, plain_text, model_used").eq("project_id", projectId).order("generated_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const ts = tk || [];
      const today = new Date().toISOString().slice(0, 10);
      const total = ts.length;
      const done = ts.filter(t => t.status === TASK_DONE).length;
      const blocked = ts.filter(t => t.status === TASK_BLOCKED).length;
      const notStarted = ts.filter(t => t.status === "Sin iniciar").length;
      const inProgress = total - done - blocked - notStarted;
      const overdue = ts.filter(t => t.status !== TASK_DONE && t.end_date && t.end_date < today).length;
      const aporteBy = {};
      ts.forEach(t => { if (t.responsible) aporteBy[t.responsible] = (aporteBy[t.responsible] || 0) + (Number(t.aporte_snapshot) || 0); });
      const top = Object.entries(aporteBy).sort((a, b) => b[1] - a[1]).slice(0, 3);
      setS({ total, done, blocked, notStarted, inProgress, overdue, people: new Set(ts.map(t => t.responsible).filter(Boolean)).size, donePct: total ? Math.round(done / total * 100) : 0, top });
      setReports(rh || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, projectId]);

  const card = { background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 14, padding: 16, color: "#fff" };
  const seg = [
    { n: "done", label: "Hechas", c: "#27ae60" },
    { n: "inProgress", label: "En proceso", c: "#3a86d6" },
    { n: "blocked", label: "Bloqueadas", c: "#e74c3c" },
    { n: "notStarted", label: "Sin iniciar", c: "#7a8aa0" },
  ];

  return (
    <>
      <button onClick={() => setOpen(true)} title="Resumen de este tablero"
        style={{ background: "rgba(20,156,172,0.18)", border: "1px solid rgba(20,156,172,0.45)", color: "#4dd8e8", borderRadius: 999, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap" }}>
        📊 Resumen
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 100002, background: "radial-gradient(900px 500px at 50% -10%, rgba(20,156,172,0.18), rgba(8,8,18,0.95) 60%)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "44px 18px" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 680, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>Resumen del tablero</div>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>{projectName || "Tablero"}</h2>
              </div>
              <button onClick={() => setOpen(false)} style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 17, cursor: "pointer", flexShrink: 0 }}>✕</button>
            </div>

            {loading || !s ? (
              <div style={{ ...card, textAlign: "center", color: "rgba(255,255,255,0.6)", padding: 40 }}>Cargando resumen…</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* KPIs */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 10 }}>
                  {[["Avance", `${s.donePct}%`, "#27ae60"], ["Tareas", s.total, "#fff"], ["Bloqueadas", s.blocked, s.blocked ? "#e74c3c" : "#fff"], ["Vencidas", s.overdue, s.overdue ? "#f5a623" : "#fff"], ["Personas", s.people, "#bb8fff"]].map(([l, v, c]) => (
                    <div key={l} style={{ ...card, textAlign: "center", padding: "13px 8px" }}>
                      <div style={{ fontSize: 24, fontWeight: 800, color: c, letterSpacing: -1 }}>{v}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 3 }}>{l}</div>
                    </div>
                  ))}
                </div>

                {/* Distribución por estado */}
                <div style={card}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Distribución por estado</div>
                  <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
                    {seg.map(g => s[g.n] > 0 && <div key={g.n} title={`${g.label}: ${s[g.n]}`} style={{ width: `${s[g.n] / s.total * 100}%`, background: g.c }} />)}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
                    {seg.map(g => (
                      <span key={g.n} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: g.c }} />{g.label}: <b style={{ color: "#fff" }}>{s[g.n]}</b>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Top aportantes */}
                {s.top.length > 0 && (
                  <div style={card}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Top aportantes</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {s.top.map(([name, ap], i) => (
                        <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 13 }}>{["🥇", "🥈", "🥉"][i]}</span>
                          <span style={{ flex: 1, fontSize: 13, color: "#fff" }}>{name}</span>
                          <span style={{ fontSize: 12, color: "#7ee2a8", fontWeight: 700 }}>{ap.toFixed(1)} pts</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reportes IA del tablero */}
                <div style={card}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Reportes IA ({reports.length})</div>
                  {reports.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)" }}>Aún no hay reportes archivados de este tablero.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {reports.map(r => (
                        <button key={r.id} onClick={() => setOpenReport(r)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, padding: "9px 11px", cursor: "pointer", textAlign: "left", color: "#fff", fontFamily: "inherit" }}>
                          <span style={{ fontSize: 12.5 }}><b>{REPORT_TYPE_LABEL[r.report_type] || r.report_type}</b><span style={{ color: "rgba(255,255,255,0.45)" }}> · {r.period_start} a {r.period_end}</span></span>
                          <span style={{ fontSize: 11, color: "#4dd8e8" }}>Ver →</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {openReport && (
            <div onClick={() => setOpenReport(null)} style={{ position: "fixed", inset: 0, zIndex: 100003, background: "rgba(5,5,14,0.82)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <div onClick={e => e.stopPropagation()} style={{ background: "#14141f", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, maxWidth: 760, width: "100%", maxHeight: "85vh", overflowY: "auto", padding: 26, color: "#fff", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800 }}>{REPORT_TYPE_LABEL[openReport.report_type] || openReport.report_type}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{openReport.period_start} a {openReport.period_end}</div>
                  </div>
                  <button onClick={() => setOpenReport(null)} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>Cerrar</button>
                </div>
                <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13.5, lineHeight: 1.6, color: "rgba(255,255,255,0.85)", margin: 0 }}>{openReport.plain_text || "(Sin texto archivado)"}</pre>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

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
  const [capacity, setCapacity] = useState(null); // límite de tableros por plan (user_ia_capacity)
  const [ownerNames, setOwnerNames] = useState({}); // { projectId: nombre del owner que invitó }
  const [showConsolidated, setShowConsolidated] = useState(false); // dashboard del dueño
  const [deletingProject, setDeletingProject] = useState(null); // project being confirmed for deletion
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);
  const DELETE_CONFIRM_PHRASE = 'Borrar Proyecto';

  useEffect(() => {
    supabase.from('project_templates').select('*').then(({ data }) => { if (data) setTemplates(data); });
  }, []);

  // Capacidad del plan (cuántos tableros puede crear). El límite real lo enforce
  // el servidor (trigger en projects, migración 027); esto es solo UX.
  useEffect(() => {
    if (!authUser?.id) { setCapacity(null); return; }
    supabase.rpc('user_ia_capacity').single().then(({ data }) => setCapacity(data || null));
  }, [authUser]);

  // Para los tableros donde soy invitado (no soy owner), resuelve el nombre de
  // quien me invitó (el owner) leyendo su fila en project_members.
  useEffect(() => {
    if (!authUser?.id || myProjects.length === 0) return;
    const invited = myProjects.filter(p => p.owner_id !== authUser.id);
    if (invited.length === 0) return;
    let cancelled = false;
    (async () => {
      const ids = invited.map(p => p.id);
      const { data } = await supabase
        .from('project_members')
        .select('project_id, name, user_id')
        .in('project_id', ids);
      if (cancelled || !data) return;
      const byProject = {};
      for (const proj of invited) {
        const ownerRow = data.find(m => m.project_id === proj.id && m.user_id === proj.owner_id);
        if (ownerRow?.name) byProject[proj.id] = ownerRow.name;
      }
      setOwnerNames(prev => ({ ...prev, ...byProject }));
    })();
    return () => { cancelled = true; };
  }, [authUser, myProjects]);

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

  // Límite de tableros por plan: tier_limits.total_projects vía user_ia_capacity.
  // Plan gratuito = 1 tablero. Mientras la capacidad carga, no bloqueamos (el
  // servidor enforce el límite real con un trigger; migración 027).
  const ownedCount = myProjects.filter(p => p.owner_id === authUser?.id).length;
  const isPremium = !!(capacity?.tier && capacity.tier !== 'free');
  const projectLimit = capacity?.total_max ?? null;
  const atLimit = projectLimit != null && ownedCount >= projectLimit;

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
      setErr(`Llegaste al límite de ${projectLimit} tablero${projectLimit === 1 ? '' : 's'} del plan ${capacity?.display_name || 'actual'}. Sube de plan para crear más.`);
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
      const isLimit = error?.code === 'P0001' || /l[ií]mite de .* tablero/i.test(msg);
      setErr(isLimit
        ? msg
        : isAuthNull
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
      setErr(`Llegaste al límite de ${projectLimit} tablero${projectLimit === 1 ? '' : 's'} del plan ${capacity?.display_name || 'actual'}. Sube de plan para crear más.`);
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
      <div style={{ width: "100%", maxWidth: (authUser && myProjects.length > 0) ? 920 : 460, transition: "max-width .3s ease" }}>
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
            {ownedCount >= 1 && (
              <div style={{ maxWidth: 460, margin: '0 auto 16px' }}>
                <button onClick={() => setShowConsolidated(true)} style={{ width: '100%', background: 'linear-gradient(135deg, rgba(20,156,172,0.22), rgba(84,44,156,0.22))', border: '1px solid rgba(20,156,172,0.4)', color: '#fff', borderRadius: 12, padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit' }}>
                  📊 Visión consolidada de mis tableros
                </button>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
              {myProjects.map(proj => {
                const isOwner = proj.owner_id === authUser.id;
                const inviter = ownerNames[proj.id];
                // Tablero invitado: acento teal + etiqueta de quién invitó, para
                // distinguirlo de los propios (acento naranja "PROPIETARIO").
                return (
                  <div key={proj.id}
                    onClick={() => { localStorage.setItem('pp_project_id', String(proj.id)); onProjectLoaded(proj); }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 28px rgba(0,0,0,0.35)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                    style={{
                      position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 120,
                      background: isOwner ? 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))' : 'linear-gradient(180deg, rgba(20,156,172,0.16), rgba(20,156,172,0.05))',
                      border: isOwner ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(20,156,172,0.45)',
                      borderLeft: isOwner ? '1px solid rgba(255,255,255,0.12)' : '3px solid #149cac',
                      borderRadius: 14, padding: '15px 16px', cursor: 'pointer',
                      transition: 'transform .15s ease, box-shadow .15s ease',
                    }}>
                    {isOwner && (
                      <button title="Borrar proyecto"
                        onClick={(e) => { e.stopPropagation(); setDeletingProject(proj); setDeleteConfirmText(''); setErr(''); }}
                        style={{ position: 'absolute', top: 10, right: 10, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.28)', borderRadius: 8, color: '#f87171', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                        🗑
                      </button>
                    )}
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#fff', lineHeight: 1.3, paddingRight: isOwner ? 34 : 0, marginBottom: proj.description ? 5 : 0 }}>{proj.name}</div>
                    {proj.description && (
                      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{proj.description}</div>
                    )}
                    <div style={{ marginTop: 'auto', paddingTop: 12 }}>
                      {isOwner ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, color: '#f5a623', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ec6c04' }} />Propietario
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(20,156,172,0.18)', border: '1px solid rgba(20,156,172,0.4)', borderRadius: 999, padding: '3px 9px' }}>
                          <span style={{ fontSize: 10 }}>👥</span>
                          <span style={{ fontSize: 10, color: '#4dd8e8', fontWeight: 700, letterSpacing: 0.3 }}>Invitado{inviter ? ` por ${inviter}` : ''}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ textAlign: 'center', margin: '18px 0 4px', fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>o crea o únete a otro proyecto</div>
          </div>
        ) : null)}

        {/* Compra de plan visible antes de crear un tablero */}
        {authUser && (
          <div style={{ maxWidth: 460, margin: '0 auto 18px' }}>
            <PlansLauncher variant="landing" />
          </div>
        )}

        {/* Card */}
        <div style={{ maxWidth: 460, margin: "0 auto", background: "rgba(255,255,255,0.05)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
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
                    Tableros creados: {ownedCount} / {projectLimit ?? '—'}
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
                        Tableros creados: {ownedCount} / {projectLimit ?? '—'}
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

      {showConsolidated && (
        <Suspense fallback={null}>
          <ConsolidatedDashboard
            authUser={authUser}
            onClose={() => setShowConsolidated(false)}
            onOpenProject={(proj) => { setShowConsolidated(false); localStorage.setItem('pp_project_id', String(proj.id)); onProjectLoaded(proj); }}
          />
        </Suspense>
      )}
    </div>
  );
}

// parseDeps vive ahora en ./lib/deps (importado arriba). DependenciesTab y
// computeDepLayout viven en ./features/deps/DependenciesTab (lazy). H-002.
// DependenciesTab + computeDepLayout viven ahora en
// ./features/deps/DependenciesTab y se cargan con React.lazy. H-002.

// ─── OKRsTab ───────────────────────────────────────────────
// OKRsTab vive ahora en ./features/okrs/OKRsTab y se carga con React.lazy
// (ver import arriba). H-002.

// ─── SprintsTab ────────────────────────────────────────────
// SprintsTab vive ahora en ./features/sprints/SprintsTab y se carga con
// React.lazy (ver import arriba). H-002.

// ─── PresentationTab (Presentación Sprint) ────────────────
// Vista enfocada en un participante. Por defecto usa el grafo de
// dependencias (mismo motor que Red de Tareas) para mostrar quién depende
// de quién y permitir al participante explicar su flujo. Al filtrar por
// persona, las tareas ajenas se ven en gris suave (sin resaltar pero
// identificables). Click en un nodo muestra el detalle rico (resumen,
// entregable, comentarios, subtareas, custom fields opt-in). También
// ofrece un modo "cuadrícula" para listas grandes.
// PresentationTab/PresentationGraph/StatCard viven ahora en
// ./features/presentation/PresentationTab y se cargan con React.lazy. H-002.

// PresentationCard + LinkedTaskChip viven ahora en
// ./features/presentation/PresentationCard (importado para SuperTaskExpanded). H-002.

// ─── SuperTaskJar ──────────────────────────────────────────
// Jarrón SVG llenándose según % de aporte cerrado. La franja superior
// muestra "gotas" de cada sprint que contribuye, cada una con su color.
// ─── SuperTaskJar ──────────────────────────────────────────
// SuperTaskJar/SuperTaskExpanded/SuperTasksTab viven ahora en
// ./features/tasks/SuperTasksTab y se cargan con React.lazy. H-002.
// SuperTasksTab extraído a ./features/tasks/SuperTasksTab (lazy). H-002.

// ─── SuperTaskCreatorModal ─────────────────────────────────
// SuperTaskCreatorModal vive ahora en ./features/tasks/SuperTaskCreatorModal y se
// carga con React.lazy (ver import arriba). H-002.

// ─── EvolutionTab (Evolutivo profesional) ─────────────────
// Solo accesible si project_can_use_evolutivo === true (Pro Power+ con IA
// activa). Owner ve histórico de evolutivos bimensuales, puede generar uno
// nuevo. Renderiza el HTML embebido en un iframe sandboxed para aislar
// estilos.
// EvolutionTab vive ahora en ./features/evolution/EvolutionTab y se carga con
// React.lazy (ver import arriba). H-002.

// ─── ChatEnterpriseTab ─────────────────────────────────────
// Chat en vivo del PO con la IA cargada con datos del equipo. Feature
// Enterprise. Cada proyecto tiene su propia sesión activa por owner.
// Persiste todo el historial en chat_messages.
// ChatEnterpriseTab vive ahora en ./features/chat/ChatEnterpriseTab y se carga
// con React.lazy (ver import arriba). H-002.

// ─── PendingRetrosBanner ───────────────────────────────────
// Bloqueo blando: si hay sprints cerrados con retro pendiente para este
// usuario, aparece un banner en Mi Día. Click → modal para responder.
// PendingRetrosBanner + SprintRetroForm (cluster retros, solo usado por FocusTab)
// viven ahora en ./features/focus/FocusTab. H-002.

// ─── TeamPulseTab ──────────────────────────────────────────
// Vista del owner: pulso del equipo sprint a sprint. Emojis dominantes,
// guerreros reconocidos, oportunidades, quienes la pasaron difícil, y un
// resumen textual agregado de lo que el equipo dijo. Anónimo en conteos.
function TeamPulseTab({ projectId, isOwner }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled || !projectId) return;
      // Verifica feature
      const { data: feat } = await supabase.rpc("project_has_feature", { p_project_id: projectId, p_feature: "team_pulse" });
      if (cancelled) return;
      if (feat !== true) {
        setError("Esta feature requiere plan Pro Solo o superior con IA activa en el proyecto.");
        setLoading(false);
        return;
      }
      const { data: pulse, error: pErr } = await supabase.rpc("team_pulse_for_project", { p_project_id: projectId });
      if (cancelled) return;
      if (pErr) setError(pErr.message);
      else setData(pulse || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando pulso del equipo…</div>;
  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
        <div style={{ fontSize: 56, marginBottom: 14 }}>🌡</div>
        <h3 style={{ margin: "0 0 8px 0", color: "#542c9c" }}>Pulso del equipo</h3>
        <p style={{ color: "#666", fontSize: 13, maxWidth: 500, margin: "0 auto" }}>{error}</p>
      </div>
    );
  }
  if (!isOwner) {
    return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Esta vista es solo para el owner del proyecto.</div>;
  }

  return (
    <div style={{ padding: 4 }}>
      <div style={{ background: "linear-gradient(135deg,#542c9c,#0aa0ab)", borderRadius: 12, padding: 20, marginBottom: 18, color: "#fff" }}>
        <h2 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 700 }}>🌡 Pulso del equipo</h2>
        <p style={{ margin: 0, opacity: 0.92, fontSize: 13 }}>
          Sentimiento sprint a sprint según lo que el propio equipo te cuenta. Las señalizaciones son anónimas: solo ves conteos agregados.
        </p>
      </div>

      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 14, color: "#555" }}>Aún no hay retrospectivas registradas.</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
            Cuando cierres un sprint o pasen 3 días desde su end_date, se abrirá la retro automáticamente y los participantes recibirán un correo.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {data.map(p => <SprintPulseCard key={p.period_id} pulse={p} />)}
        </div>
      )}
    </div>
  );
}

function SprintPulseCard({ pulse }) {
  const emojis = Object.entries(pulse.emoji_breakdown || {}).sort((a,b) => b[1] - a[1]);
  const warriors = Object.entries(pulse.strategic_warriors || {}).sort((a,b) => b[1] - a[1]);
  const giveMore = Object.entries(pulse.could_give_more || {}).sort((a,b) => b[1] - a[1]);
  const tough = Object.entries(pulse.had_it_tough || {}).sort((a,b) => b[1] - a[1]);

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 18, border: "1px solid #e0e0e0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#333" }}>{pulse.sprint_name}</div>
          <div style={{ fontSize: 11, color: "#888" }}>
            {pulse.start_date} → {pulse.end_date} · {pulse.total_respondents} respondieron · estado: {pulse.period_status}
          </div>
        </div>
        {emojis.length > 0 && (
          <div style={{ background: "#f5f5f7", padding: "6px 12px", borderRadius: 8, fontSize: 18 }}>
            {emojis.map(([e, c]) => <span key={e} title={`${c} votos`}>{e}<sub style={{ fontSize: 9, color: "#888", marginLeft: 1, marginRight: 5 }}>{c}</sub></span>)}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
        <PulseList title="🌟 Guerreros estratégicos" color="#27ae60" items={warriors} />
        <PulseList title="⚡ Podrían dar más" color="#ef7218" items={giveMore} />
        <PulseList title="💔 La pasaron difícil" color="#c0392b" items={tough} />
      </div>

      {(pulse.liked_aggregate || pulse.disliked_aggregate) && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "#542c9c", fontWeight: 600 }}>Ver respuestas textuales del equipo</summary>
          {pulse.liked_aggregate && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#27ae60", marginBottom: 4 }}>✨ Lo que les gustó:</div>
              <div style={{ background: "#f8fdf9", padding: 10, borderRadius: 6, fontSize: 12, color: "#333", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{pulse.liked_aggregate}</div>
            </div>
          )}
          {pulse.disliked_aggregate && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#e74c3c", marginBottom: 4 }}>⚠ Lo que no les gustó:</div>
              <div style={{ background: "#fdf8f8", padding: 10, borderRadius: 6, fontSize: 12, color: "#333", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{pulse.disliked_aggregate}</div>
            </div>
          )}
        </details>
      )}
    </div>
  );
}

function PulseList({ title, color, items }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 6 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 11, color: "#bbb", fontStyle: "italic" }}>(sin votos)</div>
      ) : items.slice(0, 5).map(([name, c]) => (
        <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", fontSize: 12, color: "#444" }}>
          <span style={{ background: color, color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{c}</span>
          <span>{name}</span>
        </div>
      ))}
    </div>
  );
}

// ─── FocusTab (Mi Día) ─────────────────────────────────────
// FocusTab vive ahora en ./features/focus/FocusTab y se carga con React.lazy. H-002.

// ─── Main App ──────────────────────────────────────────────

// Selector de tours guiados. Permite, después del onboarding automático, ver
// el onboarding de cualquier rol (PO / Scrum Master / Participante). onPick
// recibe el rol elegido (null = el tour del rol propio del usuario).
function TourMenu({ onPick }) {
  const [open, setOpen] = useState(false);
  const items = [
    { role: null, label: "Mi tour guiado" },
    { role: "po", label: "Tour de Product Owner" },
    { role: "scrum_master", label: "Tour de Scrum Master" },
    { role: "participant", label: "Tour de Participante" },
  ];
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} title="Ver tours guiados" style={{ background: "rgba(20,156,172,0.15)", border: "1px solid rgba(20,156,172,0.4)", color: "#4dd8e8", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "inherit" }}>
        🎓 Tour ▾
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 6, zIndex: 9999, minWidth: 210, boxShadow: "0 8px 28px rgba(0,0,0,0.5)" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, padding: "4px 8px 6px" }}>Ver onboarding</div>
            {items.map(it => (
              <button key={it.label} onClick={() => { setOpen(false); onPick(it.role); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", color: "rgba(255,255,255,0.85)", padding: "8px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Lanzador reutilizable de la pantalla de selección de planes + checkout de
// Mercado Pago. Se usa en el header (junto a notificaciones) y en el landing
// (antes de crear un tablero). Encapsula el estado del modal, el tier actual y
// el disparo del pago, para que la compra viva fuera de Configuración.
function PlansLauncher({ variant = "header" }) {
  const [open, setOpen] = useState(false);
  const [currentTier, setCurrentTier] = useState("free");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("user_ia_capacity").single().then(({ data }) => {
      if (!cancelled && data?.tier) setCurrentTier(data.tier);
    });
    return () => { cancelled = true; };
  }, [open]);

  const subscribe = async (tier) => {
    setBusy(true);
    try {
      const headers = await getAuthJsonHeaders();
      const res = await fetch("/api/mp-subscribe", { method: "POST", headers, body: JSON.stringify({ tier, referral_code: getReferralCode() }) });
      const data = await res.json();
      if (!res.ok || !data.init_point) throw new Error(data.error || `HTTP ${res.status}`);
      window.location.assign(data.init_point);
    } catch (err) {
      setBusy(false);
      alert("No se pudo iniciar el pago: " + err.message);
    }
  };

  const trigger = variant === "landing" ? (
    <button onClick={() => setOpen(true)} style={{
      width: "100%", background: "linear-gradient(135deg, #ec6c04, #149cac)", color: "#fff",
      border: "none", borderRadius: 12, padding: "14px 18px", cursor: "pointer",
      fontSize: 14, fontWeight: 700, boxShadow: "0 6px 18px rgba(236,108,4,0.3)",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "inherit",
    }}>
      ✨ Ver planes y desbloquear la IA
    </button>
  ) : (
    <button onClick={() => setOpen(true)} title="Ver planes y mejorar" style={{
      background: "linear-gradient(135deg, #ec6c04, #f5a623)", color: "#fff",
      border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer",
      fontSize: 12, fontWeight: 700, lineHeight: 1, boxShadow: "0 2px 10px rgba(236,108,4,0.35)",
      display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit",
    }}>
      ✨ Planes
    </button>
  );

  const referralCode = getReferralCode();

  return (
    <>
      {trigger}
      {open && (
        <Suspense fallback={null}>
          <PlanSelectionModal
            currentTier={currentTier}
            busy={busy}
            referralCode={referralCode}
            onSubscribe={(t) => { setOpen(false); subscribe(t); }}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

// Overlay de retorno de pago de Mercado Pago. MP redirige al usuario a
// `/?billing=return` (ver api/mp-subscribe.js). El webhook que activa la
// suscripción puede tardar unos segundos, así que sondeamos `user_ia_capacity`
// hasta que el tier deje de ser 'free' con status 'active'. Se monta una sola
// vez al tope de App y se autogestiona desde la URL.
function BillingReturnOverlay() {
  const [state, setState] = useState("hidden"); // hidden | checking | success | pending
  const [planName, setPlanName] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") !== "return") return;
    setState("checking");

    let cancelled = false;
    let tries = 0;
    const MAX_TRIES = 12;   // ~30 s en total
    const INTERVAL = 2500;

    const poll = async () => {
      if (cancelled) return;
      tries += 1;
      try {
        const { data } = await supabase.rpc("user_ia_capacity").single();
        if (cancelled) return;
        if (data && data.tier && data.tier !== "free" && data.status === "active") {
          setPlanName(data.display_name || data.tier);
          setState("success");
          return;
        }
      } catch (_) { /* sesión aún no lista o RPC transitoria: reintenta */ }
      if (tries >= MAX_TRIES) { setState("pending"); return; }
      setTimeout(poll, INTERVAL);
    };
    poll();

    return () => { cancelled = true; };
  }, []);

  if (state === "hidden") return null;

  const close = () => {
    // Limpia ?billing=return y recarga para refrescar capacidad/plan en la app.
    window.history.replaceState({}, "", window.location.pathname);
    window.location.reload();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100000,
      background: "rgba(5,5,15,0.92)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        maxWidth: 440, width: "100%", background: "#12121f",
        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
        padding: "36px 32px", textAlign: "center", color: "#fff",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }}>
        {state === "checking" && (
          <>
            <div style={{ fontSize: 13, letterSpacing: 4, textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 18 }}>
              Mercado Pago
            </div>
            <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>Confirmando tu pago…</div>
            <div style={{ width: 200, height: 2, background: "rgba(255,255,255,0.1)", borderRadius: 1, overflow: "hidden", margin: "20px auto 0" }}>
              <div style={{ height: "100%", background: "linear-gradient(90deg, #ec6c04, #149cac)", borderRadius: 1, animation: "expandLine 1.5s ease infinite alternate" }} />
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 18 }}>
              Esto puede tardar unos segundos. No cierres esta ventana.
            </div>
          </>
        )}

        {state === "success" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>¡Suscripción activada!</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
              Tu plan <strong style={{ color: "#fff" }}>{planName}</strong> ya está activo. Ya puedes activar la IA en tus proyectos.
            </div>
            <button onClick={close} style={{
              marginTop: 24, padding: "11px 28px", border: "none", borderRadius: 10,
              background: "linear-gradient(135deg, #ec6c04, #149cac)", color: "#fff",
              fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}>Continuar</button>
          </>
        )}

        {state === "pending" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 8 }}>⏳</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Tu pago se está procesando</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
              Mercado Pago aún no confirma el cobro. Suele reflejarse en unos minutos,
              <strong style={{ color: "#fff" }}> no necesitas pagar de nuevo</strong>. Tu plan aparecerá en Configuración cuando se confirme.
            </div>
            <button onClick={close} style={{
              marginTop: 24, padding: "11px 28px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10,
              background: "transparent", color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer",
            }}>Entendido</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  // Captura ?ref= de la URL al montar y lo persiste en localStorage.
  useReferralCapture();

  const [activeTab, setActiveTab] = useState("board");
  const [forceTour, setForceTour] = useState(false);
  const [forceTourRole, setForceTourRole] = useState(null); // rol elegido en el selector de tours (null = mi rol)
  // myRole: rol del usuario en el proyecto actual (po / scrum_master / participant).
  // null mientras carga o si no es miembro. Usado para gating de tabs en Fase B.
  const [myRole, setMyRole] = useState(null);
  const [showIntro, setShowIntro] = useState(true);
  const [authUser, setAuthUser] = useState(null);

  // Sync proactivo: si el usuario ya tiene sesión y hay ?ref= en localStorage,
  // lo envía al backend sin esperar a que haga click en "Suscribirse".
  useReferralSync(authUser);
  const [showAuth, setShowAuth] = useState(false);
  const [activeUser, setActiveUser] = useState(null);
  const [showProjectLanding, setShowProjectLanding] = useState(false);
  const [depEditTask, setDepEditTask] = useState(null);

  // Todos los datos del proyecto (estado + carga masiva + realtime + CRUD/saves)
  // viven en useProjectData, que compone los hooks de dominio y posee el spine.
  // App solo orquesta auth/UI. H-002 fase D — consolidación.
  const {
    projectId, setProjectId,
    project, setProject,
    currentUserId, setCurrentUserId,
    loading, setLoading,
    okrs, setOkrs,
    keyResults, setKeyResults,
    sprints, setSprints,
    participants, setParticipants,
    indicators,
    taskTypes,
    dimensions,
    saveParticipants, saveIndicators, saveTaskTypes, saveDimensions, saveProjectPin,
    taskFieldDefs,
    addTaskFieldDef, updateTaskFieldDefById, deleteTaskFieldDef, reorderTaskFieldDefs,
    tasks, setTasks, nextId,
    createTask, updateTask, deleteTask, exportCSV,
    loadAllForProject,
  } = useProjectData({ activeUser, setActiveUser });
  // Presencia en tiempo real (activos, expulsión, conflicto de sesión) vive en
  // usePresence. App conserva activeUser; currentUserId lo provee useProjectData. H-002 fase D.
  const {
    activeUsers,
    kickedMsg, setKickedMsg,
    conflictUser, setConflictUser,
    handleForceEntry, handleChangeUser,
  } = usePresence({ projectId, activeUser, setActiveUser, setCurrentUserId });
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  // Carga el rol del usuario para el proyecto activo (Fase B onboarding).
  // Se dispara cuando cambia projectId o authUser. El owner ignora myRole y
  // ve todo igual; pero igual lo cargamos para usarlo desde el Onboarding.
  useEffect(() => {
    if (!projectId || !authUser?.id) { setMyRole(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("my_role_in_project", { p_project_id: projectId });
      if (!cancelled) setMyRole(typeof data === "string" ? data : null);
    })();
    return () => { cancelled = true; };
  }, [projectId, authUser?.id]);

  const [dismissedNotifs, setDismissedNotifs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pp_dismissed_notifs') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    // Evita rutear dos veces (init + SIGNED_IN pueden coincidir).
    let routed = false;

    // Rutea al usuario tras autenticarse: invitación ?join, proyecto guardado o
    // pantalla de selección. Compartido por init() y por el retorno del link
    // mágico (onAuthStateChange SIGNED_IN).
    const routeAfterAuth = async (user) => {
      setAuthUser(user);
      setShowAuth(false); setShowIntro(false);

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

    const init = async () => {
      // 1. Check Supabase auth session (espera la inicialización de supabase-js,
      // incluida la detección del token del link mágico en la URL).
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        // showIntro will lead to showAuth after animation
        return;
      }
      routed = true;
      await routeAfterAuth(session.user);
    };

    init();

    // Auth state subscription
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setAuthUser(null); setActiveUser(null); setProject(null);
        setProjectId(null); setTasks([]); setParticipants([]);
        setShowAuth(true); setShowIntro(true); setShowProjectLanding(false);
        setLoading(false);
        routed = false;
      } else if (event === 'SIGNED_IN' && session?.user && !routed) {
        // Retorno del link mágico: la sesión entró después de init().
        routed = true;
        routeAfterAuth(session.user);
      }
    });
    return () => subscription.unsubscribe();
    // Initialization must run once; subsequent project changes are handled explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Todo el estado/CRUD de datos del proyecto, la carga masiva (loadAllForProject)
  // y el canal realtime viven en useProjectData (que compone useTasks /
  // useProjectConfig / useTaskFieldDefs). La presencia vive en usePresence.
  // App solo orquesta auth/UI + render. H-002 fase D — consolidación.

  const currentUser = useMemo(() => participants.find((p) => p.id === currentUserId) || null, [participants, currentUserId]);

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

  // Tabs visibles por rol (Fase B del onboarding). Owner ve TODO (es el
  // dueño del proyecto, incluida Configuración). Los demás roles solo ven
  // las pestañas que tienen sentido para su trabajo. Si el rol asignado no
  // está en allowedRoles, esa tab no se renderiza.
  const TABS_ALL = [
    { id: "board",        label: "Tablero",              allowedRoles: ["po","scrum_master","participant"] },
    { id: "gantt",        label: "Gantt",                allowedRoles: ["participant"] },
    { id: "metrics",      label: "Métricas",             allowedRoles: ["po"] },
    { id: "deps",         label: "Red de Tareas",        allowedRoles: ["po","scrum_master","participant"] },
    { id: "okrs",         label: "OKRs",                 allowedRoles: ["po","scrum_master"] },
    { id: "sprints",      label: "Sprints",              allowedRoles: ["scrum_master"] },
    { id: "supertasks",   label: "Super-tareas",         allowedRoles: ["po","scrum_master","participant"] },
    { id: "focus",        label: "Mi Día",               allowedRoles: ["po","scrum_master","participant"] },
    { id: "presentation", label: "Presentación",         allowedRoles: ["po","scrum_master"] },
    { id: "evolution",    label: "Evolutivo 💎",         allowedRoles: ["po"] },
    { id: "chat",         label: "Chat IA 🤖",            allowedRoles: ["po"] },
    { id: "pulse",        label: "Pulso del equipo 🌡",  allowedRoles: ["po","scrum_master"] },
    { id: "config",       label: "Configuración",        allowedRoles: [] },  // solo owner
  ];

  const isOwnerOfProject = project?.owner_id && authUser?.id && project.owner_id === authUser.id;
  // Mientras myRole no haya cargado para un no-owner, defaultea a 'participant'
  // (más restrictivo) para evitar parpadeos de tabs que el usuario no debería ver.
  const effectiveRole = isOwnerOfProject ? 'po' : (myRole || 'participant');
  const TABS = TABS_ALL.filter(t => isOwnerOfProject || t.allowedRoles.includes(effectiveRole));

  // Si la tab activa dejó de ser visible (cambió el rol o el owner), salta a la primera disponible.
  useEffect(() => {
    if (!TABS.length) return;
    if (!TABS.find(t => t.id === activeTab)) setActiveTab(TABS[0].id);
  }, [TABS.length, activeTab]);

  // ── Tabs responsivos: si la fila no cabe, colapsa a menú hamburguesa ──
  // No usamos un breakpoint fijo de media query porque el nº de tabs varía por
  // rol (owner ~14, participante ~5): medimos el desbordamiento real con un
  // ResizeObserver. Mientras está expandida guardamos el ancho que necesita la
  // fila (tabsNeedWidthRef); cuando está colapsada, re-expandimos si vuelve a caber.
  const tabsWrapRef = useRef(null);
  const tabsRowRef = useRef(null);
  const tabsNeedWidthRef = useRef(0);
  const TABS_WRAP_PADDING = 40; // padding horizontal del contenedor (20px + 20px)
  const [tabsCollapsed, setTabsCollapsed] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);

  // Ref que espeja tabsCollapsed para que el callback del ResizeObserver lo lea
  // sin necesitar tabsCollapsed como dependencia del effect (evita reconexión del RO
  // en cada colapso/expansión → fix R-01: loop del ResizeObserver).
  const tabsCollapsedRef = useRef(false);
  useEffect(() => { tabsCollapsedRef.current = tabsCollapsed; }, [tabsCollapsed]);

  // Ref para el requestAnimationFrame pendiente; lo cancelamos si llega una nueva
  // medición antes de que se ejecute el frame anterior.
  const tabsRafRef = useRef(null);

  useEffect(() => {
    const wrap = tabsWrapRef.current;
    if (!wrap) return;
    const measure = () => {
      // Cancelamos el frame previo en vuelo para no acumular setState redundantes.
      if (tabsRafRef.current !== null) cancelAnimationFrame(tabsRafRef.current);
      tabsRafRef.current = requestAnimationFrame(() => {
        tabsRafRef.current = null;
        const avail = wrap.clientWidth - TABS_WRAP_PADDING;
        const row = tabsRowRef.current;
        if (row) {
          // Expandida: guardamos el ancho real y colapsamos solo si desborda.
          // Siempre actualizamos needWidth mientras la fila está montada, para
          // que el valor nunca quede stale cuando se desmonte (fix R-02 parcial).
          tabsNeedWidthRef.current = row.scrollWidth;
          if (row.scrollWidth > avail + 1 && !tabsCollapsedRef.current) {
            setTabsCollapsed(true);
            tabsCollapsedRef.current = true;
          }
        } else {
          // Colapsada: re-expandimos solo si hay espacio (histéresis 8 px) Y el
          // ancho necesario ya fue medido al menos una vez (needWidth > 0).
          // Sin la segunda condición, si la página cargó ya angosta (needWidth===0
          // porque la fila nunca se montó), avail >= 0+8 sería siempre true → flip
          // inmediato (fix R-02: stale needWidth en primer render estrecho).
          if (
            tabsNeedWidthRef.current > 0 &&
            avail >= tabsNeedWidthRef.current + 8 &&
            tabsCollapsedRef.current
          ) {
            setTabsCollapsed(false);
            setTabMenuOpen(false);
            tabsCollapsedRef.current = false;
          }
        }
      });
    };
    measure();
    // El RO solo se reconecta cuando cambia TABS.length (rol distinto), NO con cada
    // colapso/expansión. tabsCollapsed se lee a través de tabsCollapsedRef.
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      if (tabsRafRef.current !== null) cancelAnimationFrame(tabsRafRef.current);
    };
  }, [TABS.length]);

  const activeTabLabel = TABS.find(t => t.id === activeTab)?.label || "Menú";

  return (
    <>
      <BillingReturnOverlay />

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
        <AuthScreen />
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
          <>
            <TourMenu onPick={(r) => { setForceTourRole(r); setForceTour(true); }} />
            <button onClick={() => supabase.auth.signOut()} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"rgba(255,255,255,0.4)", borderRadius:6, padding:"3px 10px", cursor:"pointer", fontSize:10, fontWeight:500 }}>
              Salir
            </button>
          </>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {/* Resumen del tablero activo (pastilla) */}
          {authUser && projectId && <BoardSummaryPill projectId={projectId} projectName={project?.name} />}
          {/* Planes / mejorar (a la izquierda de las notificaciones) */}
          {authUser && <PlansLauncher variant="header" />}
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

      <div ref={tabsWrapRef} style={{ background: "#ffffff", borderBottom: "1px solid #e8e0f4", padding: "0 20px", boxShadow: "0 2px 8px rgba(84,44,156,0.06)", position: "relative" }}>
        {tabsCollapsed ? (
          // ── Colapsado: botón hamburguesa + dropdown vertical ──
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setTabMenuOpen(o => !o)}
              aria-label="Abrir menú de secciones"
              aria-expanded={tabMenuOpen}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "none", border: "none", cursor: "pointer",
                padding: "11px 4px", fontSize: 14, fontWeight: 700, color: "#542c9c",
                fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>☰</span>
              <span>{activeTabLabel}</span>
              <span style={{ fontSize: 10, color: "#969696", transform: tabMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
            </button>
            {tabMenuOpen && (
              <>
                {/* overlay para cerrar al hacer clic fuera */}
                <div onClick={() => setTabMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 61,
                  background: "#fff", border: "1px solid #e8e0f4", borderRadius: 12,
                  boxShadow: "0 8px 28px rgba(84,44,156,0.18)", padding: 6,
                  minWidth: 220, maxHeight: "70vh", overflowY: "auto",
                }}>
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      data-tour={`tab-${tab.id}`}
                      onClick={() => { setActiveTab(tab.id); setTabMenuOpen(false); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        background: activeTab === tab.id ? "#f3eefc" : "none", border: "none",
                        borderLeft: activeTab === tab.id ? "3px solid #542c9c" : "3px solid transparent",
                        color: activeTab === tab.id ? "#542c9c" : "#555",
                        padding: "10px 14px", cursor: "pointer", fontSize: 13.5,
                        fontWeight: activeTab === tab.id ? 700 : 500,
                        borderRadius: 8, fontFamily: "inherit",
                      }}
                    >{tab.label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          // ── Expandido: fila horizontal de tabs (comportamiento original) ──
          <div ref={tabsRowRef} style={{ display: "flex", gap: 0 }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                data-tour={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: "none", border: "none", whiteSpace: "nowrap",
                  borderBottom: activeTab === tab.id ? "2.5px solid #542c9c" : "2.5px solid transparent",
                  color: activeTab === tab.id ? "#542c9c" : "#888888",
                  padding: "11px 18px", cursor: "pointer", fontSize: 13,
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  transition: "all 0.15s", fontFamily: "inherit",
                }}
              >{tab.label}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "20px 20px 40px" }}>
        {activeTab === "board" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <BoardTab tasks={tasks} createTask={createTask} updateTask={updateTask} deleteTask={deleteTask} participants={participants} indicators={indicators} currentUser={currentUser} taskTypes={taskTypes} weights={dimensions} dimensions={dimensions} editTaskFromDep={depEditTask} onDepEditDone={() => setDepEditTask(null)} projectId={projectId} nextId={nextId} keyResults={keyResults} sprints={sprints} taskFieldDefs={taskFieldDefs} />
          </Suspense>
        )}
        {activeTab === "gantt" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <GanttTab tasks={tasks} participants={participants} indicators={indicators} taskTypes={taskTypes} />
          </Suspense>
        )}
        {activeTab === "metrics" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <MetricsTab tasks={tasks} participants={participants} taskTypes={taskTypes} />
          </Suspense>
        )}
        {activeTab === "deps" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <DependenciesTab
              tasks={tasks}
              onEditTask={(t) => { setDepEditTask(t); setActiveTab("board"); }}
              sprints={sprints}
            />
          </Suspense>
        )}
        {activeTab === "okrs" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <OKRsTab projectId={projectId} okrs={okrs} setOkrs={setOkrs} keyResults={keyResults} setKeyResults={setKeyResults} tasks={tasks} />
          </Suspense>
        )}
        {activeTab === "sprints" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <SprintsTab projectId={projectId} sprints={sprints} setSprints={setSprints} tasks={tasks} />
          </Suspense>
        )}
        {activeTab === "focus" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <FocusTab tasks={tasks} activeUser={activeUser} updateTask={updateTask} dimensions={dimensions} />
          </Suspense>
        )}
        {activeTab === "supertasks" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <SuperTasksTab
              projectId={projectId}
              tasks={tasks}
              participants={participants}
              sprints={sprints}
              taskFieldDefs={taskFieldDefs}
              isOwner={project?.owner_id === authUser?.id}
            />
          </Suspense>
        )}
        {activeTab === "presentation" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <PresentationTab
              tasks={tasks}
              participants={participants}
              taskFieldDefs={taskFieldDefs}
              sprints={sprints}
            />
          </Suspense>
        )}
        {activeTab === "evolution" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <EvolutionTab projectId={projectId} isOwner={project?.owner_id === authUser?.id} />
          </Suspense>
        )}
        {activeTab === "chat" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <ChatEnterpriseTab projectId={projectId} isOwner={project?.owner_id === authUser?.id} />
          </Suspense>
        )}
        {activeTab === "pulse" && (
          <TeamPulseTab projectId={projectId} isOwner={project?.owner_id === authUser?.id} sprints={sprints} participants={participants} />
        )}
        {activeTab === "config" && (() => {
          const isOwner = project?.owner_id === authUser?.id;
          return isOwner ? (
            <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
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
            </Suspense>
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
        <span style={{ fontSize: 10, color: "#969696", fontWeight: 400, letterSpacing: "0.03em" }}>Desarrollado por Soft a tu medida</span>
        <span style={{ fontSize: 9, color: "#b0b0b0", letterSpacing: "0.05em" }}>Productivity-Plus v{APP_VERSION}</span>
      </div>
    </div>
      </div>

      {/* Captura del nombre completo al primer login global. Si el usuario
          ya tiene full_name en user_metadata, no aparece. Se monta arriba
          de todo (z-index 100001) para bloquear el resto de la app. */}
      <NameCaptureModal
        supabase={supabase}
        authUser={authUser}
        onComplete={async () => {
          const { data } = await supabase.auth.getUser();
          if (data?.user) setAuthUser(data.user);
        }}
      />

      {/* Onboarding: modal de bienvenida en primer login + tour spotlight.
          Estado persistido en public.user_onboarding (migración 024).
          enabled=false mientras el landing de proyecto o el spinner están
          activos: los tabs del fondo no son visibles ni interactivos. */}
      <Onboarding
        supabase={supabase}
        authUser={authUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        forceOpen={forceTour}
        forceRole={forceTourRole}
        onForceHandled={() => { setForceTour(false); setForceTourRole(null); }}
        enabled={!showProjectLanding && !loading && !!projectId}
        projectId={projectId}
        isOwner={isOwnerOfProject}
      />
    </>
  );
}
