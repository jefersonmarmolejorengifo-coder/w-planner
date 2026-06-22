// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de PLANES, fuente de verdad EN CÓDIGO para precios, características
// y cobro.
//
// Editar aquí cambia, sin tocar la base de datos ni el panel de Mercado Pago:
//   1. lo que se MUESTRA en la pantalla de selección de planes y los botones
//      de upgrade, y
//   2. lo que se COBRA en Mercado Pago (api/mp-subscribe.js arma el
//      auto_recurring con estos valores).
//
// ⚠️ Los LÍMITES de capacidad (iaProjects / totalProjects) y el acceso al CHAT
// se ENFORCE en la base de datos (tier_limits + RPC user_ia_capacity /
// project_can_use_chat), porque ese gating es server-side por seguridad. El
// PRECIO y las CARACTERÍSTICAS son 100% código. Si cambias un LÍMITE o muevés
// el chat de plan aquí, hazlo también con una migración SQL o la UI mostrará una
// cosa y la BD permitirá otra. Estos valores reflejan las migraciones 016/017/
// 023/028.
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_CURRENCY = "COP";

// Cobro recurrente. Para anual: { frequency: 1, frequency_type: "years" }.
export const PLAN_FREQUENCY = { frequency: 1, frequency_type: "months" };

// Correo al que apunta el soporte comercial. Edítalo aquí.
export const PLAN_CONTACT_EMAIL = "ventas@softatumedida.com";

// ctaType:
//   'free' → plan base, sin pago (botón informativo).
//   'buy'  → comprable self-serve vía Mercado Pago (api/mp-subscribe).
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
      "1 tablero",
      "Tablero Scrum y Kanban",
      "OKRs y super-tareas",
      "Calculadora de aporte",
      "Onboarding guiado incluido",
    ],
  },
  pro_solo: {
    tier: "pro_solo",
    displayName: "Pro",
    tagline: "Para liderar tu primer equipo",
    priceCop: 80000,
    iaProjects: 2,
    totalProjects: 4,
    purchasable: true,
    ctaType: "buy",
    badge: null,
    accent: "#149cac",
    features: [
      "2 tableros con IA",
      "4 tableros en total",
      "Reporte Scrum que caza tareas atascadas y riesgos antes de que exploten",
      "Reporte Semanal que prioriza tu backlog y mide el aporte de cada persona",
      "Análisis Mensual privado con el aporte real del equipo",
      "Pulso del equipo con retros anónimas",
    ],
  },
  pro_team: {
    tier: "pro_team",
    displayName: "Pro Team",
    tagline: "Para coordinar varios equipos",
    priceCop: 110000,
    iaProjects: 5,
    totalProjects: 9,
    purchasable: true,
    ctaType: "buy",
    badge: "Más popular",
    accent: "#ec6c04",
    features: [
      "5 tableros con IA",
      "9 tableros en total",
      "Todo lo del plan Pro",
      "Reportes con IA en todos tus tableros",
      "Visión consolidada cuando manejas más de un equipo",
    ],
  },
  pro_power: {
    tier: "pro_power",
    displayName: "Pro Power",
    tagline: "Para escalar con inteligencia",
    priceCop: 210000,
    iaProjects: 8,
    totalProjects: 14,
    purchasable: true,
    ctaType: "buy",
    badge: null,
    accent: "#6e3ebf",
    features: [
      "8 tableros con IA",
      "14 tableros en total",
      "Todo lo del plan Pro Team",
      "Chat IA en vivo con los datos de tu equipo (100 mensajes al mes)",
      "Reporte Evolutivo que mide crecimiento, lee el sentimiento y reconoce a tu gente",
    ],
  },
};

// Orden de aparición en la pantalla de selección de planes.
export const ALL_PLANS = [
  PLANS.free,
  PLANS.pro_solo,
  PLANS.pro_team,
  PLANS.pro_power,
];

// Planes ofrecidos como botones de upgrade (self-serve), en orden de aparición.
export const PURCHASABLE_PLANS = Object.values(PLANS).filter((p) => p.purchasable);

// Tiers comprables, para validar el body en el backend.
export const PURCHASABLE_TIERS = PURCHASABLE_PLANS.map((p) => p.tier);
