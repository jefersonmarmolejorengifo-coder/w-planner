// Hook: useReferralCapture
// Captura el parámetro `?ref=` de la URL al montar la SPA y lo persiste en
// localStorage bajo la key `wplanner_ref_code`. Implementa lock-in lifetime
// (el primer código que ve el browser gana) y expiración de 30 días.
// localStorage es cache pre-registro; la fuente de verdad es la DB (ver useReferralSync).
//
// Uso:
//   import { useReferralCapture, getReferralCode } from './hooks/useReferralCapture';
//
//   // En el componente raíz:
//   useReferralCapture();
//
//   // En el flujo de pago:
//   const code = getReferralCode(); // string | null

import { useEffect } from "react";

const STORAGE_KEY = "wplanner_ref_code";
const REF_REGEX = /^[A-Z0-9]{8}$/;
const EXPIRY_DAYS = 30;

/**
 * Lee el código de referido de localStorage.
 * Devuelve el string del código si existe y no ha caducado (30 días desde
 * captured_at). Devuelve null en cualquier otro caso, incluyendo cuando
 * localStorage no está disponible (Safari modo privado, etc.).
 *
 * @returns {string|null}
 */
export function getReferralCode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.code !== "string" || !parsed.captured_at) {
      return null;
    }

    const capturedAt = new Date(parsed.captured_at);
    const expiresAt = new Date(capturedAt.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    if (Date.now() > expiresAt.getTime()) {
      // Código caducado: limpiar y devolver null
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed.code;
  } catch {
    // localStorage deshabilitado o JSON inválido — falla silenciosa
    return null;
  }
}

/**
 * Hook que se invoca en el componente raíz. En cada carga de la SPA:
 *  1. Lee `?ref=` del query string.
 *  2. Si es un código válido (8 chars alfanuméricos mayúsculas) y no hay uno
 *     ya guardado (lock-in), lo persiste en localStorage con timestamp.
 *  3. Limpia el `?ref=` de la URL visible (history.replaceState) para que no
 *     se propague si el usuario copia la URL.
 */
export function useReferralCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const refParam = params.get("ref");

      // Normalizar a mayúsculas: el código se valida con REF_REGEX (^[A-Z0-9]{8}$).
      // Si el afiliado comparte el link con el código en minúsculas (?ref=pfwag84q),
      // sin normalizar la validación fallaría y el referido se perdería.
      const normalized = refParam ? refParam.trim().toUpperCase() : null;
      if (!normalized || !REF_REGEX.test(normalized)) return;

      // Lock-in: solo guardar si no hay código previo válido
      const existing = getReferralCode();
      if (!existing) {
        const payload = {
          code: normalized,
          captured_at: new Date().toISOString(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      }

      // Limpiar ?ref= de la URL sin recargar la página
      params.delete("ref");
      const newSearch = params.toString();
      const newUrl =
        window.location.pathname +
        (newSearch ? "?" + newSearch : "") +
        window.location.hash;
      window.history.replaceState(window.history.state, "", newUrl);
    } catch {
      // Falla silenciosa — localStorage deshabilitado u otro error de entorno
    }
  }, []);
}
