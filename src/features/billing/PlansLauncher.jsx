import { useState, useEffect, lazy, Suspense } from "react";
import { supabase } from '../../supabaseClient';
import { getAuthJsonHeaders } from '../../lib/authHeaders';
import { getReferralCode } from '../../hooks/useReferralCapture';
import { useToast } from '../../ui/Toast';

const PlanSelectionModal = lazy(() => import('./PlanSelectionModal'));

// Caché a nivel de módulo del tier (A28). El RPC user_ia_capacity se resolvía en
// CADA apertura del modal y en cada instancia montada (header + landing). El tier
// es estable dentro de la sesión: cambiarlo navega a Mercado Pago (window.location
// .assign) y el retorno recarga la página, reseteando este módulo. Cacheamos la
// promesa para no repetir el RPC en cada apertura.
let _tierPromise = null;
const fetchTier = () => {
  if (!_tierPromise) {
    _tierPromise = supabase.rpc("user_ia_capacity").single().then(({ data }) => data?.tier || "free");
  }
  return _tierPromise;
};

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
    fetchTier().then((tier) => { if (!cancelled) setCurrentTier(tier); });
    return () => { cancelled = true; };
  }, [open]);

  // Mapeo de tiers internos a los slugs que maneja el checkout del Hub (Wompi).
  const WOMPI_PLAN_MAP = { pro_solo: 'pro', pro_team: 'proteam', pro_power: 'propower' };

  const subscribe = async (tier) => {
    setBusy(true);

    // Flag de feature: VITE_WOMPI_CHECKOUT_ENABLED='true' activa el checkout del
    // Hub; cualquier otro valor (o ausencia) mantiene el flujo de MercadoPago
    // actual intacto. Desplegable INERTE cuando el flag está OFF.
    const wompiOn = import.meta.env.VITE_WOMPI_CHECKOUT_ENABLED === 'true';

    if (wompiOn) {
      try {
        const hubPlan = WOMPI_PLAN_MAP[tier];
        if (!hubPlan) {
          // Tier desconocido: defensa ante slugs futuros no mapeados aún.
          throw new Error(`Plan "${tier}" no está disponible en el nuevo checkout.`);
        }

        // Seguridad M-3: validamos el host antes de usarlo para construir la URL
        // de pago. Si VITE_HUB_CHECKOUT_BASE contiene un host fuera del dominio
        // softatumedida.com (por config incorrecta o variable comprometida), caemos
        // al default conocido. Así una var de entorno adulterada no puede redirigir
        // el pago a un host adversarial.
        const rawBase = import.meta.env.VITE_HUB_CHECKOUT_BASE || '';
        let HUB = 'https://panel.softatumedida.com';
        if (rawBase) {
          try {
            const parsedHost = new URL(rawBase).hostname;
            if (parsedHost === 'panel.softatumedida.com' || parsedHost.endsWith('.softatumedida.com')) {
              HUB = rawBase;
            }
          } catch (_) {
            // URL inválida: se mantiene el default seguro
          }
        }

        // ui-ux #2: marcamos el procesador en el redirect para que BillingReturnOverlay
        // pueda mostrar la marca correcta (Wompi vs Mercado Pago) sin usar el valor
        // crudo del param en ninguna decisión de lógica/autorización.
        const redirect = `${window.location.origin}/app?billing=return&via=wompi`;

        // Email del usuario autenticado. Si la sesión no tiene email (caso
        // improbable en producción, ya que se necesita cuenta para llegar aquí),
        // el checkout del Hub pedirá el email al usuario directamente.
        const { data: userData } = await supabase.auth.getUser();
        const email = userData?.user?.email || null;

        // Construir los query params. `ref` se omite si no hay código de afiliado
        // para no enviar `ref=` vacío al Hub (podría confundirse con un código nulo).
        const params = new URLSearchParams();
        const refCode = getReferralCode();
        if (refCode) params.set('ref', refCode);
        if (email) params.set('email', email);
        params.set('redirect', redirect);

        const qs = params.toString();
        const url = `${HUB}/checkout/w-planner/${encodeURIComponent(hubPlan)}${qs ? '?' + qs : ''}`;
        window.location.assign(url);
        // No hacer setBusy(false): la página va a navegar; dejarlo en true evita
        // un doble-clic entre el assign y la navegación real del browser.
      } catch (err) {
        setBusy(false);
        // ui-ux #5: distinguimos el error controlado (tier desconocido, empieza con
        // 'Plan "') del error de red/fetch para no exponer mensajes técnicos crudos.
        const userMsg = err.message.startsWith('Plan "')
          ? err.message
          : "No se pudo iniciar el pago. Revisa tu conexión e intenta de nuevo.";
        toast(userMsg, { type: 'error' });
      }
      return;
    }

    // ── Flujo MercadoPago (flag OFF — DEFAULT) ────────────────────────────────
    // No se modifica el comportamiento. Solo se alinea el texto del toast (ui-ux #5):
    // errores controlados (respuesta de API) se muestran tal cual; errores de red/fetch
    // se reemplazan por un mensaje amigable sin exponer detalles técnicos crudos.
    try {
      const headers = await getAuthJsonHeaders();
      const res = await fetch("/api/mp-subscribe", { method: "POST", headers, body: JSON.stringify({ tier, referral_code: getReferralCode() }) });
      const data = await res.json();
      if (!res.ok || !data.init_point) throw new Error(data.error || `HTTP ${res.status}`);
      window.location.assign(data.init_point);
    } catch (err) {
      setBusy(false);
      // ui-ux #5: si el error viene del servidor (data.error) tiene texto controlado;
      // si es "Failed to fetch" u otro error de red, mostramos mensaje genérico.
      const isControlled = err.message && !err.message.startsWith('Failed to') && !err.message.startsWith('NetworkError') && !err.message.startsWith('Load failed');
      const userMsg = isControlled
        ? "No se pudo iniciar el pago: " + err.message
        : "No se pudo iniciar el pago. Revisa tu conexión e intenta de nuevo.";
      toast(userMsg, { type: 'error' });
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
  const wompiOn = import.meta.env.VITE_WOMPI_CHECKOUT_ENABLED === 'true';

  return (
    <>
      {trigger}
      {open && (
        <Suspense fallback={null}>
          <PlanSelectionModal
            currentTier={currentTier}
            busy={busy}
            referralCode={referralCode}
            wompiOn={wompiOn}
            onSubscribe={(t) => { setOpen(false); subscribe(t); }}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
