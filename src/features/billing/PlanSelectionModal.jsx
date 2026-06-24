import { useId } from "react";
import { useDialog } from "../../useDialog";
import { ALL_PLANS, PLAN_CONTACT_EMAIL } from "../../plans";

// Pantalla de selección de planes (modal a pantalla completa). Lee el catálogo
// de src/plans.js (ALL_PLANS) y muestra cada plan con sus características.
//   - currentTier: tier activo del usuario (capacity.tier) → marca "Tu plan".
//   - onSubscribe(tier): dispara el checkout de Mercado Pago (planes 'buy').
//   - ctaType 'contact' (Enterprise) abre un correo a PLAN_CONTACT_EMAIL.
// Extraído del monolito (H-002) y cargado con React.lazy para sacarlo del bundle inicial.
export default function PlanSelectionModal({ currentTier, busy, referralCode, onSubscribe, onClose }) {
  const fmt = (n) => n.toLocaleString("es-CO");
  const titleId = useId();
  const dialogRef = useDialog(onClose);

  const renderCta = (plan) => {
    const isCurrent = plan.tier === currentTier;
    if (isCurrent) {
      return <button className="pp-plan-cta pp-plan-cta-current" disabled>Tu plan actual</button>;
    }
    if (plan.ctaType === "free") {
      return <button className="pp-plan-cta pp-plan-cta-ghost" disabled>Plan base</button>;
    }
    if (plan.ctaType === "contact") {
      const href = `mailto:${PLAN_CONTACT_EMAIL}?subject=${encodeURIComponent("Quiero el plan Enterprise de Productivity-Plus")}`;
      return <a className="pp-plan-cta pp-plan-cta-buy" href={href} style={{ "--accent": plan.accent }}>Contáctanos</a>;
    }
    return (
      <button
        className="pp-plan-cta pp-plan-cta-buy"
        style={{ "--accent": plan.accent }}
        disabled={busy}
        onClick={() => onSubscribe(plan.tier)}
      >
        {busy ? "Redirigiendo…" : `Elegir ${plan.displayName}`}
      </button>
    );
  };

  return (
    <div className="pp-plans-overlay" onClick={onClose}>
      <style>{`
        @keyframes ppPlansIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes ppPlanRise { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: translateY(0) } }
        .pp-plans-overlay {
          position: fixed; inset: 0; z-index: 100001;
          background: radial-gradient(1200px 600px at 50% -10%, rgba(84,44,156,0.35), rgba(5,5,14,0.96) 60%);
          backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
          display: flex; align-items: flex-start; justify-content: center;
          overflow-y: auto; padding: 48px 20px; animation: ppPlansIn .25s ease;
        }
        .pp-plans-shell {
          width: 100%; max-width: 1180px; position: relative;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .pp-plans-close {
          position: absolute; top: -12px; right: 0; width: 38px; height: 38px;
          border-radius: 50%; border: 1px solid rgba(255,255,255,0.14);
          background: rgba(255,255,255,0.04); color: #fff; font-size: 18px;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          transition: background .15s, transform .15s;
        }
        .pp-plans-close:hover { background: rgba(255,255,255,0.12); transform: rotate(90deg); }
        .pp-plans-eyebrow {
          font-size: 11px; letter-spacing: 5px; text-transform: uppercase;
          color: rgba(255,255,255,0.4); text-align: center; margin-bottom: 14px;
        }
        .pp-plans-title {
          font-size: 38px; font-weight: 800; letter-spacing: -1px; text-align: center;
          margin: 0 0 10px; color: #fff;
          background: linear-gradient(120deg, #fff 30%, #f5a623 70%, #149cac);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .pp-plans-sub {
          font-size: 14px; color: rgba(255,255,255,0.55); text-align: center;
          margin: 0 auto 40px; max-width: 520px; line-height: 1.6;
        }
        .pp-plans-grid {
          display: grid; gap: 16px;
          grid-template-columns: repeat(auto-fit, minmax(196px, 1fr));
          align-items: stretch;
        }
        .pp-plan-card {
          position: relative; display: flex; flex-direction: column;
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
          border: 1px solid rgba(255,255,255,0.09); border-radius: 18px;
          padding: 24px 20px 22px; color: #fff;
          animation: ppPlanRise .5s cubic-bezier(.2,.7,.2,1) both;
          transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
        }
        .pp-plan-card:hover { transform: translateY(-4px); border-color: rgba(255,255,255,0.2); }
        .pp-plan-popular {
          border-color: rgba(236,108,4,0.55);
          box-shadow: 0 0 0 1px rgba(236,108,4,0.4), 0 24px 60px rgba(236,108,4,0.18);
          background: linear-gradient(180deg, rgba(236,108,4,0.14), rgba(255,255,255,0.02));
        }
        .pp-plan-popular:hover { transform: translateY(-8px); }
        .pp-plan-badge {
          position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
          background: linear-gradient(135deg, #ec6c04, #f5a623); color: #1a1206;
          font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase;
          padding: 5px 12px; border-radius: 999px; white-space: nowrap;
          box-shadow: 0 6px 16px rgba(236,108,4,0.4);
        }
        .pp-plan-name { font-size: 19px; font-weight: 800; margin: 2px 0 4px; }
        .pp-plan-tagline { font-size: 12px; color: rgba(255,255,255,0.5); min-height: 32px; line-height: 1.4; margin-bottom: 16px; }
        .pp-plan-price { display: flex; align-items: baseline; gap: 4px; margin-bottom: 4px; }
        .pp-plan-price-amount { font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
        .pp-plan-price-period { font-size: 12px; color: rgba(255,255,255,0.45); }
        .pp-plan-price-currency { font-size: 12px; color: rgba(255,255,255,0.45); font-weight: 600; }
        .pp-plan-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 18px 0; }
        .pp-plan-features { list-style: none; padding: 0; margin: 0 0 22px; display: flex; flex-direction: column; gap: 11px; flex: 1; }
        .pp-plan-feature { display: flex; align-items: flex-start; gap: 9px; font-size: 12.5px; line-height: 1.4; color: rgba(255,255,255,0.82); }
        .pp-plan-check {
          flex-shrink: 0; width: 16px; height: 16px; border-radius: 50%; margin-top: 1px;
          display: flex; align-items: center; justify-content: center; font-size: 10px;
          background: var(--accent, #149cac); color: #fff; font-weight: 900;
        }
        .pp-plan-cta {
          width: 100%; padding: 12px 14px; border-radius: 11px; font-size: 13.5px;
          font-weight: 700; cursor: pointer; border: none; text-align: center;
          text-decoration: none; display: block; transition: transform .15s, filter .15s, opacity .15s;
        }
        .pp-plan-cta-buy { background: linear-gradient(135deg, var(--accent), #ffffff22), var(--accent); color: #fff; box-shadow: 0 8px 22px rgba(0,0,0,0.35); }
        .pp-plan-cta-buy:hover { transform: translateY(-2px); filter: brightness(1.12); }
        .pp-plan-cta-current { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.14); cursor: default; }
        .pp-plan-cta-ghost { background: transparent; color: rgba(255,255,255,0.4); border: 1px solid rgba(255,255,255,0.12); cursor: default; }
        .pp-plan-cta:disabled { cursor: default; }
        .pp-plans-foot { text-align: center; font-size: 11.5px; color: rgba(255,255,255,0.4); margin-top: 28px; line-height: 1.6; }
        .pp-plans-ref-badge {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
          color: rgba(255,255,255,0.45); background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1); border-radius: 999px;
          padding: 5px 12px;
        }
        .pp-plans-ref-badge svg { flex-shrink: 0; }
        @media (max-width: 560px) { .pp-plans-title { font-size: 28px; } }
      `}</style>

      <div className="pp-plans-shell" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <button className="pp-plans-close" onClick={onClose} aria-label="Cerrar">✕</button>
        <div className="pp-plans-eyebrow">Productivity-Plus</div>
        <h2 id={titleId} className="pp-plans-title">Elige tu plan</h2>
        <p className="pp-plans-sub">
          Desbloquea reportes con IA, pulso del equipo y analítica avanzada.
          Cobro mensual en COP vía Mercado Pago. Cancela cuando quieras.
        </p>

        {referralCode && (
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <span className="pp-plans-ref-badge" role="note" aria-label="Te recomendó un afiliado del programa de Soft a tu Medida">
              {/* Sparkles icon — SVG inline, no dependencia externa */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M12 3 L13.5 8.5 L19 10 L13.5 11.5 L12 17 L10.5 11.5 L5 10 L10.5 8.5 Z" />
                <path d="M5 3 L5.75 5.25 L8 6 L5.75 6.75 L5 9 L4.25 6.75 L2 6 L4.25 5.25 Z" />
                <path d="M19 17 L19.75 19.25 L22 20 L19.75 20.75 L19 23 L18.25 20.75 L16 20 L18.25 19.25 Z" />
              </svg>
              Te recomendó un afiliado del programa de Soft a tu Medida.
            </span>
          </div>
        )}

        <div className="pp-plans-grid">
          {ALL_PLANS.map((plan, i) => {
            const isPopular = !!plan.badge;
            const isCurrent = plan.tier === currentTier;
            return (
              <div
                key={plan.tier}
                className={`pp-plan-card${isPopular ? " pp-plan-popular" : ""}`}
                style={{ animationDelay: `${i * 70}ms` }}
              >
                {plan.badge && <div className="pp-plan-badge">{plan.badge}</div>}
                {isCurrent && !plan.badge && <div className="pp-plan-badge" style={{ background: "linear-gradient(135deg,#149cac,#27ae60)", color: "#fff" }}>Plan actual</div>}

                <div className="pp-plan-name" style={{ color: plan.accent === "#7a8aa0" ? "#fff" : plan.accent }}>{plan.displayName}</div>
                <div className="pp-plan-tagline">{plan.tagline}</div>

                <div className="pp-plan-price">
                  {plan.priceCop === 0 ? (
                    <span className="pp-plan-price-amount">Gratis</span>
                  ) : (
                    <>
                      <span className="pp-plan-price-currency">COP</span>
                      <span className="pp-plan-price-amount">${fmt(plan.priceCop)}</span>
                      <span className="pp-plan-price-period">/mes</span>
                    </>
                  )}
                </div>

                <div className="pp-plan-divider" />

                <ul className="pp-plan-features">
                  {plan.features.map((f, fi) => (
                    <li className="pp-plan-feature" key={fi}>
                      <span className="pp-plan-check" style={{ "--accent": plan.accent }}>✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                {renderCta(plan)}
              </div>
            );
          })}
        </div>

        <div className="pp-plans-foot">
          Los precios se cobran mensualmente. La capacidad de IA y los reportes se activan al confirmarse el pago.<br />
          ¿Dudas sobre qué plan elegir? Escríbenos a {PLAN_CONTACT_EMAIL}.
        </div>
      </div>
    </div>
  );
}
