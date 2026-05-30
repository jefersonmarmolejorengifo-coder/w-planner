// Onboarding guiado: modal de bienvenida + tour spotlight.
// El usuario elige rol (Scrum Master / PO / Participante) y recibe un
// tour de pasos con tooltip flotante apuntando a los botones reales.
// Estado persistido en public.user_onboarding (migración 024).
//
// Cómo agregar pasos: edita TOUR_SCRIPTS abajo. Cada paso tiene:
//   { tab?, target?, title, body, emoji, placement? }
// - tab: id de TAB que debe estar activa (el tour la activa antes de pintar).
// - target: CSS selector del elemento real (usar data-tour="..." en el JSX).
// - sin target: paso informativo, modal centrado.

import React, { useEffect, useState, useRef, useLayoutEffect } from "react";

const ROLES = {
  scrum_master: {
    label: "Scrum Master",
    emoji: "🎯",
    color: "#149cac",
    gradient: "linear-gradient(135deg,#0e7480,#149cac)",
    pitch: "Facilitas el proceso, destrabas al equipo, cuidas el ritmo del sprint.",
  },
  po: {
    label: "Product Owner",
    emoji: "👔",
    color: "#542c9c",
    gradient: "linear-gradient(135deg,#3a1f6e,#542c9c)",
    pitch: "Defines el qué y el por qué. Priorizas backlog, lees métricas, decides el rumbo.",
  },
  participant: {
    label: "Participante",
    emoji: "💪",
    color: "#ec6c04",
    gradient: "linear-gradient(135deg,#c95903,#ec6c04)",
    pitch: "Ejecutas tareas, reportas avances, te coordinas con el equipo.",
  },
};

// ─── Scripts por rol ──────────────────────────────────────────
const TOUR_SCRIPTS = {
  scrum_master: [
    {
      emoji: "🎯",
      title: "Hola, Scrum Master",
      body: "Te voy a llevar 6 paradas para que veas tu zona de control. Si en algún punto te pierdes, puedes saltar el tour y volver desde tu menú de usuario.",
    },
    {
      tab: "sprints",
      target: '[data-tour="tab-sprints"]',
      emoji: "🏃",
      title: "Sprints: tu zona de planeación",
      body: "Aquí creas sprints con fecha inicio y fin claras. Cuando un sprint está activo, las tareas pueden vincularse a él desde el formulario de tarea (dropdown filtrado por fecha).",
    },
    {
      tab: "okrs",
      target: '[data-tour="tab-okrs"]',
      emoji: "🧭",
      title: "OKRs: el norte del proyecto",
      body: "Define objetivos con fechas y métricas (key results). Cuando vinculas una tarea a un KR, el progreso del KR se calcula automáticamente como % de tareas finalizadas. Cero manual.",
    },
    {
      tab: "board",
      target: '[data-tour="tab-board"]',
      emoji: "📋",
      title: "Tablero: el estado real",
      body: "Aquí ves todas las tareas con su responsable, estado y aporte calculado. Como SM, tu trabajo es destrabar — no asignar. Filtra por persona si necesitas hacer 1:1.",
    },
    {
      tab: "pulse",
      target: '[data-tour="tab-pulse"]',
      emoji: "🌡",
      title: "Pulso del equipo (después del sprint)",
      body: "Al cerrar un sprint el equipo recibe una mini-encuesta: emoji + qué les gustó / qué no + 3 señalizaciones anónimas. Aquí ves los resultados agregados, perfectos para arrancar la retro.",
    },
    {
      emoji: "✉️",
      title: "Reportes automáticos",
      body: "Cada miércoles y viernes sale el reporte Scrum por correo (alertas, tareas atascadas, próximas a vencer). No tienes que hacer nada. Ahora voy a llevarte por la Configuración para que veas todo lo que puedes ajustar.",
    },
    {
      tab: "config",
      target: '[data-tour="tab-config"]',
      emoji: "⚙️",
      title: "Configuración: tu cuarto de máquinas",
      body: "Aquí ajustas cómo se comporta el proyecto: a quién invitas, qué métricas mides, cómo se calcula el aporte, qué reportes salen y a quién. Tu rol como SM vive aquí casi tanto como en el tablero.",
    },
    {
      tab: "config",
      target: '[data-tour="config-project"]',
      emoji: "🏗️",
      title: "Proyecto + invitaciones por correo",
      body: "Datos básicos del proyecto y el campo para invitar gente nueva por email. La invitación llega con un código de 6 dígitos y se vincula automáticamente al miembro cuando se registra. Aquí también ves el código de invitación general.",
    },
    {
      tab: "config",
      target: '[data-tour="config-people"]',
      emoji: "👥",
      title: "Participantes del proyecto",
      body: "Lista completa de quien está dentro. Puedes marcar a alguien como super-usuario (admin) o quitarlo. Este registro alimenta los selects de 'Responsable' al crear tareas y los reportes.",
    },
    {
      tab: "config",
      target: '[data-tour="config-indicators"]',
      emoji: "📊",
      title: "Indicadores clave",
      body: "KPIs del proyecto (ej: NPS, conversión, latencia). Sirven para etiquetar tareas con su métrica de impacto. Al cierre del sprint puedes ver cuánto contribuyó cada tarea a cada indicador.",
    },
    {
      tab: "config",
      target: '[data-tour="config-types"]',
      emoji: "🧩",
      title: "Tipos de tarea",
      body: "Categorías por defecto: Estratégica, Operativa, Técnica, Diseño, etc. Personalízalas a tu industria. Los reportes IA segmentan por tipo para mostrarte balance entre estratégico vs operativo.",
    },
    {
      tab: "config",
      target: '[data-tour="config-calculator"]',
      emoji: "⚖️",
      title: "Calculadora de Aporte (define qué se valora)",
      body: [
        { label: "Qué es", text: "La fórmula que convierte cada tarea en un número único (su Valor de Aporte). Trae 3 dimensiones por defecto (Tiempo, Dificultad, Impacto Estratégico) pero puedes AGREGAR las que tu proyecto necesite (complejidad técnica, riesgo, dependencias externas, alineación con OKR…) o QUITAR las que no apliquen. La calculadora se adapta al proyecto, no al revés." },
        { label: "Cómo funciona", text: "Cada dimensión tiene un peso 1-100, idealmente sumando 100 entre todas. Cada tarea recibe un valor 1-10 por dimensión. Aporte = suma(valor × peso) / 100. Ejemplo: Tiempo=30, Dificultad=30, Estratégico=40 (pesos). Tarea con valores 7/8/10 = (7×30 + 8×30 + 10×40)/100 = 8.5 puntos. Tarea trivial 3/2/4 = 3.1 puntos. Ese diferencial es lo que tu equipo verá en el board y los reportes." },
        { label: "Qué pasa con las tareas viejas cuando cambias pesos", text: "Esto es lo importante: cada tarea guarda su aporte CALCULADO al momento de crearla o editarla (un snapshot). Cambiar pesos NO recalcula las tareas existentes — quedan congeladas con la fórmula vieja. Resultado: después de un cambio coexisten dos reglas en el mismo proyecto y la comparativa entre sprints se vuelve ruido (peras vs manzanas). Si necesitas la nueva fórmula también en lo viejo, debes re-editar cada tarea manualmente. Por eso conviene definir bien al inicio." },
        { label: "Errores comunes", text: "1) Subir 'urgencia' al 50 porque 'siempre hay urgencias' — todo se vuelve urgente y nada destaca. 2) Crear 10 dimensiones — el equipo no las llena bien, dejan valor default 5 y la calculadora se vuelve ruido. 3) Cambiar pesos cuando un participante se queja de no aparecer arriba: estás corrigiendo el síntoma, no la causa." },
        { label: "Tip pro (SM)", text: "Como SM tu rol con la calculadora es CUSTODIO, no reformador. Ayuda al PO a definirla al kick-off, defiéndela cuando alguien quiera cambiarla a mitad de sprint, y úsala en retro para identificar tareas mal estimadas (valor real vs valor declarado). Si DE VERDAD necesitas medir algo nuevo, AGREGAR una dimensión nueva rompe menos que reajustar pesos viejos." },
      ],
    },
    {
      tab: "config",
      target: '[data-tour="config-fields"]',
      emoji: "🧬",
      title: "Campos personalizados de la tarjeta",
      body: "Si tu proyecto necesita campos extras en cada tarea (ej. presupuesto, riesgo regulatorio, link a Jira), créalos aquí. Eliges tipo (texto, select, fecha, multiselect, subitems) y si se muestra en la tarjeta. Quitar un campo conserva los datos históricos.",
    },
    {
      tab: "config",
      target: '[data-tour="config-reports"]',
      emoji: "📬",
      title: "Reportes IA por correo",
      body: "Tres tarjetas: Scrum bi-semanal (mié+vie 8am), Semanal del PO (lun 8am) y Mensual del equipo (1er lun del mes). Cada uno con su lista de destinatarios y switch on/off. Botón 'Enviar ahora' para disparar manualmente y previsualizar.",
    },
    {
      emoji: "🎉",
      title: "¡Listo, Scrum Master!",
      body: "Ya viste tu zona de control completa. Recuerda: tu rol no es asignar trabajo, es proteger al equipo de bloqueos y mantener el ritmo. Si los reportes empiezan a llegar y los indicadores se mueven, vas bien. Mucha suerte.",
    },
  ],
  po: [
    {
      emoji: "👔",
      title: "Hola, Product Owner",
      body: "Te voy a llevar 7 paradas por las features que más vas a usar. Si tienes plan Pro o Enterprise, hay análisis IA poderosos esperándote.",
    },
    {
      tab: "board",
      target: '[data-tour="tab-board"]',
      emoji: "📋",
      title: "Tablero: el estado real",
      body: "Cada tarea tiene un cálculo automático de aporte (dificultad × impacto × estratégico). Esto te da una vista honesta de quién genera valor — no quién está más ocupado.",
    },
    {
      tab: "metrics",
      target: '[data-tour="tab-metrics"]',
      emoji: "📊",
      title: "Métricas: tu radar",
      body: "Velocidad, distribución de carga por persona, dimensiones del aporte. Aquí detectas sobrecargas, subutilizaciones y desbalances antes de que se conviertan en problema.",
    },
    {
      tab: "okrs",
      target: '[data-tour="tab-okrs"]',
      emoji: "🧭",
      title: "OKRs: tu compromiso del trimestre",
      body: "Los OKRs son tu responsabilidad principal. Define qué quieres mover (3-4 KRs máximo) y vincula cada tarea a su KR para ver progreso automático.",
    },
    {
      tab: "evolution",
      target: '[data-tour="tab-evolution"]',
      emoji: "💎",
      title: "Evolutivo bimensual (Pro Power+)",
      body: "Cada 60 días generas tarjetas profesionales individuales: cifras + sentimiento + comparativa vs período anterior + reconocimiento social del equipo. Oro puro para tus 1:1.",
    },
    {
      tab: "chat",
      target: '[data-tour="tab-chat"]',
      emoji: "💬",
      title: "Chat IA (Enterprise)",
      body: "Conversación en vivo con un consultor de talento que tiene cargados tus reportes, evolutivos y estado actual. Pregúntale '¿quién está sobrecargado?' o 'arma una célula para X' y responde con evidencia. Tienes cuota de 100 mensajes/mes/proyecto.",
    },
    {
      tab: "pulse",
      target: '[data-tour="tab-pulse"]',
      emoji: "🌡",
      title: "Pulso del equipo",
      body: "Después de cada sprint, los participantes responden una mini-retro. Aquí ves el agregado: cómo se sintieron, quiénes destacaron, quiénes la pasaron difícil. Información honesta y anónima.",
    },
    {
      tab: "config",
      target: '[data-tour="tab-config"]',
      emoji: "⚙️",
      title: "Configuración: tu cuarto de máquinas",
      body: "Aquí defines cómo se mide y se comunica el proyecto: invitas gente, ajustas la calculadora de aporte, conectas indicadores con tareas y eliges qué reportes IA salen y a quién. Lo que decidas aquí impacta cada métrica de tu radar.",
    },
    {
      tab: "config",
      target: '[data-tour="config-project"]',
      emoji: "🏗️",
      title: "Proyecto + invitar al equipo",
      body: "Datos básicos del proyecto. Aquí también está el campo para invitar gente por email (envía un correo con código de 6 dígitos) y el código de invitación general que puedes compartir por Slack/WhatsApp para que se unan más rápido.",
    },
    {
      tab: "config",
      target: '[data-tour="config-people"]',
      emoji: "👥",
      title: "Participantes",
      body: "Quien está dentro del proyecto. Cuando creas una tarea, su 'Responsable' sale de esta lista. Puedes marcar a alguien como super-usuario si quieres que tenga permisos especiales.",
    },
    {
      tab: "config",
      target: '[data-tour="config-indicators"]',
      emoji: "📊",
      title: "Indicadores clave del proyecto",
      body: "Aquí defines los KPIs que vas a mover (ej. NPS, conversión, retención). Las tareas se pueden etiquetar con su indicador asociado, y los reportes IA te muestran cuánto de cada KR/indicador empujó cada persona. Conéctalo con tus OKRs.",
    },
    {
      tab: "config",
      target: '[data-tour="config-types"]',
      emoji: "🧩",
      title: "Tipos de tarea",
      body: "Categorías por defecto: Estratégica, Operativa, Técnica, Diseño, etc. Tu evolutivo bimensual segmenta por tipo para detectar gente atascada en operativo cuando deberían estar en estratégico. Personalízalos a tu industria.",
    },
    {
      tab: "config",
      target: '[data-tour="config-calculator"]',
      emoji: "⚖️",
      title: "Calculadora de Aporte (el motor del proyecto)",
      body: [
        { label: "Qué es", text: "Una fórmula para valorar cada tarea con un solo número: el Valor de Aporte. Suma ponderada de dimensiones que TÚ defines. Vienen 3 por defecto (Tiempo, Dificultad, Impacto Estratégico) pero puedes AGREGAR cuantas necesites — riesgo regulatorio, impacto en cliente, alineación con OKR, complejidad técnica — o QUITAR las que no apliquen. La calculadora se adapta a tu industria, no al revés." },
        { label: "Cómo funciona el cálculo", text: "Cada dimensión tiene un peso 1-100; idealmente la suma de pesos da 100. Cada tarea recibe un valor 1-10 por dimensión. Aporte = suma(valor × peso) / 100. Ejemplo concreto: con pesos Tiempo=30, Dificultad=30, Estratégico=40, una tarea con valores 7/8/10 vale (7×30 + 8×30 + 10×40)/100 = 8.5 puntos. Otra trivial 3/2/4 = 3.1 puntos. Ese gap es lo que tu radar de métricas y tu evolutivo van a explotar." },
        { label: "Qué pasa con las tareas viejas cuando cambias pesos", text: "Detalle CRÍTICO que la gente entiende mal: cada tarea guarda su aporte calculado al crearla o editarla (un snapshot congelado). Cambiar los pesos NO recalcula el histórico — las tareas viejas quedan con la fórmula vieja, las nuevas con la nueva. Resultado: tu reporte mensual va a comparar peras (mes pasado, pesos viejos) con manzanas (este mes, pesos nuevos). La comparativa entre periodos se rompe. Si necesitas la nueva fórmula en lo viejo, hay que re-editar cada tarea manualmente." },
        { label: "Errores comunes", text: "1) Poner todos los pesos en 100 pensando 'todo es importante' — pierde poder de jerarquización. 2) Definir 10 dimensiones — el equipo no las llena, dejan valor default 5 y la calculadora se vuelve ruido sin diferenciación. 3) Cambiar pesos a mitad de proyecto buscando 'mejorar la fórmula' — rompes la comparativa de tu propio reporte mensual y el evolutivo bimensual pierde su línea base." },
        { label: "Tip pro (PO)", text: "Define los pesos en el kick-off CON el equipo (no en privado), déjalos quietos durante el proyecto y revísalos UNA VEZ por cuarto si la estrategia cambia. Si necesitas medir algo nuevo, AGREGAR una dimensión nueva rompe menos que reasignar pesos viejos — las tareas viejas se quedan con valor default 5 en la nueva dimensión y la diferencia se diluye en el promedio. Si decides recalcular el histórico, planéalo: avisa al equipo, hazlo en una semana de pocas tareas y verifica el impacto en las personas con más tareas finalizadas." },
      ],
    },
    {
      tab: "config",
      target: '[data-tour="config-fields"]',
      emoji: "🧬",
      title: "Campos personalizados de la tarjeta",
      body: "Si tu proyecto necesita capturar datos extras en cada tarea (presupuesto, riesgo, link externo, owner secundario), créalos aquí. Soportan texto, fecha, select, multiselect y subitems. Marca 'mostrar en tarjeta' para que aparezcan en el board. Borrar un campo conserva los datos históricos.",
    },
    {
      tab: "config",
      target: '[data-tour="config-reports"]',
      emoji: "📬",
      title: "Reportes IA: tu motor de insights",
      body: "Tres tarjetas: Scrum bi-semanal, Semanal del PO (este es TU reporte), Mensual del equipo. Cada uno con destinatarios + switch on/off + 'Enviar ahora' para previsualizar. El semanal y mensual son los que vas a leer religiosamente como PO.",
    },
    {
      emoji: "🎉",
      title: "¡Listo, PO!",
      body: "Tip final: los reportes IA salen automáticamente (semanal lunes 8am, mensual primer lunes del mes). Léelos como si te los dictara un consultor — están construidos para eso. Y revisa la Calculadora UNA VEZ al inicio: estabilidad ahí = confianza del equipo.",
    },
  ],
  participant: [
    {
      emoji: "💪",
      title: "Hola, equipo",
      body: "Tu día arranca aquí. Te muestro las 5 cosas que necesitas saber para fluir sin fricción.",
    },
    {
      tab: "focus",
      target: '[data-tour="tab-focus"]',
      emoji: "☀️",
      title: "Mi Día: tu base de operaciones",
      body: "Aquí ves SOLO lo tuyo, ordenado por prioridad. Es donde empieza tu día. Si está vacío, pídele al PO o al SM que te asignen.",
    },
    {
      emoji: "✅",
      title: "Mueve las tareas conforme avanzas",
      body: "Cada tarea tiene 4 estados: Pendiente → En proceso → En revisión → Finalizada. Cámbialos en tiempo real. Esto alimenta los reportes y el pulso del equipo.",
    },
    {
      emoji: "💬",
      title: "Comenta tus avances (es tu bitácora)",
      body: "Cuando avances algo, ponlo como comentario en la tarea. Esto es ORO: la IA usa estos comentarios para entender qué hiciste y por qué. Sin comentarios = pasas invisible en los reportes.",
    },
    {
      tab: "board",
      target: '[data-tour="tab-board"]',
      emoji: "📋",
      title: "Tablero general (opcional)",
      body: "Si quieres ver qué hace el resto del equipo, aquí está todo. Útil para entender dependencias o saber a quién pedirle ayuda.",
    },
    {
      emoji: "📝",
      title: "Retrospectiva al cerrar el sprint",
      body: "Cuando cierre el sprint te llegará un banner: tienes 7 días para responder 5 minutos (emoji + 2 párrafos + 3 señalizaciones a compañeros). Sé honesto — las señalizaciones son anónimas en la vista del PO.",
    },
    {
      emoji: "🎉",
      title: "¡Eso es todo!",
      body: "Si te trabas en algo: comenta en la tarea con un @ a quien pueda ayudarte. El Scrum Master verá la alerta. Bienvenido al equipo.",
    },
  ],
};

// ─── Componente principal ───────────────────────────────────
// enabled=false pausa el modal y el tour. Útil mientras la pantalla
// de "Elegir proyecto" está visible o durante el spinner de carga.
//
// El rol se lee de project_members.role (vía RPC my_role_in_project) para
// el projectId actual. Owner=PO por defecto; los invitados llegan como
// 'participant'. Cambios de rol los hace el owner desde Configuración
// (esto resetea el progreso del tour vía set_project_member_role).
//
// Estado del tour (current_step, completed_at) sigue siendo global por
// usuario en user_onboarding — switch entre proyectos con roles distintos
// NO replaya el tour automáticamente; el usuario lo lanza con "🎓 Tour".
export default function Onboarding({ supabase, authUser, activeTab, setActiveTab, forceOpen, onForceHandled, enabled = true, projectId }) {
  const [state, setState] = useState(null);
  const [role, setRole] = useState(null);  // de project_members
  const [shouldShowTour, setShouldShowTour] = useState(false);

  const showTour = enabled && shouldShowTour && !!role && !!TOUR_SCRIPTS[role];

  // Carga estado global (current_step, completed_at) + role del proyecto actual.
  useEffect(() => {
    if (!authUser?.id || !supabase || !projectId) return;
    let cancelled = false;
    (async () => {
      const [{ data: onboardData }, { data: roleData }] = await Promise.all([
        supabase.from("user_onboarding").select("*").eq("user_id", authUser.id).maybeSingle(),
        supabase.rpc("my_role_in_project", { p_project_id: projectId }),
      ]);
      if (cancelled) return;

      const r = (typeof roleData === "string") ? roleData : null;
      setRole(r);

      if (!onboardData) {
        setState({ current_step: 0, completed_at: null, skipped: false });
        if (r && TOUR_SCRIPTS[r]) setShouldShowTour(true);
      } else {
        setState(onboardData);
        if (!onboardData.completed_at && !onboardData.skipped && r && TOUR_SCRIPTS[r]) {
          setShouldShowTour(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authUser?.id, projectId]);

  // Soporte para "Volver a ver tour" desde el botón externo.
  useEffect(() => {
    if (!forceOpen) return;
    if (role && TOUR_SCRIPTS[role]) {
      patch({ current_step: 0, completed_at: null, skipped: false });
      setShouldShowTour(true);
    }
    onForceHandled?.();
  }, [forceOpen]);

  const patch = async (changes) => {
    setState(prev => ({ ...(prev || {}), ...changes }));
    if (!authUser?.id || !supabase) return;
    await supabase.from("user_onboarding").upsert({ user_id: authUser.id, ...changes }, { onConflict: "user_id" });
  };

  const skipOnboarding = async () => {
    await patch({ skipped: true });
    setShouldShowTour(false);
  };

  const finishTour = async () => {
    await patch({ completed_at: new Date().toISOString(), skipped: false });
    setShouldShowTour(false);
  };

  const setStep = async (n) => {
    await patch({ current_step: Math.max(0, n) });
  };

  if (!authUser) return null;

  return (
    <>
      {showTour && (
        <TourOverlay
          role={role}
          script={TOUR_SCRIPTS[role]}
          step={state?.current_step ?? 0}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onNext={() => {
            const next = (state?.current_step ?? 0) + 1;
            if (next >= TOUR_SCRIPTS[role].length) finishTour();
            else setStep(next);
          }}
          onBack={() => setStep((state?.current_step ?? 0) - 1)}
          onSkip={skipOnboarding}
        />
      )}
    </>
  );
}

// ─── Welcome modal ────────────────────────────────────────────
// ─── Tour overlay con spotlight ─────────────────────────────
function TourOverlay({ role, script, step, activeTab, setActiveTab, onNext, onBack, onSkip }) {
  const current = script[step];
  const r = ROLES[role];
  const [rect, setRect] = useState(null);
  const tooltipRef = useRef(null);

  // Si el paso requiere una tab específica, cámbiala primero.
  useEffect(() => {
    if (current?.tab && current.tab !== activeTab) setActiveTab(current.tab);
  }, [step, current?.tab, activeTab, setActiveTab]);

  // Recalcula posición del target cuando cambia el paso o se hace scroll/resize.
  useLayoutEffect(() => {
    if (!current?.target) { setRect(null); return; }
    let attempts = 0;
    const tryFind = () => {
      const el = document.querySelector(current.target);
      if (el) {
        const r2 = el.getBoundingClientRect();
        setRect({ top: r2.top, left: r2.left, width: r2.width, height: r2.height });
        // Asegura visibilidad
        if (r2.top < 0 || r2.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
      attempts += 1;
      if (attempts < 10) setTimeout(tryFind, 80);
    };
    tryFind();

    const onScrollOrResize = () => {
      const el = document.querySelector(current.target);
      if (el) {
        const r2 = el.getBoundingClientRect();
        setRect({ top: r2.top, left: r2.left, width: r2.width, height: r2.height });
      }
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [step, current?.target]);

  const isLast = step === script.length - 1;
  const isFirst = step === 0;

  // Posición del tooltip. Width crece a 440 para los pasos densos (body con
  // secciones etiquetadas). Si el contenido es largo, el body interno hace
  // scroll, así que la altura asumida no necesita ser perfecta.
  const isDeep = Array.isArray(current.body);
  let tooltipStyle = {};
  if (rect) {
    const pad = 12;
    const tooltipW = isDeep ? 440 : 360;
    const assumedH = isDeep ? 420 : 240;
    const spaceBelow = window.innerHeight - (rect.top + rect.height);
    const spaceAbove = rect.top;
    const placeBelow = spaceBelow >= assumedH || spaceBelow >= spaceAbove;
    let top = placeBelow ? rect.top + rect.height + pad : Math.max(20, rect.top - assumedH - pad);
    let left = rect.left + rect.width / 2 - tooltipW / 2;
    if (top < 20) top = 20;
    if (top + assumedH > window.innerHeight - 20) top = Math.max(20, window.innerHeight - assumedH - 20);
    left = Math.max(16, Math.min(window.innerWidth - tooltipW - 16, left));
    tooltipStyle = { position: "fixed", top, left, width: tooltipW, maxHeight: `${window.innerHeight - 40}px` };
  } else {
    tooltipStyle = {
      position: "fixed", top: "50%", left: "50%",
      transform: "translate(-50%, -50%)", width: isDeep ? 520 : 460,
      maxHeight: `${window.innerHeight - 60}px`,
    };
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99998, pointerEvents: "none" }}>
      <style>{`
        @keyframes wpSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes wpPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.4); } 50% { box-shadow: 0 0 0 8px rgba(255,255,255,0); } }
      `}</style>
      {/* Backdrop con 4 paneles cubriendo todo menos el target */}
      {rect ? (
        <>
          <div style={panelStyle(0, 0, "100vw", rect.top)} />
          <div style={panelStyle(0, rect.top, rect.left, rect.height)} />
          <div style={panelStyle(rect.left + rect.width, rect.top, `calc(100vw - ${rect.left + rect.width}px)`, rect.height)} />
          <div style={panelStyle(0, rect.top + rect.height, "100vw", `calc(100vh - ${rect.top + rect.height}px)`)} />
          {/* Borde brillante alrededor del target */}
          <div style={{
            position: "fixed",
            top: rect.top - 4, left: rect.left - 4,
            width: rect.width + 8, height: rect.height + 8,
            borderRadius: 10,
            boxShadow: `0 0 0 3px ${r.color}, 0 0 24px ${r.color}`,
            animation: "wpPulse 1.6s ease infinite",
            pointerEvents: "none",
          }} />
        </>
      ) : (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(13,13,26,0.75)",
          backdropFilter: "blur(2px)", pointerEvents: "auto",
        }} />
      )}

      {/* Tooltip */}
      <div ref={tooltipRef} style={{
        ...tooltipStyle,
        background: "#fff", borderRadius: 14, padding: 20,
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        pointerEvents: "auto",
        animation: "wpSlideUp 0.3s ease",
        border: `2px solid ${r.color}`,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: r.gradient, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0,
          }}>{current.emoji || r.emoji}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: r.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {r.label} · Paso {step + 1} de {script.length}
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#1e1e3a", lineHeight: 1.3 }}>
              {current.title}
            </div>
          </div>
        </div>

        {/* Body — soporta string simple o array de secciones {label, text} */}
        <div style={{ marginBottom: 16, overflowY: "auto", maxHeight: "55vh", paddingRight: 4 }}>
          {Array.isArray(current.body) ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {current.body.map((sec, i) => (
                typeof sec === "string" ? (
                  <p key={i} style={{ margin: 0, fontSize: 13, color: "#444", lineHeight: 1.55 }}>{sec}</p>
                ) : (
                  <div key={i} style={{ borderLeft: `3px solid ${r.color}`, paddingLeft: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: r.color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                      {sec.label}
                    </div>
                    <div style={{ fontSize: 13, color: "#444", lineHeight: 1.5 }}>{sec.text}</div>
                  </div>
                )
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13.5, color: "#444", lineHeight: 1.55 }}>{current.body}</p>
          )}
        </div>

        {/* Progress dots */}
        <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 16 }}>
          {script.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 24 : 6, height: 6, borderRadius: 3,
              background: i === step ? r.color : i < step ? `${r.color}80` : "#e0e0e0",
              transition: "all 0.3s",
            }} />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={onSkip} style={{
            background: "none", border: "none", color: "#999", fontSize: 11,
            cursor: "pointer", textDecoration: "underline", fontFamily: "inherit",
          }}>
            Saltar tour
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {!isFirst && (
              <button onClick={onBack} style={{
                background: "#f4f4f4", border: "none", borderRadius: 8,
                padding: "8px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600,
                color: "#666", fontFamily: "inherit",
              }}>
                ← Anterior
              </button>
            )}
            <button onClick={onNext} style={{
              background: r.gradient, color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 18px", cursor: "pointer", fontSize: 12, fontWeight: 700,
              fontFamily: "inherit",
            }}>
              {isLast ? "Terminar 🎉" : "Siguiente →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function panelStyle(left, top, width, height) {
  return {
    position: "fixed",
    left: typeof left === "number" ? `${left}px` : left,
    top: typeof top === "number" ? `${top}px` : top,
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
    background: "rgba(13,13,26,0.72)",
    backdropFilter: "blur(2px)",
    pointerEvents: "auto",
    transition: "all 0.2s ease",
  };
}
