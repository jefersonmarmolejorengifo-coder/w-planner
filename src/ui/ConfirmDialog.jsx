/**
 * ConfirmDialog.jsx — Diálogo de confirmación modal accesible (U-02 / R-11).
 *
 * API pública:
 *   <ConfirmProvider>…</ConfirmProvider>   — envuelve el árbol en main.jsx
 *   const confirm = useConfirm()           — hook para solicitar confirmaciones
 *   const ok = await confirm(mensaje, {    — devuelve Promise<boolean>
 *     title?,       // string — cabecera del diálogo (default: "Confirmar")
 *     confirmText?, // string — texto del botón afirmativo (default: "Confirmar")
 *     cancelText?,  // string — texto del botón negativo (default: "Cancelar")
 *     danger?,      // bool  — pinta el botón de confirmar en rojo
 *   })
 *
 * Accesibilidad (reutiliza useDialog de src/useDialog.js):
 *   - role="dialog" aria-modal="true" aria-labelledby
 *   - Foco inicial en el primer elemento enfocable (botón Cancelar)
 *   - Trampa de foco (Tab / Shift+Tab confinados al diálogo)
 *   - Escape → cancela (resuelve false) y devuelve el foco; stopPropagation
 *     evita que se propague a un modal de fondo abierto simultáneamente
 *   - tabIndex={-1} en el contenedor para que useDialog pueda enfocar el div
 *     si no hubiera ningún elemento enfocable dentro
 *
 * Solo una confirmación pendiente a la vez (patrón estándar imperativo).
 */

import { createContext, useCallback, useContext, useId, useState } from "react";
import { useDialog } from "../useDialog";

// ─── Contexto ────────────────────────────────────────────────────────────────

const ConfirmContext = createContext(null);

// ─── Colores de la app ───────────────────────────────────────────────────────

const BTN_CONFIRM = {
  normal:  "linear-gradient(135deg, #542c9c, #6e3ebf)",
  danger:  "linear-gradient(135deg, #c0392b, #e74c3c)",
};

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

function ConfirmModal({ message, title, confirmText, cancelText, danger, onResolve }) {
  const titleId = useId();

  // Escape llama onClose → resuelve false.
  const dialogRef = useDialog(() => onResolve(false));

  const btnBase = {
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    padding: "9px 20px",
    fontFamily: "inherit",
    transition: "opacity 0.15s, transform 0.1s",
  };

  return (
    /* Overlay */
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,10,40,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200001,          // un punto sobre los toasts (200000)
        padding: 16,
      }}
      /* Clic en el overlay = cancelar */
      onClick={() => onResolve(false)}
    >
      {/* Diálogo */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}   // evita que el clic interno cierre el overlay
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "24px 26px 20px",
          boxShadow: "0 8px 40px rgba(84,44,156,0.18), 0 2px 8px rgba(0,0,0,0.12)",
          maxWidth: 420,
          width: "100%",
          outline: "none",
          animation: "confirm-in 0.2s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* Título */}
        <div
          id={titleId}
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: danger ? "#c0392b" : "#542c9c",
            marginBottom: 10,
            lineHeight: 1.3,
          }}
        >
          {title}
        </div>

        {/* Mensaje */}
        <p
          style={{
            fontSize: 14,
            color: "#444",
            margin: "0 0 22px",
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>

        {/* Botones */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          {/* Cancelar — recibe el foco inicial (está primero en el DOM) */}
          <button
            onClick={() => onResolve(false)}
            style={{
              ...btnBase,
              background: "#f0ecfb",
              color: "#542c9c",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.82"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            {cancelText}
          </button>

          {/* Confirmar */}
          <button
            onClick={() => onResolve(true)}
            style={{
              ...btnBase,
              background: danger ? BTN_CONFIRM.danger : BTN_CONFIRM.normal,
              color: "#fff",
              boxShadow: danger
                ? "0 3px 10px rgba(192,57,43,0.35)"
                : "0 3px 10px rgba(84,44,156,0.3)",
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.88"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
          >
            {confirmText}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes confirm-in {
          from { opacity: 0; transform: scale(0.95) translateY(-6px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
      `}</style>
    </div>
  );
}

// ─── ConfirmProvider ──────────────────────────────────────────────────────────

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // null | { message, opts, resolve }

  const confirm = useCallback((message, opts = {}) => {
    return new Promise(resolve => {
      setState({ message, opts, resolve });
    });
  }, []);

  const handleResolve = useCallback((value) => {
    setState(prev => {
      if (prev) prev.resolve(value);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <ConfirmModal
          message={state.message}
          title={state.opts.title ?? "Confirmar"}
          confirmText={state.opts.confirmText ?? "Confirmar"}
          cancelText={state.opts.cancelText ?? "Cancelar"}
          danger={!!state.opts.danger}
          onResolve={handleResolve}
        />
      )}
    </ConfirmContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useConfirm() → función async confirm(mensaje, opts?) → Promise<boolean>
 * Llámalo en el cuerpo del componente o hook, nunca condicionalmente.
 */
// eslint-disable-next-line react-refresh/only-export-components -- provider + hook colocados a propósito
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm debe usarse dentro de <ConfirmProvider>");
  return ctx;
}
