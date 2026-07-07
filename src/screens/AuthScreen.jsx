import { useState } from "react";
import { supabase } from '../supabaseClient';

// ─── AuthScreen ───────────────────────────────────────────
// Inicio de sesión por LINK MÁGICO (passwordless). El usuario escribe su correo
// y recibe un enlace; al abrirlo vuelve a la app y la sesión entra sola (la
// detecta supabase-js en la URL y App la rutea en onAuthStateChange SIGNED_IN).
// shouldCreateUser:true → mismo flujo sirve para entrar y para registrarse. El
// nombre se captura después con NameCaptureModal al primer login.
export default function AuthScreen() {
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
        emailRedirectTo: window.location.origin + '/app' + window.location.search,
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
                <label htmlFor="auth-email" style={lbl}>Correo electrónico</label>
                <input id="auth-email" style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && sendLink()} placeholder="tu@correo.com" autoFocus />
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
