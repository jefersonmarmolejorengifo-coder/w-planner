// Planes de marketing. Precios en COP, fuente de verdad: ../../../src/plans.js
// (mantener sincronizado si cambian precios o límites en la app).
export const CURRENCY = 'COP';

export const plans = [
  {
    tier: 'free',
    name: 'Gratis',
    price: 0,
    tagline: 'Para organizar tu primer tablero sin pagar nada.',
    popular: false,
    cta: 'Crear cuenta gratis',
    features: [
      '1 tablero',
      'Scrum y Kanban',
      'OKRs y super-tareas',
      'Calculadora de aporte',
      'Onboarding guiado',
    ],
  },
  {
    tier: 'pro_solo',
    name: 'Pro',
    price: 80000,
    tagline: 'Para liderar tu primer equipo con reportes automáticos.',
    popular: false,
    cta: 'Empezar',
    features: [
      '4 tableros, 2 con IA',
      'Reporte Scrum que caza tareas atascadas y riesgos',
      'Reporte semanal que prioriza el backlog y mide el aporte de cada persona',
      'Análisis mensual privado del aporte real del equipo',
      'Pulso del equipo con retros anónimas',
    ],
  },
  {
    tier: 'pro_team',
    name: 'Pro Team',
    price: 110000,
    tagline: 'Para coordinar varios equipos con una sola visión.',
    popular: true,
    cta: 'Empezar',
    features: [
      '9 tableros, 5 con IA',
      'Todo lo del plan Pro',
      'Reportes con IA en todos tus tableros',
      'Visión consolidada cuando manejas más de un equipo',
    ],
  },
  {
    tier: 'pro_power',
    name: 'Pro Power',
    price: 210000,
    tagline: 'Para escalar con datos y chat de IA sobre tu equipo.',
    popular: false,
    cta: 'Empezar',
    features: [
      '14 tableros, 8 con IA',
      'Todo lo del plan Pro Team',
      'Chat de IA en vivo con los datos de tu equipo (100 mensajes al mes)',
      'Reporte evolutivo que mide crecimiento y reconoce a tu gente',
    ],
  },
];

export function formatCOP(n) {
  if (n === 0) return 'Gratis';
  return '$' + n.toLocaleString('es-CO') + ' COP';
}
