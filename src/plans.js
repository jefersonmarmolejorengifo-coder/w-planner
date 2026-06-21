// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de PLANES — fuente de verdad EN CÓDIGO para precios, características
// y cobro.
//
// Editar aquí cambia, sin tocar la base de datos ni el panel de Mercado Pago:
//   1. lo que se MUESTRA en la pantalla de selección de planes y en los botones
//      de upgrade, y
//   2. lo que se COBRA en Mercado Pago — api/mp-subscribe.js arma el
//      `auto_recurring` (cobro recurrente inline) con estos valores.
//
// ⚠️ Los LÍMITES de capacidad (iaProjects / totalProjects) se ENFORCE en la
// base de datos (tabla `tier_limits` + RPC `user_ia_capacity`), porque ese
// gating es server-side por seguridad. El PRECIO y las CARACTERÍSTICAS son 100%
// código. Si cambias un LÍMITE aquí, cámbialo también con una migración SQL
// (`UPDATE public.tier_limits ...`) o la UI mostrará un número y la BD permitirá
// otro. Estos valores reflejan las migraciones 016/017/023.
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_CURRENCY = "COP";

// Cobro recurrente. Para anual: { frequency: 1, frequency_type: "years" }.
export const PLAN_FREQUENCY = { frequency: 1, frequency_type: "months" };

// Correo al que apunta el CTA de Enterprise ("Contáctanos"). Edítalo aquí.
export const PLAN_CONTACT_EMAIL = "ventas@softatumedida.com";

// ctaType:
//   'free'    → plan base, sin pago (botón informativo).
//   'buy'     → comprable self-serve vía Mercado Pago (api/mp-subscribe).
//   'contact' → requiere contacto comercial (no self-serve).
export const PLANS = {
  free: {
    tier: "free",
    displayName: "Gratis",
    tagline: "Para empezar a organizarte",
    priceCop: 0,
    iaProjects: 0,
    totalProjects: 1,
    purchasable: false,
    ctaType: "free",
    badge: null,
    accent: "#7a8aa0",
    features: [
      "1 proyecto",
      "Tablero Scrum + Kanban",
      "OKRs y super-tareas",
      "Calculadora de aporte",
      "Sin reportes con IA",
    ],
  },
  pro_solo: {
    tier: "pro_solo",
    displayName: "Pro Solo",
    tagline: "Para liderar un equipo",
    priceCop: 50000,
    iaProjects: 2,
    totalProjects: 4,
    purchasable: true,
    ctaType: "buy",
    badge: null,
    accent: "#149cac",
    features: [
      "2 proyectos con IA",
      "4 proyectos en total",
      "Reporte Semanal del PO (IA)",
      "Reporte Scrum bi-semanal (IA)",
      "Reporte Mensual del equipo (IA)",
      "Pulso del equipo + retros",
    ],
  },
  pro_team: {
    tier: "pro_team",
    displayName: "Pro Team",
    tagline: "Para coordinar varios equipos",
    priceCop: 80000,
    iaProjects: 5,
    totalProjects: 9,
    purchasable: true,
    ctaType: "buy",
    badge: "Más popular",
    accent: "#ec6c04",
    features: [
      "5 proyectos con IA",
      "9 proyectos en total",
      "Todo lo de Pro Solo",
      "Reportes IA en todos tus proyectos",
      "Pulso del equipo + retros",
    ],
  },
  pro_power: {
    tier: "pro_power",
    displayName: "Pro Power",
    tagline: "Para escalar con analítica",
    priceCop: 150000,
    iaProjects: 8,
    totalProjects: 14,
    purchasable: true,
    ctaType: "buy",
    badge: null,
    accent: "#6e3ebf",
    features: [
      "8 proyectos con IA",
      "14 proyectos en total",
      "Todo lo de Pro Team",
      "Reporte Evolutivo profesional (cada 60 días)",
      "Análisis de sentimiento y contexto causal",
    ],
  },
  enterprise: {
    tier: "enterprise",
    displayName: "Enterprise",
    tagline: "Para la organización completa",
    priceCop: 350000,
    iaProjects: 999,
    totalProjects: 999,
    purchasable: false,
    ctaType: "contact",
    badge: null,
    accent: "#542c9c",
    features: [
      "Proyectos con IA ilimitados",
      "Chat IA del proyecto (100 msg/mes)",
      "Todo lo de Pro Power",
      "Soporte prioritario",
      "Onboarding asistido",
    ],
  },
};

// Orden de aparición en la pantalla de selección de planes.
export const ALL_PLANS = [
  PLANS.free,
  PLANS.pro_solo,
  PLANS.pro_team,
  PLANS.pro_power,
  PLANS.enterprise,
];

// Planes ofrecidos como botones de upgrade (self-serve), en orden de aparición.
export const PURCHASABLE_PLANS = Object.values(PLANS).filter((p) => p.purchasable);

// Tiers comprables — para validar el body en el backend.
export const PURCHASABLE_TIERS = PURCHASABLE_PLANS.map((p) => p.tier);
