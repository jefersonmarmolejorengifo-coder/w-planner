import { useState, useEffect, lazy, Suspense } from "react";
import { supabase } from '../../supabaseClient';
import { getAuthJsonHeaders } from '../../lib/authHeaders';
import { getReferralCode } from '../../hooks/useReferralCapture';
import { useToast } from '../../ui/Toast';

const PlanSelectionModal = lazy(() => import('./PlanSelectionModal'));

// Lanzador reutilizable de la pantalla de selección de planes + checkout de
// Mercado Pago. Se usa en el header (junto a notificaciones) y en el landing
// (antes de crear un tablero). Encapsula el estado del modal, el tier actual y
// el disparo del pago, para que la compra viva fuera de Configuración.
export default function PlansLauncher({ variant = "header" }) {
  const toast = useToast();
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
      toast("No se pudo iniciar el pago: " + err.message, { type: 'error' });
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
  ) : variant === "icon" ? (
    <button onClick={() => setOpen(true)} aria-label="Planes" title="Ver planes y mejorar" style={{
      background: "linear-gradient(135deg, #ec6c04, #f5a623)", color: "#fff",
      border: "none", borderRadius: 6, padding: "6px 10px", cursor: "pointer",
      fontSize: 14, fontWeight: 700, lineHeight: 1, boxShadow: "0 2px 10px rgba(236,108,4,0.35)",
      display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit",
      minHeight: 40, minWidth: 40,
    }}>✨</button>
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
