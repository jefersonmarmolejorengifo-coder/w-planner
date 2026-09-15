import { useState, useEffect, useRef } from "react";
import { supabase } from '../supabaseClient';
import { OTP_LENGTH, OTP_TTL_MINUTES, RESEND_COOLDOWN_SECONDS, normalizeEmail, isValidEmail, normalizeOtpInput, authErrorMessage, remainingSeconds } from '../lib/otp';

// ─── AuthScreen ───────────────────────────────────────────
// Inicio de sesión por CÓDIGO DE ACCESO (passwordless). El usuario escribe su
// correo, recibe un código de OTP_LENGTH dígitos y lo escribe en esta misma
// pantalla. Ya no hay enlace que abrir: el correo llevaba un link antes, pero
// los filtros corporativos (Microsoft 365 Safe Links y similares) lo abrían
// solos y gastaban el token antes de que la persona hiciera clic (ver
// src/lib/otp.js). verifyOtp({ type: 'email' }) sirve tanto para el primer
// registro como para logins siguientes (shouldCreateUser:true en el envío).
// Tras verificar, supabase-js emite SIGNED_IN y App (ProductivityPlus.jsx) lo
// enruta solo: esta pantalla NO navega, no recarga y no toca la URL.
export default function AuthScreen() {
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false); // true tras un verifyOtp exitoso: solo cambia el texto del botón mientras App desmonta la pantalla
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const verifyingRef = useRef(false);
  const sendingRef = useRef(false);
  const codeInputRef = useRef(null);
  const cooldownIntervalRef = useRef(null);
  const cooldownEndAtRef = useRef(0); // timestamp (ms) al que se habilita el reenvío; 0 = sin cooldown activo

  useEffect(() => () => {
    if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
  }, []);

  // La pestaña puede quedar en segundo plano mientras la persona va a buscar
  // el código a su correo: los navegadores congelan los timers ahí, así que
  // el setInterval del cooldown se atrasa. Al volver a primer plano
  // recalculamos de una vez contra la hora de fin absoluta, en vez de
  // esperar a que el intervalo "se ponga al día" tick a tick.
  useEffect(() => {
    const recalcular = () => {
      if (document.visibilityState === 'visible' && cooldownEndAtRef.current) {
        setCooldown(remainingSeconds(cooldownEndAtRef.current, Date.now()));
      }
    };
    document.addEventListener('visibilitychange', recalcular);
    return () => document.removeEventListener('visibilitychange', recalcular);
  }, []);

  // Devuelve el foco al input del código cuando termina un intento fallido.
  // No basta con llamar codeInputRef.current?.focus() justo tras setError():
  // ese focus() corre en el mismo tick que el setState, antes de que React
  // vuelva a habilitar el input, así que el navegador lo ignora.
  useEffect(() => {
    if (step === 'code' && !loading && error) codeInputRef.current?.focus();
  }, [step, loading, error]);

  const inp = { background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", borderRadius: 8, padding: "13px 14px", fontSize: 15, outline: "none", fontFamily: "inherit", color: "#fff", width: "100%", boxSizing: "border-box", transition: "border-color 0.2s" };
  const lbl = { fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 };

  const arrancarCooldown = () => {
    if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
    const finDeEspera = Date.now() + RESEND_COOLDOWN_SECONDS * 1000;
    cooldownEndAtRef.current = finDeEspera;
    setCooldown(remainingSeconds(finDeEspera, Date.now()));
    cooldownIntervalRef.current = setInterval(() => {
      const restante = remainingSeconds(cooldownEndAtRef.current, Date.now());
      setCooldown(restante);
      if (restante <= 0) { clearInterval(cooldownIntervalRef.current); cooldownIntervalRef.current = null; cooldownEndAtRef.current = 0; }
    }, 1000);
  };

  const enviarCodigo = async ({ mostrarComoReenvio = false } = {}) => {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) { setError("Escribe un correo válido."); return false; }
    // Candado síncrono: un doble clic/doble Enter muy rápido llega antes de
    // que el re-render deshabilite el botón (setLoading es asíncrono), así
    // que sin esto se disparan dos signInWithOtp para el mismo correo.
    if (sendingRef.current) return false;
    sendingRef.current = true;
    setLoading(true); setError('');
    const { error: err } = await supabase.auth.signInWithOtp({
      email: mail,
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    sendingRef.current = false;
    if (err) {
      console.error('[AuthScreen] signInWithOtp', err);
      setError(authErrorMessage(err, 'send'));
      return false;
    }
    arrancarCooldown();
    setNotice(mostrarComoReenvio ? 'Te enviamos un código nuevo. Usa el más reciente.' : '');
    return true;
  };

  const handleSubmitEmail = async (e) => {
    e.preventDefault();
    const ok = await enviarCodigo();
    if (ok) { setCode(''); setStep('code'); }
  };

  const irADigitarCodigo = () => {
    const mail = normalizeEmail(email);
    if (!isValidEmail(mail)) { setError("Escribe un correo válido."); return; }
    setError(''); setNotice(''); setCode(''); setStep('code');
  };

  const verificarCodigo = async (valor) => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setLoading(true); setError('');
    const { error: err } = await supabase.auth.verifyOtp({
      email: normalizeEmail(email),
      token: valor,
      type: 'email',
    });
    if (err) {
      console.error('[AuthScreen] verifyOtp', err);
      setLoading(false);
      verifyingRef.current = false;
      setError(authErrorMessage(err, 'verify'));
      setCode('');
      // El foco vuelve al input desde el useEffect de arriba: hacerlo aquí
      // mismo llega antes de que React quite el readOnly y el navegador lo
      // ignora.
      return;
    }
    // Éxito: dejamos el botón en "Entrando…" y no tocamos nada más. App
    // (ProductivityPlus.jsx) recibe el SIGNED_IN y desmonta esta pantalla.
    setVerified(true);
  };

  const handleSubmitCode = (e) => {
    e.preventDefault();
    if (code.length !== OTP_LENGTH || loading) return;
    verificarCodigo(code);
  };

  const handleCodeChange = (e) => {
    const limpio = normalizeOtpInput(e.target.value);
    setCode(limpio);
    if (limpio.length === OTP_LENGTH) verificarCodigo(limpio);
  };

  const reenviar = async () => {
    if (cooldown > 0 || loading) return;
    await enviarCodigo({ mostrarComoReenvio: true });
  };

  const usarOtroCorreo = () => {
    setStep('email'); setCode(''); setError(''); setNotice(''); setVerified(false);
    if (cooldownIntervalRef.current) { clearInterval(cooldownIntervalRef.current); cooldownIntervalRef.current = null; }
    cooldownEndAtRef.current = 0;
    setCooldown(0);
  };

  const mailMostrado = normalizeEmail(email);

  return (
    <div style={{ position: "fixed", inset: 0, background: "linear-gradient(160deg,#0d0d1a 0%,#1a1a2e 50%,#2d1b4e 100%)", display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: 9998, padding: 20, overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 420, margin: "auto" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 72, fontWeight: 900, background: "linear-gradient(135deg,#ec6c04,#f5a623,#149cac)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1, letterSpacing: -3 }}>P+</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 5, textTransform: "uppercase", marginTop: 6 }}>Productivity-Plus</div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.05)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
          {step === 'code' ? (
            <form onSubmit={handleSubmitCode} style={{ textAlign: "center" }}>
              <div aria-hidden="true" style={{ fontSize: 44, marginBottom: 10 }}>📬</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 8 }}>Revisa tu correo</div>
              <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.6, marginBottom: 4 }}>
                Escribe el código de {OTP_LENGTH} dígitos que enviamos a<br />
                <b style={{ color: "#fff" }}>{mailMostrado}</b>.<br />
                Vence en {OTP_TTL_MINUTES} minutos.
              </div>
              <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)", marginBottom: 18 }}>
                ¿No lo ves? Revisa la carpeta de spam o correo no deseado.
              </div>

              <label htmlFor="auth-code" style={{ ...lbl, textAlign: "left" }}>Código de acceso</label>
              <input
                id="auth-code"
                ref={codeInputRef}
                style={{ ...inp, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 28, textAlign: "center", letterSpacing: "0.35em", padding: "14px 10px" }}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                value={code}
                onChange={handleCodeChange}
                placeholder={"•".repeat(OTP_LENGTH)}
                autoFocus
                readOnly={loading}
              />

              {error && <div role="alert" style={{ fontSize: 12, color: "#f87171", fontWeight: 500, marginTop: 10 }}>{error}</div>}
              {!error && notice && <div aria-live="polite" style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 500, marginTop: 10 }}>{notice}</div>}

              <button type="submit" className="pp-auth-primary" disabled={loading || code.length !== OTP_LENGTH}
                style={{ background: (loading || code.length !== OTP_LENGTH) ? "#555" : "linear-gradient(135deg,#bf5803,#a94d02)", color: "#fff", border: "none", borderRadius: 10, padding: "13px", cursor: (loading || code.length !== OTP_LENGTH) ? "default" : "pointer", fontWeight: 700, fontSize: 14, width: "100%", boxShadow: (loading || code.length !== OTP_LENGTH) ? "none" : "0 4px 20px rgba(191,88,3,0.4)", marginTop: 16, fontFamily: "inherit" }}>
                {verified ? "Entrando…" : loading ? "Verificando…" : "Entrar →"}
              </button>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, gap: 10 }}>
                <button type="button" onClick={usarOtroCorreo}
                  style={{ background: "transparent", color: "rgba(255,255,255,0.5)", border: "none", padding: "10px 6px", minHeight: 40, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", textDecoration: "underline" }}>
                  Usar otro correo
                </button>
                <button type="button" onClick={reenviar} disabled={cooldown > 0 || loading}
                  style={{ background: "transparent", color: (cooldown > 0 || loading) ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.7)", border: "none", padding: "10px 6px", minHeight: 40, cursor: (cooldown > 0 || loading) ? "default" : "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", textDecoration: cooldown > 0 ? "none" : "underline" }}>
                  {cooldown > 0 ? `Reenviar en ${cooldown} s` : "Reenviar código"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmitEmail} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", marginBottom: 6 }}>Entra con tu correo</div>
                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                  Te enviamos un código de {OTP_LENGTH} dígitos para entrar, sin contraseña. Si es tu primera vez, tu cuenta se crea sola.
                </div>
              </div>
              <div>
                <label htmlFor="auth-email" style={lbl}>Correo electrónico</label>
                <input id="auth-email" style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" autoFocus disabled={loading} />
              </div>
              {error && <div role="alert" style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{error}</div>}
              <button type="submit" className="pp-auth-primary" disabled={loading}
                style={{ background: loading ? "#555" : "linear-gradient(135deg,#bf5803,#a94d02)", color: "#fff", border: "none", borderRadius: 10, padding: "13px", cursor: loading ? "default" : "pointer", fontWeight: 700, fontSize: 14, width: "100%", boxShadow: loading ? "none" : "0 4px 20px rgba(191,88,3,0.4)", marginTop: 4, fontFamily: "inherit" }}>
                {loading ? "Enviando código…" : "Enviarme el código →"}
              </button>
              <button type="button" onClick={irADigitarCodigo}
                style={{ background: "transparent", color: "rgba(255,255,255,0.5)", border: "none", padding: "10px 6px", minHeight: 40, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", textDecoration: "underline", textAlign: "center" }}>
                ¿Ya tienes un código?
              </button>
            </form>
          )}
        </div>
        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: 2 }}>PRODUCTIVITY-PLUS · GESTIÓN ESTRATÉGICA</div>
      </div>
    </div>
  );
}
