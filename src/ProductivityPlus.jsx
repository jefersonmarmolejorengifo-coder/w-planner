import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import { useBreakpoint } from './hooks/useBreakpoint';
// La versión que muestra el footer sale de package.json (fuente única de verdad).
// Bumpéala ahí siguiendo SemVer (MAYOR.MENOR.PARCHE) y el footer se actualiza solo.
// Named import → Vite hace tree-shaking y solo entra `version` al bundle.
import { version as APP_VERSION } from "../package.json";
import { supabase } from './supabaseClient';
import { STATUS_COLORS, STATUS_LIGHT, ESTADOS, DEFAULT_TASK_TYPES } from './constants';
import { getUserColor, getInitials } from './lib/format';
import { CustomFieldsRenderer } from './lib/CustomFieldsRenderer';
import { joinProjectByCode } from './lib/joinProject';

// Pantallas extraídas a src/screens/ (refactor H-002 fase E).
import AuthScreen from './screens/AuthScreen';
import UserSelectScreen from './screens/UserSelectScreen';
import IntroScreen from './screens/IntroScreen';
import ProjectLandingScreen from './screens/ProjectLandingScreen';

// Componentes de header extraídos a sus features (refactor H-002 fase E).
import PlansLauncher from './features/billing/PlansLauncher';
import BoardSummaryPill from './features/board/BoardSummaryPill';

// Paneles pesados cargados bajo demanda (H-002, code-splitting con React.lazy):
// salen del bundle inicial y se descargan solo cuando el usuario los abre.
// PlanSelectionModal y ConsolidatedDashboard se importan ahora en sus componentes propios (PlansLauncher, ProjectLandingScreen).
const SuperTasksTab = lazy(() => import('./features/tasks/SuperTasksTab'));
const FocusTab = lazy(() => import('./features/focus/FocusTab'));
const EvolutionTab = lazy(() => import('./features/evolution/EvolutionTab'));
const ChatEnterpriseTab = lazy(() => import('./features/chat/ChatEnterpriseTab'));
const OKRsTab = lazy(() => import('./features/okrs/OKRsTab'));
const DependenciesTab = lazy(() => import('./features/deps/DependenciesTab'));
const SprintsTab = lazy(() => import('./features/sprints/SprintsTab'));
const MetricsTab = lazy(() => import('./features/metrics/MetricsTab'));
const PresentationTab = lazy(() => import('./features/presentation/PresentationTab'));
const ConfigTab = lazy(() => import('./features/config/ConfigTab'));
const BoardTab = lazy(() => import('./features/board/BoardTab'));
const GanttTab = lazy(() => import('./features/board/GanttTab'));
const TeamPulseTab = lazy(() => import('./features/team/TeamPulseTab'));
import Onboarding from './Onboarding';
import NameCaptureModal from './NameCaptureModal';
import { useProjectData } from './hooks/useProjectData';
import { usePresence } from './hooks/usePresence';
import { useReferralCapture } from './hooks/useReferralCapture';
import { useReferralSync } from './hooks/useReferralSync';

// getAuthJsonHeaders vive ahora en ./lib/authHeaders (importado arriba).
// joinProjectByCode vive ahora en ./lib/joinProject (importado arriba). H-002 fase E.

// STATUS_COLORS/STATUS_LIGHT/TIPOS/DEFAULT_TASK_TYPES/ESTADOS viven en ./constants.
// TYPE_COLORS (solo lo usaba MetricsTab) vive ahora en su feature.
// CLOSE_STATES vive ahora en ./features/board/TaskForm (privado de TaskForm). H-002.
// DEFAULT_PIN era dead code; eliminado en H-002 fase E.
// DEFAULT_DIMENSIONS vive ahora en ./lib/aporte (importado arriba). H-002.

// getColombiaNow vive ahora en ./lib/format (importado arriba).

// daysBetween (solo lo usaba MetricsTab) vive ahora en su feature.

// emptyTask, formatCardCustomField, TaskCard, TaskCardWithClick, Modal, BoardTab
// y GanttTab viven ahora en ./features/board/* y se cargan con React.lazy
// (BoardTab arrastra a TaskForm a su chunk). H-002, núcleo fase C.

// MetricsSection/MetricCard/MetricRow/MetricsTab viven ahora en
// ./features/metrics/MetricsTab y se cargan con React.lazy. H-002.
// (MetricsTab extraído a ./features/metrics/MetricsTab — ver lazy import.)

// ─── DimensionEditor ───────────────────────────────────────
// DimensionEditor vive ahora en ./features/config/DimensionEditor (importado para ConfigTab). H-002.

// ConfigSection vive ahora en ./lib/ConfigSection (importado arriba). H-002.

// FieldDefEditor (+ FIELD_TYPE_LABELS/FIELD_TYPE_HINTS) vive ahora en
// ./features/config/FieldDefEditor (importado para ConfigTab). H-002.

// ─── ReportsConfigSection ──────────────────────────────────
// Reemplaza la antigua "Reporte IA por correo" por 3 cards independientes:
// Scrum bi-semanal, Semanal PO y Mensual del Equipo.
// Cada uno con destinatarios, schedule y botón de envío manual independientes.
// Persiste en report_configs (migración 012).
// PremiumPanel vive ahora en ./features/config/PremiumPanel (importado para ConfigTab). H-002.

// REPORT_TYPES + DAY_NAMES_ES + ReportsConfigSection + ReportCard viven ahora en
// ./features/config/ReportsConfigSection (importado para ConfigTab). H-002.

// (ReportCard extraído junto con ReportsConfigSection — ver import.)

// ─── ConfigTab ─────────────────────────────────────────────
// ConfigTab vive ahora en ./features/config/ConfigTab y se carga con
// React.lazy (ver bloque de imports). Última fase de la descomposición de
// ConfigTab (H-002). RoleAssignmentSection, ConfigSection, los editores y
// ReportsConfigSection migraron con él.

// ─── AuthScreen ───────────────────────────────────────────
// AuthScreen vive ahora en ./screens/AuthScreen (importado arriba). H-002 fase E.

// ─── UserSelectScreen ─────────────────────────────────────
// UserSelectScreen vive ahora en ./screens/UserSelectScreen (importado arriba). H-002 fase E.
// getUserColor / getInitials viven en ./lib/format (importados allá).

// ─── IntroScreen ───────────────────────────────────────────
// IntroScreen vive ahora en ./screens/IntroScreen (importado arriba). H-002 fase E.

// ─── ProjectLandingScreen ──────────────────────────────────
// ProjectLandingScreen vive ahora en ./screens/ProjectLandingScreen (importado arriba). H-002 fase E.
// ReportViewerDialog vive en ./features/board/BoardSummaryPill (privado).
// BoardSummaryPill vive en ./features/board/BoardSummaryPill (importado arriba). H-002 fase E.
// PlansLauncher vive en ./features/billing/PlansLauncher (importado arriba). H-002 fase E.
// TASK_DONE / TASK_BLOCKED movidos a ./features/board/BoardSummaryPill (privados). H-002 fase E.

// ConsolidatedDashboard vive ahora en ./features/dashboard/ConsolidatedDashboard
// y se carga con React.lazy (ver import arriba). H-002.
// ReportViewerDialog vive ahora en ./features/board/BoardSummaryPill (privado). H-002 fase E.
// BoardSummaryPill vive ahora en ./features/board/BoardSummaryPill (importado arriba). H-002 fase E.

// (ProjectLandingScreen eliminado de aquí — vive en ./screens/ProjectLandingScreen) H-002 fase E.

// parseDeps vive ahora en ./lib/deps (importado arriba). DependenciesTab y
// computeDepLayout viven en ./features/deps/DependenciesTab (lazy). H-002.
// DependenciesTab + computeDepLayout viven ahora en
// ./features/deps/DependenciesTab y se cargan con React.lazy. H-002.

// ─── OKRsTab ───────────────────────────────────────────────
// OKRsTab vive ahora en ./features/okrs/OKRsTab y se carga con React.lazy
// (ver import arriba). H-002.

// ─── SprintsTab ────────────────────────────────────────────
// SprintsTab vive ahora en ./features/sprints/SprintsTab y se carga con
// React.lazy (ver import arriba). H-002.

// ─── PresentationTab (Presentación Sprint) ────────────────
// Vista enfocada en un participante. Por defecto usa el grafo de
// dependencias (mismo motor que Red de Tareas) para mostrar quién depende
// de quién y permitir al participante explicar su flujo. Al filtrar por
// persona, las tareas ajenas se ven en gris suave (sin resaltar pero
// identificables). Click en un nodo muestra el detalle rico (resumen,
// entregable, comentarios, subtareas, custom fields opt-in). También
// ofrece un modo "cuadrícula" para listas grandes.
// PresentationTab/PresentationGraph/StatCard viven ahora en
// ./features/presentation/PresentationTab y se cargan con React.lazy. H-002.

// PresentationCard + LinkedTaskChip viven ahora en
// ./features/presentation/PresentationCard (importado para SuperTaskExpanded). H-002.

// ─── SuperTaskJar ──────────────────────────────────────────
// Jarrón SVG llenándose según % de aporte cerrado. La franja superior
// muestra "gotas" de cada sprint que contribuye, cada una con su color.
// ─── SuperTaskJar ──────────────────────────────────────────
// SuperTaskJar/SuperTaskExpanded/SuperTasksTab viven ahora en
// ./features/tasks/SuperTasksTab y se cargan con React.lazy. H-002.
// SuperTasksTab extraído a ./features/tasks/SuperTasksTab (lazy). H-002.

// ─── SuperTaskCreatorModal ─────────────────────────────────
// SuperTaskCreatorModal vive ahora en ./features/tasks/SuperTaskCreatorModal y se
// carga con React.lazy (ver import arriba). H-002.

// ─── EvolutionTab (Evolutivo profesional) ─────────────────
// Solo accesible si project_can_use_evolutivo === true (Pro Power+ con IA
// activa). Owner ve histórico de evolutivos bimensuales, puede generar uno
// nuevo. Renderiza el HTML embebido en un iframe sandboxed para aislar
// estilos.
// EvolutionTab vive ahora en ./features/evolution/EvolutionTab y se carga con
// React.lazy (ver import arriba). H-002.

// ─── ChatEnterpriseTab ─────────────────────────────────────
// Chat en vivo del PO con la IA cargada con datos del equipo. Feature
// Enterprise. Cada proyecto tiene su propia sesión activa por owner.
// Persiste todo el historial en chat_messages.
// ChatEnterpriseTab vive ahora en ./features/chat/ChatEnterpriseTab y se carga
// con React.lazy (ver import arriba). H-002.

// ─── PendingRetrosBanner ───────────────────────────────────
// Bloqueo blando: si hay sprints cerrados con retro pendiente para este
// usuario, aparece un banner en Mi Día. Click → modal para responder.
// PendingRetrosBanner + SprintRetroForm (cluster retros, solo usado por FocusTab)
// viven ahora en ./features/focus/FocusTab. H-002.

// ─── TeamPulseTab ──────────────────────────────────────────
// TeamPulseTab + SprintPulseCard + PulseList viven ahora en
// ./features/team/TeamPulseTab y se cargan con React.lazy. A-02.

// ─── FocusTab (Mi Día) ─────────────────────────────────────
// FocusTab vive ahora en ./features/focus/FocusTab y se carga con React.lazy. H-002.

// ─── Main App ──────────────────────────────────────────────

// Selector de tours guiados. Permite, después del onboarding automático, ver
// el onboarding de cualquier rol (PO / Scrum Master / Participante). onPick
// recibe el rol elegido (null = el tour del rol propio del usuario).
function TourMenu({ onPick }) {
  const [open, setOpen] = useState(false);
  const items = [
    { role: null, label: "Mi tour guiado" },
    { role: "po", label: "Tour de Product Owner" },
    { role: "scrum_master", label: "Tour de Scrum Master" },
    { role: "participant", label: "Tour de Participante" },
  ];
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} title="Ver tours guiados" style={{ background: "rgba(20,156,172,0.15)", border: "1px solid rgba(20,156,172,0.4)", color: "#4dd8e8", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: "inherit" }}>
        🎓 Tour ▾
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 6, zIndex: 9999, minWidth: 210, boxShadow: "0 8px 28px rgba(0,0,0,0.5)" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, padding: "4px 8px 6px" }}>Ver onboarding</div>
            {items.map(it => (
              <button key={it.label} onClick={() => { setOpen(false); onPick(it.role); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", color: "rgba(255,255,255,0.85)", padding: "8px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// PlansLauncher vive ahora en ./features/billing/PlansLauncher (importado arriba). H-002 fase E.

// Overlay de retorno de pago de Mercado Pago. MP redirige al usuario a
// `/?billing=return` (ver api/mp-subscribe.js). El webhook que activa la
// suscripción puede tardar unos segundos, así que sondeamos `user_ia_capacity`
// hasta que el tier deje de ser 'free' con status 'active'. Se monta una sola
// vez al tope de App y se autogestiona desde la URL.
function BillingReturnOverlay() {
  const [state, setState] = useState("hidden"); // hidden | checking | success | pending
  const [planName, setPlanName] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") !== "return") return;
    setState("checking");

    let cancelled = false;
    let tries = 0;
    const MAX_TRIES = 12;   // ~30 s en total
    const INTERVAL = 2500;

    const poll = async () => {
      if (cancelled) return;
      tries += 1;
      try {
        const { data } = await supabase.rpc("user_ia_capacity").single();
        if (cancelled) return;
        if (data && data.tier && data.tier !== "free" && data.status === "active") {
          setPlanName(data.display_name || data.tier);
          setState("success");
          return;
        }
      } catch (_) { /* sesión aún no lista o RPC transitoria: reintenta */ }
      if (tries >= MAX_TRIES) { setState("pending"); return; }
      setTimeout(poll, INTERVAL);
    };
    poll();

    return () => { cancelled = true; };
  }, []);

  if (state === "hidden") return null;

  const close = () => {
    // Limpia ?billing=return y recarga para refrescar capacidad/plan en la app.
    window.history.replaceState({}, "", window.location.pathname);
    window.location.reload();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100000,
      background: "rgba(5,5,15,0.92)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        maxWidth: 440, width: "100%", background: "#12121f",
        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
        padding: "36px 32px", textAlign: "center", color: "#fff",
        boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
      }}>
        {state === "checking" && (
          <>
            <div style={{ fontSize: 13, letterSpacing: 4, textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 18 }}>
              Mercado Pago
            </div>
            <div style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>Confirmando tu pago…</div>
            <div style={{ width: 200, height: 2, background: "rgba(255,255,255,0.1)", borderRadius: 1, overflow: "hidden", margin: "20px auto 0" }}>
              <div style={{ height: "100%", background: "linear-gradient(90deg, #ec6c04, #149cac)", borderRadius: 1, animation: "expandLine 1.5s ease infinite alternate" }} />
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 18 }}>
              Esto puede tardar unos segundos. No cierres esta ventana.
            </div>
          </>
        )}

        {state === "success" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>¡Suscripción activada!</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
              Tu plan <strong style={{ color: "#fff" }}>{planName}</strong> ya está activo. Ya puedes activar la IA en tus proyectos.
            </div>
            <button onClick={close} style={{
              marginTop: 24, padding: "11px 28px", border: "none", borderRadius: 10,
              background: "linear-gradient(135deg, #ec6c04, #149cac)", color: "#fff",
              fontWeight: 700, fontSize: 14, cursor: "pointer",
            }}>Continuar</button>
          </>
        )}

        {state === "pending" && (
          <>
            <div style={{ fontSize: 48, marginBottom: 8 }}>⏳</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Tu pago se está procesando</div>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
              Mercado Pago aún no confirma el cobro. Suele reflejarse en unos minutos,
              <strong style={{ color: "#fff" }}> no necesitas pagar de nuevo</strong>. Tu plan aparecerá en Configuración cuando se confirme.
            </div>
            <button onClick={close} style={{
              marginTop: 24, padding: "11px 28px", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10,
              background: "transparent", color: "#fff", fontWeight: 600, fontSize: 14, cursor: "pointer",
            }}>Entendido</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  // Captura ?ref= de la URL al montar y lo persiste en localStorage.
  useReferralCapture();

  const bp = useBreakpoint();
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef(null);

  // Cerrar overflow con click-fuera y Escape — mismo patron que notificaciones
  useEffect(() => {
    if (!showOverflow) return;
    const onPointer = (e) => { if (overflowRef.current && !overflowRef.current.contains(e.target)) setShowOverflow(false); };
    const onKey = (e) => { if (e.key === "Escape") setShowOverflow(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [showOverflow]);

  const [activeTab, setActiveTab] = useState("board");
  const [forceTour, setForceTour] = useState(false);
  const [forceTourRole, setForceTourRole] = useState(null); // rol elegido en el selector de tours (null = mi rol)
  // myRole: rol del usuario en el proyecto actual (po / scrum_master / participant).
  // null mientras carga o si no es miembro. Usado para gating de tabs en Fase B.
  const [myRole, setMyRole] = useState(null);
  const [showIntro, setShowIntro] = useState(true);
  const [authUser, setAuthUser] = useState(null);

  // Sync proactivo: si el usuario ya tiene sesión y hay ?ref= en localStorage,
  // lo envía al backend sin esperar a que haga click en "Suscribirse".
  useReferralSync(authUser);
  const [showAuth, setShowAuth] = useState(false);
  const [activeUser, setActiveUser] = useState(null);
  const [showProjectLanding, setShowProjectLanding] = useState(false);
  const [depEditTask, setDepEditTask] = useState(null);

  // Todos los datos del proyecto (estado + carga masiva + realtime + CRUD/saves)
  // viven en useProjectData, que compone los hooks de dominio y posee el spine.
  // App solo orquesta auth/UI. H-002 fase D — consolidación.
  const {
    projectId, setProjectId,
    project, setProject,
    currentUserId, setCurrentUserId,
    loading, setLoading,
    okrs, setOkrs,
    keyResults, setKeyResults,
    sprints, setSprints,
    participants, setParticipants,
    indicators,
    taskTypes,
    dimensions,
    saveParticipants, saveIndicators, saveTaskTypes, saveDimensions, saveProjectPin,
    taskFieldDefs,
    addTaskFieldDef, updateTaskFieldDefById, deleteTaskFieldDef, reorderTaskFieldDefs,
    tasks, setTasks, nextId,
    createTask, updateTask, deleteTask, exportCSV,
    loadAllForProject,
  } = useProjectData({ activeUser, setActiveUser });
  // Presencia en tiempo real (activos, expulsión, conflicto de sesión) vive en
  // usePresence. App conserva activeUser; currentUserId lo provee useProjectData. H-002 fase D.
  const {
    activeUsers,
    kickedMsg, setKickedMsg,
    conflictUser, setConflictUser,
    handleForceEntry, handleChangeUser,
  } = usePresence({ projectId, activeUser, setActiveUser, setCurrentUserId });
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  // Carga el rol del usuario para el proyecto activo (Fase B onboarding).
  // Se dispara cuando cambia projectId o authUser. El owner ignora myRole y
  // ve todo igual; pero igual lo cargamos para usarlo desde el Onboarding.
  useEffect(() => {
    if (!projectId || !authUser?.id) { setMyRole(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("my_role_in_project", { p_project_id: projectId });
      if (!cancelled) setMyRole(typeof data === "string" ? data : null);
    })();
    return () => { cancelled = true; };
  }, [projectId, authUser?.id]);

  const [dismissedNotifs, setDismissedNotifs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pp_dismissed_notifs') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    // Evita rutear dos veces (init + SIGNED_IN pueden coincidir).
    let routed = false;

    // Rutea al usuario tras autenticarse: invitación ?join, proyecto guardado o
    // pantalla de selección. Compartido por init() y por el retorno del link
    // mágico (onAuthStateChange SIGNED_IN).
    const routeAfterAuth = async (user) => {
      setAuthUser(user);
      setShowAuth(false); setShowIntro(false);

      // 2. Handle ?join=CODE invite link
      const params = new URLSearchParams(window.location.search);
      const joinCode = params.get('join');
      if (joinCode) {
        const proj = await joinProjectByCode(joinCode, user);
        if (proj) {
          localStorage.setItem('pp_project_id', String(proj.id));
          setProjectId(proj.id); setProject(proj);
          window.history.replaceState({}, '', window.location.pathname);
          await loadAllForProject(proj.id, proj, user);
          return;
        }
      }

      // 3. Load stored project
      const stored = localStorage.getItem('pp_project_id');
      if (stored) {
        const pid = Number(stored);
        const { data: proj } = await supabase.from('projects').select('*').eq('id', pid).single();
        if (proj) {
          // Ensure user is registered as member (self-healing for projects created before auth)
          if (user) {
            supabase.from('project_members').upsert(
              { project_id: proj.id, email: user.email, name: user.user_metadata?.full_name || user.email },
              { onConflict: 'project_id,email' }
            );
          }
          setProjectId(pid); setProject(proj);
          await loadAllForProject(pid, proj, user);
          return;
        }
        localStorage.removeItem('pp_project_id');
      }

      // 4. No project — show landing
      setShowProjectLanding(true);
      setLoading(false);
    };

    const init = async () => {
      // 1. Check Supabase auth session (espera la inicialización de supabase-js,
      // incluida la detección del token del link mágico en la URL).
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setLoading(false);
        // showIntro will lead to showAuth after animation
        return;
      }
      routed = true;
      await routeAfterAuth(session.user);
    };

    init();

    // Auth state subscription
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setAuthUser(null); setActiveUser(null); setProject(null);
        setProjectId(null); setTasks([]); setParticipants([]);
        setShowAuth(true); setShowIntro(true); setShowProjectLanding(false);
        setLoading(false);
        routed = false;
      } else if (event === 'SIGNED_IN' && session?.user && !routed) {
        // Retorno del link mágico: la sesión entró después de init().
        routed = true;
        routeAfterAuth(session.user);
      }
    });
    return () => subscription.unsubscribe();
    // Initialization must run once; subsequent project changes are handled explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Todo el estado/CRUD de datos del proyecto, la carga masiva (loadAllForProject)
  // y el canal realtime viven en useProjectData (que compone useTasks /
  // useProjectConfig / useTaskFieldDefs). La presencia vive en usePresence.
  // App solo orquesta auth/UI + render. H-002 fase D — consolidación.

  const currentUser = useMemo(() => participants.find((p) => p.id === currentUserId) || null, [participants, currentUserId]);

  const today = new Date().toISOString().split('T')[0];
  const alerts = useMemo(() => {
    const result = [];
    tasks.forEach(t => {
      if (t.endDate && t.endDate < today && !['Finalizada', 'Cancelada'].includes(t.status))
        result.push({ id: `overdue-${t.id}`, type: 'danger', msg: `Vencida: #${t.id} "${t.title}"` });
      if (t.status === 'Bloqueada')
        result.push({ id: `blocked-${t.id}`, type: 'warning', msg: `Bloqueada: #${t.id} "${t.title}"` });
    });
    return result;
  }, [tasks, today]);
  const visibleAlerts = alerts.filter(a => !dismissedNotifs.includes(a.id));
  const dismissAlert = (id) => {
    const next = [...dismissedNotifs, id];
    setDismissedNotifs(next);
    localStorage.setItem('pp_dismissed_notifs', JSON.stringify(next));
  };

  // Tabs visibles por rol (Fase B del onboarding). Owner ve TODO (es el
  // dueño del proyecto, incluida Configuración). Los demás roles solo ven
  // las pestañas que tienen sentido para su trabajo. Si el rol asignado no
  // está en allowedRoles, esa tab no se renderiza.
  const TABS_ALL = [
    { id: "board",        label: "Tablero",              allowedRoles: ["po","scrum_master","participant"] },
    { id: "gantt",        label: "Gantt",                allowedRoles: ["participant"] },
    { id: "metrics",      label: "Métricas",             allowedRoles: ["po"] },
    { id: "deps",         label: "Red de Tareas",        allowedRoles: ["po","scrum_master","participant"] },
    { id: "okrs",         label: "OKRs",                 allowedRoles: ["po","scrum_master"] },
    { id: "sprints",      label: "Sprints",              allowedRoles: ["scrum_master"] },
    { id: "supertasks",   label: "Super-tareas",         allowedRoles: ["po","scrum_master","participant"] },
    { id: "focus",        label: "Mi Día",               allowedRoles: ["po","scrum_master","participant"] },
    { id: "presentation", label: "Presentación",         allowedRoles: ["po","scrum_master"] },
    { id: "evolution",    label: "Evolutivo 💎",         allowedRoles: ["po"] },
    { id: "chat",         label: "Chat IA 🤖",            allowedRoles: ["po"] },
    { id: "pulse",        label: "Pulso del equipo 🌡",  allowedRoles: ["po"] },        // scrum_master excluido: RPC filtra por owner (requiere cambio de BD para habilitar)
    { id: "config",       label: "Configuración",        allowedRoles: [] },  // solo owner
  ];

  const isOwnerOfProject = project?.owner_id && authUser?.id && project.owner_id === authUser.id;
  // Mientras myRole no haya cargado para un no-owner, defaultea a 'participant'
  // (más restrictivo) para evitar parpadeos de tabs que el usuario no debería ver.
  const effectiveRole = isOwnerOfProject ? 'po' : (myRole || 'participant');
  const TABS = TABS_ALL.filter(t => isOwnerOfProject || t.allowedRoles.includes(effectiveRole));

  // Si la tab activa dejó de ser visible (cambió el rol o el owner), salta a la primera disponible.
  useEffect(() => {
    if (!TABS.length) return;
    if (!TABS.find(t => t.id === activeTab)) setActiveTab(TABS[0].id);
  }, [TABS.length, activeTab]);

  // ── Tabs responsivos: si la fila no cabe, colapsa a menú hamburguesa ──
  // No usamos un breakpoint fijo de media query porque el nº de tabs varía por
  // rol (owner ~14, participante ~5): medimos el desbordamiento real con un
  // ResizeObserver. Mientras está expandida guardamos el ancho que necesita la
  // fila (tabsNeedWidthRef); cuando está colapsada, re-expandimos si vuelve a caber.
  const tabsWrapRef = useRef(null);
  const tabsRowRef = useRef(null);
  const tabsNeedWidthRef = useRef(0);
  const TABS_WRAP_PADDING = 40; // padding horizontal del contenedor (20px + 20px)
  const [tabsCollapsed, setTabsCollapsed] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);

  // Ref que espeja tabsCollapsed para que el callback del ResizeObserver lo lea
  // sin necesitar tabsCollapsed como dependencia del effect (evita reconexión del RO
  // en cada colapso/expansión → fix R-01: loop del ResizeObserver).
  const tabsCollapsedRef = useRef(false);
  useEffect(() => { tabsCollapsedRef.current = tabsCollapsed; }, [tabsCollapsed]);

  // Ref para el requestAnimationFrame pendiente; lo cancelamos si llega una nueva
  // medición antes de que se ejecute el frame anterior.
  const tabsRafRef = useRef(null);

  useEffect(() => {
    const wrap = tabsWrapRef.current;
    if (!wrap) return;
    const measure = () => {
      // Cancelamos el frame previo en vuelo para no acumular setState redundantes.
      if (tabsRafRef.current !== null) cancelAnimationFrame(tabsRafRef.current);
      tabsRafRef.current = requestAnimationFrame(() => {
        tabsRafRef.current = null;
        const avail = wrap.clientWidth - TABS_WRAP_PADDING;
        const row = tabsRowRef.current;
        if (row) {
          // Expandida: guardamos el ancho real y colapsamos solo si desborda.
          // Siempre actualizamos needWidth mientras la fila está montada, para
          // que el valor nunca quede stale cuando se desmonte (fix R-02 parcial).
          tabsNeedWidthRef.current = row.scrollWidth;
          if (row.scrollWidth > avail + 1 && !tabsCollapsedRef.current) {
            setTabsCollapsed(true);
            tabsCollapsedRef.current = true;
          }
        } else {
          // Colapsada: re-expandimos solo si hay espacio (histéresis 8 px) Y el
          // ancho necesario ya fue medido al menos una vez (needWidth > 0).
          // Sin la segunda condición, si la página cargó ya angosta (needWidth===0
          // porque la fila nunca se montó), avail >= 0+8 sería siempre true → flip
          // inmediato (fix R-02: stale needWidth en primer render estrecho).
          if (
            tabsNeedWidthRef.current > 0 &&
            avail >= tabsNeedWidthRef.current + 8 &&
            tabsCollapsedRef.current
          ) {
            setTabsCollapsed(false);
            setTabMenuOpen(false);
            tabsCollapsedRef.current = false;
          }
        }
      });
    };
    measure();
    // El RO solo se reconecta cuando cambia TABS.length (rol distinto), NO con cada
    // colapso/expansión. tabsCollapsed se lee a través de tabsCollapsedRef.
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      if (tabsRafRef.current !== null) cancelAnimationFrame(tabsRafRef.current);
    };
  }, [TABS.length]);

  const activeTabLabel = TABS.find(t => t.id === activeTab)?.label || "Menú";

  return (
    <>
      <BillingReturnOverlay />

      {showProjectLanding && !loading && (
        <ProjectLandingScreen authUser={authUser} onProjectLoaded={(proj) => {
          setProject(proj);
          setProjectId(proj.id);
          setShowProjectLanding(false);
          loadAllForProject(proj.id, proj, authUser);
        }} />
      )}

      {loading && (
        <div style={{
          position: 'fixed', inset: 0, background: '#0d0d1a',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          zIndex: 99999, gap: 20,
        }}>
          <div style={{
            fontSize: 72, fontWeight: 900,
            background: 'linear-gradient(135deg, #ec6c04, #149cac)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>P+</div>
          <div style={{ width: 200, height: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: 'linear-gradient(90deg, #ec6c04, #149cac)',
              borderRadius: 1, animation: 'expandLine 1.5s ease infinite alternate',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: 4, textTransform: 'uppercase' }}>
            Conectando base de datos...
          </span>
        </div>
      )}
      {!loading && showIntro && <IntroScreen onFinish={() => { setShowIntro(false); if (!authUser) setShowAuth(true); }} />}
      {!loading && !showIntro && showAuth && (
        <AuthScreen />
      )}
      {/* Conflict modal — user is already active, offer to take over or pick another */}
      {conflictUser && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 99997,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1a1a2e", borderRadius: 20, padding: "40px 36px", maxWidth: 420,
            border: "1px solid rgba(236,108,4,0.3)", textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            animation: "cardEntrance 0.4s ease",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>👤</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#ec6c04", marginBottom: 12 }}>Usuario ya activo</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, marginBottom: 24 }}>
              <strong style={{ color: "#fff" }}>{conflictUser.name}</strong> ya tiene una sesión abierta en otro navegador. ¿Qué deseas hacer?
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                onClick={() => setConflictUser(null)}
                style={{
                  background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)",
                  border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "10px 24px", fontSize: 13,
                  fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
                }}
              >Elegir otro perfil</button>
              <button
                onClick={handleForceEntry}
                style={{
                  background: "linear-gradient(135deg, #ec6c04, #f07d1e)", color: "#fff",
                  border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 13,
                  fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(236,108,4,0.4)",
                }}
              >Tomar sesión</button>
            </div>
          </div>
        </div>
      )}
      {/* Kicked-out modal — shown to the session that was displaced */}
      {kickedMsg && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 99997,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#1a1a2e", borderRadius: 20, padding: "40px 36px", maxWidth: 400,
            border: "1px solid rgba(236,108,4,0.3)", textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            animation: "cardEntrance 0.4s ease",
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#ec6c04", marginBottom: 12 }}>Sesión cerrada</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.6, marginBottom: 24 }}>{kickedMsg}</div>
            <button
              onClick={() => setKickedMsg(null)}
              style={{
                background: "linear-gradient(135deg, #ec6c04, #f07d1e)", color: "#fff",
                border: "none", borderRadius: 10, padding: "10px 32px", fontSize: 13,
                fontWeight: 700, cursor: "pointer",
              }}
            >Elegir otro perfil</button>
          </div>
        </div>
      )}
      <div style={{ opacity: showIntro || showAuth || showProjectLanding ? 0 : 1, pointerEvents: showIntro || showAuth || showProjectLanding ? "none" : "auto", transition: "opacity 0.6s ease 0.2s" }}>
    <style>{`
      @keyframes fadeInUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes shimmer { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      @media print {
        nav, [data-noprint], .no-print { display: none !important; }
        body { background: #fff !important; }
        .print-page { page-break-after: always; }
      }
      .pp-header-btn:focus-visible { outline: 2px solid #ec6c04; outline-offset: 2px; }
    `}</style>
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #f8f4ff 0%, #e6f7f8 50%, #fff3ea 100%)", color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}>
      {/* ── HEADER responsive (RESP-01) ── */}
      <div style={{ background: "linear-gradient(90deg, #1a1a2e 0%, #2d1b4e 100%)", boxShadow: "0 2px 0 #ec6c04", padding: bp === "mobile" ? "8px 12px" : "10px 20px", display: "flex", alignItems: "center", gap: bp === "mobile" ? 8 : 14, position: "relative" }}>

        {/* ── Logo ── */}
        {bp === "mobile" ? (
          <div aria-label="Productivity-Plus" style={{ fontWeight: 800, fontSize: 14, display: "flex", alignItems: "center", gap: 4, minHeight: 40 }}>
            <span style={{ background: "linear-gradient(135deg, #ec6c04, #f07d1e)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>P+</span>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ec6c04", animation: "pulse 2s ease-in-out infinite", display: "inline-block" }} />
          </div>
        ) : (
          <div style={{ fontWeight: 800, fontSize: bp === "tablet" ? 16 : 18, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ background: "linear-gradient(135deg, #ec6c04, #f07d1e)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Productivity</span>
            <span style={{ color: "#ffffff", fontWeight: 300, fontSize: bp === "tablet" ? 14 : 16 }}>-Plus</span>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ec6c04", marginLeft: 2, animation: "pulse 2s ease-in-out infinite", display: "inline-block" }} />
          </div>
        )}

        {/* ── Proyecto + boton cambiar (desktop+tablet); mobile: solo boton al overflow) ── */}
        {bp !== "mobile" && project && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: 1 }}>|</span>
            {bp === "tablet" ? (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 500, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.name}</span>
            ) : (
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{project.name}</span>
            )}
            <button
              className="pp-header-btn"
              onClick={() => { const pid = localStorage.getItem('pp_project_id'); if (pid) localStorage.setItem('pp_last_project_id', pid); localStorage.removeItem('pp_project_id'); setProject(null); setProjectId(null); setShowProjectLanding(true); setActiveUser(null); }}
              aria-label="Cambiar proyecto"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", borderRadius: 5, padding: "2px 7px", cursor: "pointer", fontSize: 10, fontWeight: 500, minHeight: 28 }}
            >↩</button>
          </div>
        )}

        {/* ── Divisor vertical 1 (desktop+tablet) ── */}
        {bp !== "mobile" && (
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.15)", flexShrink: 0 }} />
        )}

        {/* ── Presencia (avatares) ── */}
        {bp === "mobile" ? (
          <span style={{ background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.7)", fontSize: 10, borderRadius: 12, padding: "2px 8px", whiteSpace: "nowrap", minHeight: 40, display: "flex", alignItems: "center" }}>
            {activeUsers.length} activos
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {(() => {
              const usersToShow = bp === "tablet" ? activeUsers.slice(0, 3) : activeUsers;
              const hidden = bp === "tablet" ? activeUsers.length - 3 : 0;
              return (
                <>
                  {usersToShow.map((u) => {
                    const color = getUserColor(u.name);
                    return (
                      <div key={u.userId} title={u.name} style={{ position: "relative" }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: "50%",
                          background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 800, color: "#fff",
                          border: u.userId === activeUser?.id ? "2px solid #ec6c04" : "2px solid rgba(255,255,255,0.2)",
                          transition: "border 0.3s",
                        }}>{getInitials(u.name)}</div>
                        <div style={{
                          position: "absolute", bottom: -1, right: -1,
                          width: 9, height: 9, borderRadius: "50%",
                          background: "#27ae60", border: "2px solid #1a1a2e",
                        }} />
                      </div>
                    );
                  })}
                  {hidden > 0 && (
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", background: "rgba(255,255,255,0.1)", borderRadius: 10, padding: "2px 6px", fontWeight: 700 }}>+{hidden}</span>
                  )}
                  {activeUsers.length === 0 && (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>Sin usuarios activos</span>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* ── Divisor vertical 2 (desktop+tablet) ── */}
        {bp !== "mobile" && (
          <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.15)", flexShrink: 0 }} />
        )}

        {/* ── Sesion (usuario activo) ── */}
        {activeUser && (
          bp === "mobile" ? (
            /* Mobile: avatar circular con punto SUPER */
            <div style={{ position: "relative" }}>
              <button
                className="pp-header-btn"
                onClick={handleChangeUser}
                aria-label={`Sesión: ${activeUser.name} — Cambiar usuario`}
                style={{ width: 24, height: 24, borderRadius: "50%", background: `linear-gradient(135deg, ${getUserColor(activeUser.name)}, ${getUserColor(activeUser.name)}cc)`, border: "2px solid rgba(255,255,255,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", padding: 0, minHeight: 24, minWidth: 24 }}
              >
                {getInitials(activeUser.name)}
              </button>
              {currentUser?.isSuperUser && (
                <span style={{ position: "absolute", top: -2, right: -2, width: 8, height: 8, borderRadius: "50%", background: "#ec6c04", border: "1.5px solid #1a1a2e", display: "block" }} />
              )}
            </div>
          ) : (
            /* Desktop + Tablet */
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {bp === "desktop" && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Sesión:</span>}
              <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", maxWidth: bp === "tablet" ? 64 : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeUser.name}
              </span>
              {currentUser?.isSuperUser && (
                <span style={{ fontSize: 9, background: "linear-gradient(135deg, #ec6c04, #f07d1e)", color: "#fff", padding: "2px 7px", borderRadius: 8, fontWeight: 700 }}>SUPER</span>
              )}
              <button
                className="pp-header-btn"
                onClick={handleChangeUser}
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 10, fontWeight: 500, transition: "all 0.2s", minHeight: 28 }}
              >Cambiar</button>
            </div>
          )
        )}

        {/* ── TourMenu + Salir (desktop: completo; tablet: completo; mobile: al overflow) ── */}
        {authUser && bp !== "mobile" && (
          <>
            <TourMenu onPick={(r) => { setForceTourRole(r); setForceTour(true); }} />
            {bp === "desktop" ? (
              <button
                className="pp-header-btn"
                onClick={() => supabase.auth.signOut()}
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 10, fontWeight: 500, minHeight: 28 }}
              >Salir</button>
            ) : (
              /* tablet: icono de salida */
              <button
                className="pp-header-btn"
                onClick={() => supabase.auth.signOut()}
                title="Cerrar sesión"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 14, minHeight: 28 }}
              >⏻</button>
            )}
          </>
        )}

        {/* ── Spacer mobile (reemplaza marginLeft:auto) ── */}
        {bp === "mobile" && <div style={{ flex: 1 }} />}

        {/* ── Grupo derecho ── */}
        <div style={{ marginLeft: bp === "mobile" ? undefined : "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {/* BoardSummaryPill: visible en desktop; oculta en tablet y mobile (va al overflow) */}
          {authUser && projectId && bp === "desktop" && (
            <BoardSummaryPill projectId={projectId} projectName={project?.name} />
          )}
          {/* PlansLauncher: desktop=completo; tablet=solo icono (el componente gestiona su modal); mobile=overflow */}
          {authUser && bp !== "mobile" && (
            <PlansLauncher variant={bp === "desktop" ? "header" : "icon"} />
          )}
          {/* Campana de notificaciones — siempre visible */}
          <div style={{ position: "relative" }}>
            <button
              className="pp-header-btn"
              onClick={() => { setShowNotifPanel(p => !p); setShowOverflow(false); }}
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: visibleAlerts.length > 0 ? "#f87171" : "rgba(255,255,255,0.5)", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 14, lineHeight: 1, position: "relative", overflow: "visible", minHeight: 40, minWidth: 40 }}
            >
              🔔
              {visibleAlerts.length > 0 && (
                <span style={{ position: "absolute", top: 0, right: 0, transform: "translate(40%,-40%)", background: "#c0392b", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>{visibleAlerts.length}</span>
              )}
            </button>
            {showNotifPanel && (
              <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "#1a1a2e", borderRadius: 14, padding: 16, minWidth: 300, maxHeight: 380, overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 9999, border: "1px solid rgba(255,255,255,0.1)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.45)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>Alertas{visibleAlerts.length > 0 ? ` (${visibleAlerts.length})` : ""}</div>
                {visibleAlerts.length === 0 ? (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "20px 0" }}>Sin alertas activas ✓</div>
                ) : visibleAlerts.map(a => (
                  <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 7, padding: "8px 10px", background: "rgba(255,255,255,0.05)", borderRadius: 8, borderLeft: `3px solid ${a.type === 'danger' ? '#e74c3c' : '#ec6c04'}` }}>
                    <span style={{ fontSize: 11, flex: 1, color: "rgba(255,255,255,0.8)", lineHeight: 1.4 }}>{a.msg}</span>
                    <button onClick={() => dismissAlert(a.id)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 13, padding: 0, flexShrink: 0, lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* PDF + CSV: desktop=visible; tablet+mobile=overflow */}
          {bp === "desktop" && (
            <>
              <button
                className="pp-header-btn"
                onClick={() => window.print()}
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.5)", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 500, minHeight: 40 }}
              >🖨 PDF</button>
              <button
                className="pp-header-btn"
                onClick={exportCSV}
                style={{ background: "rgba(20,156,172,0.2)", border: "1px solid rgba(20,156,172,0.5)", color: "#4dd8e8", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontSize: 12, fontWeight: 500, minHeight: 40 }}
              >↓ Exportar CSV</button>
            </>
          )}

          {/* ── Boton overflow "⋯" (tablet y mobile) ── */}
          {bp !== "desktop" && (
            <div ref={overflowRef} style={{ position: "relative" }}>
              <button
                className="pp-header-btn"
                onClick={() => { setShowOverflow(p => !p); setShowNotifPanel(false); }}
                aria-label="Mas opciones"
                aria-expanded={showOverflow}
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 16, minWidth: 40, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center" }}
              >⋯</button>
              {showOverflow && (
                <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "#1a1a2e", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)", minWidth: 200, zIndex: 9998, overflow: "hidden" }}>
                  {/* Tablet: PDF y CSV */}
                  {bp === "tablet" && (
                    <>
                      <button onClick={() => { window.print(); setShowOverflow(false); }} style={{ display: "flex", gap: 10, padding: "10px 16px", fontSize: 13, color: "rgba(255,255,255,0.75)", background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left", alignItems: "center", fontFamily: "inherit" }}
                        onPointerEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
                        onPointerLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span>🖨</span><span>PDF</span>
                      </button>
                      <button onClick={() => { exportCSV(); setShowOverflow(false); }} style={{ display: "flex", gap: 10, padding: "10px 16px", fontSize: 13, color: "rgba(255,255,255,0.75)", background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left", alignItems: "center", fontFamily: "inherit" }}
                        onPointerEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
                        onPointerLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span>↓</span><span>Exportar CSV</span>
                      </button>
                    </>
                  )}
                  {/* Mobile: Cambiar proyecto, Tour, Salir, Planes, BoardSummaryPill, PDF, CSV */}
                  {bp === "mobile" && (
                    <>
                      {project && (
                        <button onClick={() => { const pid = localStorage.getItem('pp_project_id'); if (pid) localStorage.setItem('pp_last_project_id', pid); localStorage.removeItem('pp_project_id'); setProject(null); setProjectId(null); setShowProjectLanding(true); setActiveUser(null); setShowOverflow(false); }} style={{ display: "flex", gap: 10, padding: "10px 16px", fontSize: 13, color: "rgba(255,255,255,0.75)", background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left", alignItems: "center", fontFamily: "inherit" }}
                          onPointerEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
                          onPointerLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span>↩</span><span>Cambiar proyecto</span>
                        </button>
                      )}
                      {authUser && (
                        <button onClick={() => { setForceTourRole(null); setForceTour(true); setShowOverflow(false); }} style={{ display: "flex", gap: 10, padding: "10px 16px", fontSize: 13, color: "rgba(255,255,255,0.75)", background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left", alignItems: "center", fontFamily: "inherit" }}
                          onPointerEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
                          onPointerLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span>🎓</span><span>Tour</span>
                        </button>
                      )}
                      {authUser && (
                        <button onClick={() => { supabase.auth.signOut(); setShowOverflow(false); }} style={{ display: "flex", gap: 10, padding: "10px 16px", fontSize: 13, color: "rgba(255,255,255,0.75)", background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left", alignItems: "center", fontFamily: "inherit" }}
                          onPointerEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
                          onPointerLeave={e => e.currentTarget.style.background = "transparent"}>
                          <span>⏻</span><span>Salir</span>
                        </button>
                      )}
                      {authUser && (
                        <div style={{ padding: "10px 16px" }}>
                          <PlansLauncher variant="header" />
                        </div>
                      )}
                      {authUser && projectId && (
                        <div style={{ padding: "10px 16px" }}>
                          <BoardSummaryPill projectId={projectId} projectName={project?.name} />
                        </div>
                      )}
                      <button onClick={() => { window.print(); setShowOverflow(false); }} style={{ display: "flex", gap: 10, padding: "10px 16px", fontSize: 13, color: "rgba(255,255,255,0.75)", background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left", alignItems: "center", fontFamily: "inherit" }}
                        onPointerEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
                        onPointerLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span>🖨</span><span>PDF</span>
                      </button>
                      <button onClick={() => { exportCSV(); setShowOverflow(false); }} style={{ display: "flex", gap: 10, padding: "10px 16px", fontSize: 13, color: "rgba(255,255,255,0.75)", background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left", alignItems: "center", fontFamily: "inherit" }}
                        onPointerEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.07)"}
                        onPointerLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span>↓</span><span>Exportar CSV</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div ref={tabsWrapRef} style={{ background: "#ffffff", borderBottom: "1px solid #e8e0f4", padding: "0 20px", boxShadow: "0 2px 8px rgba(84,44,156,0.06)", position: "relative" }}>
        {tabsCollapsed ? (
          // ── Colapsado: botón hamburguesa + dropdown vertical ──
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setTabMenuOpen(o => !o)}
              aria-label="Abrir menú de secciones"
              aria-expanded={tabMenuOpen}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "none", border: "none", cursor: "pointer",
                padding: "11px 4px", fontSize: 14, fontWeight: 700, color: "#542c9c",
                fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>☰</span>
              <span>{activeTabLabel}</span>
              <span style={{ fontSize: 10, color: "#969696", transform: tabMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
            </button>
            {tabMenuOpen && (
              <>
                {/* overlay para cerrar al hacer clic fuera */}
                <div onClick={() => setTabMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 61,
                  background: "#fff", border: "1px solid #e8e0f4", borderRadius: 12,
                  boxShadow: "0 8px 28px rgba(84,44,156,0.18)", padding: 6,
                  minWidth: 220, maxHeight: "70vh", overflowY: "auto",
                }}>
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      data-tour={`tab-${tab.id}`}
                      onClick={() => { setActiveTab(tab.id); setTabMenuOpen(false); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        background: activeTab === tab.id ? "#f3eefc" : "none", border: "none",
                        borderLeft: activeTab === tab.id ? "3px solid #542c9c" : "3px solid transparent",
                        color: activeTab === tab.id ? "#542c9c" : "#555",
                        padding: "10px 14px", cursor: "pointer", fontSize: 13.5,
                        fontWeight: activeTab === tab.id ? 700 : 500,
                        borderRadius: 8, fontFamily: "inherit",
                      }}
                    >{tab.label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          // ── Expandido: fila horizontal de tabs (comportamiento original) ──
          <div ref={tabsRowRef} style={{ display: "flex", gap: 0 }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                data-tour={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: "none", border: "none", whiteSpace: "nowrap",
                  borderBottom: activeTab === tab.id ? "2.5px solid #542c9c" : "2.5px solid transparent",
                  color: activeTab === tab.id ? "#542c9c" : "#888888",
                  padding: "11px 18px", cursor: "pointer", fontSize: 13,
                  fontWeight: activeTab === tab.id ? 700 : 500,
                  transition: "all 0.15s", fontFamily: "inherit",
                }}
              >{tab.label}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "20px 20px 40px" }}>
        {activeTab === "board" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <BoardTab tasks={tasks} createTask={createTask} updateTask={updateTask} deleteTask={deleteTask} participants={participants} indicators={indicators} currentUser={currentUser} taskTypes={taskTypes} weights={dimensions} dimensions={dimensions} editTaskFromDep={depEditTask} onDepEditDone={() => setDepEditTask(null)} projectId={projectId} nextId={nextId} keyResults={keyResults} sprints={sprints} taskFieldDefs={taskFieldDefs} />
          </Suspense>
        )}
        {activeTab === "gantt" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <GanttTab tasks={tasks} participants={participants} indicators={indicators} taskTypes={taskTypes} />
          </Suspense>
        )}
        {activeTab === "metrics" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <MetricsTab tasks={tasks} participants={participants} taskTypes={taskTypes} />
          </Suspense>
        )}
        {activeTab === "deps" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <DependenciesTab
              tasks={tasks}
              onEditTask={(t) => { setDepEditTask(t); setActiveTab("board"); }}
              sprints={sprints}
            />
          </Suspense>
        )}
        {activeTab === "okrs" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <OKRsTab projectId={projectId} okrs={okrs} setOkrs={setOkrs} keyResults={keyResults} setKeyResults={setKeyResults} tasks={tasks} />
          </Suspense>
        )}
        {activeTab === "sprints" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <SprintsTab projectId={projectId} sprints={sprints} setSprints={setSprints} tasks={tasks} />
          </Suspense>
        )}
        {activeTab === "focus" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <FocusTab tasks={tasks} activeUser={activeUser} updateTask={updateTask} dimensions={dimensions} />
          </Suspense>
        )}
        {activeTab === "supertasks" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <SuperTasksTab
              projectId={projectId}
              tasks={tasks}
              participants={participants}
              sprints={sprints}
              taskFieldDefs={taskFieldDefs}
              isOwner={project?.owner_id === authUser?.id}
            />
          </Suspense>
        )}
        {activeTab === "presentation" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <PresentationTab
              tasks={tasks}
              participants={participants}
              taskFieldDefs={taskFieldDefs}
              sprints={sprints}
            />
          </Suspense>
        )}
        {activeTab === "evolution" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <EvolutionTab projectId={projectId} isOwner={project?.owner_id === authUser?.id} />
          </Suspense>
        )}
        {activeTab === "chat" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <ChatEnterpriseTab projectId={projectId} isOwner={project?.owner_id === authUser?.id} />
          </Suspense>
        )}
        {activeTab === "pulse" && (
          <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
            <TeamPulseTab projectId={projectId} isOwner={project?.owner_id === authUser?.id} sprints={sprints} participants={participants} />
          </Suspense>
        )}
        {activeTab === "config" && (() => {
          const isOwner = project?.owner_id === authUser?.id;
          return isOwner ? (
            <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>}>
              <ConfigTab
                participants={participants} setParticipants={saveParticipants}
                indicators={indicators} setIndicators={saveIndicators}
                taskTypes={taskTypes} setTaskTypes={saveTaskTypes}
                dimensions={dimensions} setDimensions={saveDimensions}
                project={project}
                onChangePin={saveProjectPin}
                taskFieldDefs={taskFieldDefs}
                addTaskFieldDef={addTaskFieldDef}
                updateTaskFieldDef={updateTaskFieldDefById}
                deleteTaskFieldDef={deleteTaskFieldDef}
                reorderTaskFieldDefs={reorderTaskFieldDefs}
              />
            </Suspense>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:340, gap:16 }}>
              <div style={{ background:"#fff", borderRadius:16, padding:"32px 36px", boxShadow:"0 4px 32px rgba(84,44,156,0.12)", textAlign:"center", maxWidth:360 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🔒</div>
                <div style={{ fontSize:16, fontWeight:700, color:"#542c9c", marginBottom:8 }}>Acceso restringido</div>
                <div style={{ fontSize:13, color:"#969696", lineHeight:1.6 }}>Solo el dueño del proyecto puede acceder a la configuración.</div>
              </div>
            </div>
          );
        })()}
      </div>
      <div style={{ position: "fixed", bottom: 12, left: 16, display: "flex", flexDirection: "column", gap: 1, zIndex: 50 }}>
        <span style={{ fontSize: 10, color: "#969696", fontWeight: 400, letterSpacing: "0.03em" }}>Desarrollado por Soft a tu medida</span>
        <span style={{ fontSize: 9, color: "#b0b0b0", letterSpacing: "0.05em" }}>Productivity-Plus v{APP_VERSION}</span>
      </div>
    </div>
      </div>

      {/* Captura del nombre completo al primer login global. Si el usuario
          ya tiene full_name en user_metadata, no aparece. Se monta arriba
          de todo (z-index 100001) para bloquear el resto de la app. */}
      <NameCaptureModal
        supabase={supabase}
        authUser={authUser}
        onComplete={async () => {
          const { data } = await supabase.auth.getUser();
          if (data?.user) setAuthUser(data.user);
        }}
      />

      {/* Onboarding: modal de bienvenida en primer login + tour spotlight.
          Estado persistido en public.user_onboarding (migración 024).
          enabled=false mientras el landing de proyecto o el spinner están
          activos: los tabs del fondo no son visibles ni interactivos. */}
      <Onboarding
        supabase={supabase}
        authUser={authUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        forceOpen={forceTour}
        forceRole={forceTourRole}
        onForceHandled={() => { setForceTour(false); setForceTourRole(null); }}
        enabled={!showProjectLanding && !loading && !!projectId}
        projectId={projectId}
        isOwner={isOwnerOfProject}
      />
    </>
  );
}
