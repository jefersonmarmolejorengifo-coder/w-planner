// Hook: useReferralSync
// Sincroniza proactivamente el código de referido de localStorage con la DB
// cuando el usuario ya tiene sesión activa.
//
// Problema que resuelve: si el usuario llega con ?ref= y ya está logueado,
// useReferralCapture guarda el código en localStorage pero nunca lo envía al
// backend porque el flujo de subscribe no ocurre.
//
// Uso:
//   import { useReferralSync } from './hooks/useReferralSync';
//
//   // En el componente raíz, después de que authUser se resuelva:
//   useReferralSync(authUser);
//
// Flags de localStorage:
//   wplanner_ref_synced  — "true" indica que ya se hizo la llamada y fue OK.
//                          Evita reintentos duplicados en la misma sesión.

import { useEffect } from "react";
import { getReferralCode } from "./useReferralCapture";
import { supabase } from "../supabaseClient";

const SYNC_FLAG_KEY = "wplanner_ref_synced";

/**
 * Cuando authUser es no-nulo (sesión resuelta), verifica si hay un código de
 * referido pendiente de sincronizar y lo envía a /api/capture-referral.
 *
 * - Solo actúa si: authUser existe + hay código en localStorage + aún no
 *   se marcó wplanner_ref_synced.
 * - Si la API responde con status 2xx, setea wplanner_ref_synced="true".
 * - Falla silenciosa: nunca interrumpe el flujo principal de la app.
 *
 * @param {object|null} authUser — usuario de Supabase Auth (o null si no autenticado)
 */
export function useReferralSync(authUser) {
  useEffect(() => {
    if (!authUser) return;

    const code = getReferralCode();
    if (!code) return;

    try {
      if (localStorage.getItem(SYNC_FLAG_KEY) === "true") return;
    } catch {
      return;
    }

    const sync = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return;

        const res = await fetch("/api/capture-referral", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ referral_code: code }),
        });

        if (res.ok) {
          try {
            localStorage.setItem(SYNC_FLAG_KEY, "true");
          } catch {
            // localStorage bloqueado — falla silenciosa
          }
        }
      } catch {
        // Error de red u otro — falla silenciosa, se reintentará en la próxima sesión
      }
    };

    sync();
  }, [authUser]);
}
