/**
 * Toast.jsx — Sistema de notificaciones no bloqueantes (U-01 / R-11).
 *
 * API pública:
 *   <ToastProvider>…</ToastProvider>   — envuelve el árbol en main.jsx
 *   const toast = useToast()            — hook para disparar toasts
 *   toast(mensaje, { type })            — type: 'info' | 'success' | 'error'  (default 'info')
 *
 * Accesibilidad:
 *   - Contenedor con role="status" aria-live="polite" para info/success
 *   - role="alert" aria-live="assertive" para error (interrupción inmediata)
 *   - Botón de cierre con aria-label descriptivo
 *   - Auto-dismiss 4 s (error: 6 s para que el lector de pantalla lo alcance)
 *
 * z-index: 200000 — por encima de los modales de la app (máx ~100003)
 */

import { createContext, useCallback, useContext, useRef, useState } from "react";

// ─── Contexto ────────────────────────────────────────────────────────────────

const ToastContext = createContext(null);

// ─── Constantes de diseño ────────────────────────────────────────────────────

const COLORS = {
  info:    { bg: "#149cac", border: "#0f7a87", icon: "ℹ" },
  success: { bg: "#2e7d32", border: "#1b5e20", icon: "✓" },
  error:   { bg: "#c0392b", border: "#922b21", icon: "✕" },
};

const AUTO_DISMISS = { info: 4000, success: 4000, error: 6000 };

// ─── ToastItem ───────────────────────────────────────────────────────────────

function ToastItem({ id, message, type, onRemove }) {
  const c = COLORS[type] || COLORS.info;

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      aria-live={type === "error" ? "assertive" : "polite"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        background: c.bg,
        border: `1.5px solid ${c.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        color: "#fff",
        fontSize: 13,
        fontFamily: "inherit",
        boxShadow: "0 4px 18px rgba(0,0,0,0.22)",
        maxWidth: 360,
        width: "max-content",
        wordBreak: "break-word",
        animation: "toast-in 0.22s cubic-bezier(0.22,1,0.36,1)",
        pointerEvents: "auto",
      }}
    >
      {/* Icono */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          fontWeight: 700,
          fontSize: 14,
          lineHeight: "19px",
          opacity: 0.9,
        }}
      >
        {c.icon}
      </span>

      {/* Mensaje */}
      <span style={{ flex: 1, lineHeight: 1.45 }}>{message}</span>

      {/* Cerrar */}
      <button
        onClick={() => onRemove(id)}
        aria-label="Cerrar notificación"
        style={{
          flexShrink: 0,
          background: "rgba(255,255,255,0.18)",
          border: "none",
          borderRadius: 6,
          color: "#fff",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1,
          padding: "2px 6px",
          marginLeft: 4,
          fontFamily: "inherit",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.3)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.18)"; }}
      >
        ×
      </button>
    </div>
  );
}

// ─── ToastProvider ────────────────────────────────────────────────────────────

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const counter = useRef(0);

  const remove = useCallback((id) => {
    setItems(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message, { type = "info" } = {}) => {
    const id = ++counter.current;
    setItems(prev => [...prev, { id, message, type }]);
    const delay = AUTO_DISMISS[type] ?? 4000;
    setTimeout(() => remove(id), delay);
  }, [remove]);

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Keyframe declarado inline una sola vez */}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1);    }
        }
      `}</style>

      {/* Contenedor fijo — abajo-derecha, apilable */}
      <div
        aria-label="Notificaciones"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignItems: "flex-end",
          zIndex: 200000,
          pointerEvents: "none",         // el contenedor no captura clicks…
        }}
      >
        {items.map(item => (
          <ToastItem key={item.id} {...item} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useToast() → función toast(mensaje, { type? })
 * Llámalo en el cuerpo del componente o hook, nunca condicionalmente.
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider + hook colocados a propósito
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}
