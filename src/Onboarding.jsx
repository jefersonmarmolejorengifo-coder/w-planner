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
      title: "Calculadora de Aporte (clave)",
      body: "El corazón del sistema: define los pesos de las 4 dimensiones (Dificultad, Impacto, Estratégico, Urgencia). El aporte de cada tarea = suma ponderada. Cambiar pesos recalcula TODO. Mantén estable después de configurar — el equipo necesita previsibilidad.",
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
      title: "Calculadora de Aporte (no la toques sin razón)",
      body: "El motor secreto: cuatro dimensiones (Dificultad, Impacto, Estratégico, Urgencia) con pesos 1-10. El aporte de cada tarea = suma ponderada. CAMBIAR PESOS RECALCULA TODO el histórico. Define el balance al inicio del proyecto y déjalo quieto — la previsibilidad del equipo depende de eso.",
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
// de "Elegir proyecto" está visible (los tabs no son interactivos aún)
// o durante el spinner de carga.
export default function Onboarding({ supabase, authUser, activeTab, setActiveTab, forceOpen, onForceHandled, enabled = true }) {
  const [state, setState] = useState(null);
  const [shouldShowWelcome, setShouldShowWelcome] = useState(false);
  const [shouldShowTour, setShouldShowTour] = useState(false);

  // Solo renderiza cuando enabled. Mientras esté pausado el componente queda
  // dormido y reanuda en el mismo paso cuando enabled vuelve a true.
  const showWelcome = enabled && shouldShowWelcome;
  const showTour = enabled && shouldShowTour;

  // Carga estado al montar.
  useEffect(() => {
    if (!authUser?.id || !supabase) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("user_onboarding").select("*").eq("user_id", authUser.id).maybeSingle();
      if (cancelled) return;
      if (!data) {
        setShouldShowWelcome(true);
        setState({ role: null, current_step: 0, completed_at: null, skipped: false });
      } else {
        setState(data);
        if (!data.completed_at && !data.skipped) {
          if (!data.role) setShouldShowWelcome(true);
          else setShouldShowTour(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authUser?.id]);

  // Soporte para "Volver a ver tour" desde menú externo.
  useEffect(() => {
    if (!forceOpen) return;
    if (!state?.role) setShouldShowWelcome(true);
    else { setShouldShowTour(true); patch({ current_step: 0, completed_at: null, skipped: false }); }
    onForceHandled?.();
  }, [forceOpen]);

  const patch = async (changes) => {
    setState(prev => ({ ...(prev || {}), ...changes }));
    if (!authUser?.id || !supabase) return;
    await supabase.from("user_onboarding").upsert({ user_id: authUser.id, ...changes }, { onConflict: "user_id" });
  };

  const selectRole = async (role) => {
    await patch({ role, current_step: 0, started_at: new Date().toISOString(), completed_at: null, skipped: false });
    setShouldShowWelcome(false);
    setShouldShowTour(true);
  };

  const skipOnboarding = async () => {
    await patch({ skipped: true });
    setShouldShowWelcome(false);
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
      {showWelcome && (
        <WelcomeModal
          onSelect={selectRole}
          onSkip={skipOnboarding}
        />
      )}
      {showTour && state?.role && TOUR_SCRIPTS[state.role] && (
        <TourOverlay
          role={state.role}
          script={TOUR_SCRIPTS[state.role]}
          step={state.current_step ?? 0}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onNext={() => {
            const next = (state.current_step ?? 0) + 1;
            if (next >= TOUR_SCRIPTS[state.role].length) finishTour();
            else setStep(next);
          }}
          onBack={() => setStep((state.current_step ?? 0) - 1)}
          onSkip={skipOnboarding}
        />
      )}
    </>
  );
}

// ─── Welcome modal ────────────────────────────────────────────
function WelcomeModal({ onSelect, onSkip }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(13,13,26,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100000, backdropFilter: "blur(4px)",
      animation: "wpFadeIn 0.25s ease",
    }}>
      <style>{`
        @keyframes wpFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wpSlideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes wpPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.4); } 50% { box-shadow: 0 0 0 8px rgba(255,255,255,0); } }
      `}</style>
      <div style={{
        background: "#fff", borderRadius: 20, padding: 36, maxWidth: 720, width: "92%",
        boxShadow: "0 24px 80px rgba(0,0,0,0.4)", animation: "wpSlideUp 0.4s ease",
      }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 56, marginBottom: 10 }}>👋</div>
          <h2 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1e1e3a" }}>Bienvenida/o a Productivity-Plus</h2>
          <p style={{ margin: "10px 0 0", color: "#666", fontSize: 15, lineHeight: 1.5 }}>
            Antes de arrancar, cuéntame qué rol cumples — para mostrarte solo lo que importa para ti.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {Object.entries(ROLES).map(([key, r]) => (
            <button key={key} onClick={() => onSelect(key)} style={{
              background: r.gradient, color: "#fff", border: "none", borderRadius: 16,
              padding: "26px 18px", cursor: "pointer", textAlign: "center",
              transition: "all 0.2s", fontFamily: "inherit",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 12px 30px rgba(0,0,0,0.25)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{ fontSize: 48, marginBottom: 8 }}>{r.emoji}</div>
              <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 6 }}>{r.label}</div>
              <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.4 }}>{r.pitch}</div>
            </button>
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: 22 }}>
          <button onClick={onSkip} style={{
            background: "none", border: "none", color: "#888", fontSize: 12,
            cursor: "pointer", textDecoration: "underline", fontFamily: "inherit",
          }}>
            Quizás más tarde
          </button>
          <div style={{ fontSize: 10, color: "#bbb", marginTop: 4 }}>
            Puedes volver a ver el tour desde el menú de usuario.
          </div>
        </div>
      </div>
    </div>
  );
}

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

  // Posición del tooltip
  let tooltipStyle = {};
  if (rect) {
    const pad = 12;
    const tooltipW = 360;
    const tooltipH = 220;
    let top = rect.top + rect.height + pad;
    let left = rect.left + rect.width / 2 - tooltipW / 2;
    // Si no cabe abajo, posiciona arriba
    if (top + tooltipH > window.innerHeight - 20) top = rect.top - tooltipH - pad;
    if (top < 20) top = 20;
    left = Math.max(16, Math.min(window.innerWidth - tooltipW - 16, left));
    tooltipStyle = { position: "fixed", top, left, width: tooltipW };
  } else {
    // Modal centrado para pasos sin target
    tooltipStyle = {
      position: "fixed", top: "50%", left: "50%",
      transform: "translate(-50%, -50%)", width: 460,
    };
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 99998, pointerEvents: "none" }}>
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

        {/* Body */}
        <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "#444", lineHeight: 1.55 }}>
          {current.body}
        </p>

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
