import { useState, useEffect, lazy, Suspense } from "react";
import { supabase } from '../supabaseClient';
import { DEFAULT_DIMENSIONS } from '../lib/aporte';
import { joinProjectByCode } from '../lib/joinProject';
import PlansLauncher from '../features/billing/PlansLauncher';

const ConsolidatedDashboard = lazy(() => import('../features/dashboard/ConsolidatedDashboard'));

// ─── ProjectLandingScreen ──────────────────────────────────
// ─── Visión consolidada (dashboard del dueño) ─────────────────
// Agrega el análisis de TODOS los tableros del dueño en una sola vista. Solo
// para cuentas de pago (capacity.tier != 'free' y status active). Incluye una
// sesión de "Reportes IA" que lista y muestra los reportes archivados
// (report_history) de cada tablero. RLS: el dueño solo ve sus propios tableros.

export default function ProjectLandingScreen({ onProjectLoaded, authUser = null }) {
  const [tab, setTab] = useState('join'); // 'create' | 'join' | 'template'
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [projName, setProjName] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projPin, setProjPin] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [err, setErr] = useState("");
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [tplPin, setTplPin] = useState("");
  const [tplCreating, setTplCreating] = useState(false);
  const [myProjects, setMyProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [capacity, setCapacity] = useState(null); // límite de tableros por plan (user_ia_capacity)
  const [ownerNames, setOwnerNames] = useState({}); // { projectId: nombre del owner que invitó }
  const [showConsolidated, setShowConsolidated] = useState(false); // dashboard del dueño
  const [deletingProject, setDeletingProject] = useState(null); // project being confirmed for deletion
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingBusy, setDeletingBusy] = useState(false);
  const DELETE_CONFIRM_PHRASE = 'Borrar Proyecto';

  useEffect(() => {
    supabase.from('project_templates').select('*').then(({ data }) => { if (data) setTemplates(data); });
  }, []);

  // Capacidad del plan (cuántos tableros puede crear). El límite real lo enforce
  // el servidor (trigger en projects, migración 027); esto es solo UX.
  useEffect(() => {
    if (!authUser?.id) { setCapacity(null); return; }
    supabase.rpc('user_ia_capacity').single().then(({ data }) => setCapacity(data || null));
  }, [authUser]);

  // Para los tableros donde soy invitado (no soy owner), resuelve el nombre de
  // quien me invitó (el owner) leyendo su fila en project_members.
  useEffect(() => {
    if (!authUser?.id || myProjects.length === 0) return;
    const invited = myProjects.filter(p => p.owner_id !== authUser.id);
    if (invited.length === 0) return;
    let cancelled = false;
    (async () => {
      const ids = invited.map(p => p.id);
      const { data } = await supabase
        .from('project_members')
        .select('project_id, name, user_id')
        .in('project_id', ids);
      if (cancelled || !data) return;
      const byProject = {};
      for (const proj of invited) {
        const ownerRow = data.find(m => m.project_id === proj.id && m.user_id === proj.owner_id);
        if (ownerRow?.name) byProject[proj.id] = ownerRow.name;
      }
      setOwnerNames(prev => ({ ...prev, ...byProject }));
    })();
    return () => { cancelled = true; };
  }, [authUser, myProjects]);

  useEffect(() => {
    if (!authUser) return;
    const loadMyProjects = async () => {
      setLoadingProjects(true);
      const seen = new Set();
      const all = [];
      const add = (p) => { if (p?.id && !seen.has(p.id)) { seen.add(p.id); all.push(p); } };

      // Use allSettled so a missing column (migration not run) doesn't break everything
      const [ownedRes, memberByIdRes, memberByEmailRes] = await Promise.allSettled([
        supabase.from('projects').select('*').eq('owner_id', authUser.id),
        supabase.from('project_members').select('project_id, projects(*)').eq('user_id', authUser.id),
        supabase.from('project_members').select('project_id, projects(*)').eq('email', authUser.email),
      ]);
      (ownedRes.value?.data || []).forEach(add);
      (memberByIdRes.value?.data || []).forEach(m => m.projects && add(m.projects));
      (memberByEmailRes.value?.data || []).forEach(m => m.projects && add(m.projects));

      // Fallback: any project ID stored in localStorage (covers projects created before auth)
      const storedIds = [localStorage.getItem('pp_project_id'), localStorage.getItem('pp_last_project_id')].filter(Boolean);
      await Promise.all(storedIds.map(async (pid) => {
        const { data: p } = await supabase.from('projects').select('*').eq('id', Number(pid)).single();
        if (p) {
          add(p);
          // Auto-register in project_members so future loads work without localStorage
          await supabase.from('project_members').upsert(
            { project_id: p.id, email: authUser.email, name: authUser.user_metadata?.full_name || authUser.email },
            { onConflict: 'project_id,email' }
          );
        }
      }));

      setMyProjects(all);
      setLoadingProjects(false);
    };
    loadMyProjects();
  }, [authUser]);

  // Límite de tableros por plan: tier_limits.total_projects vía user_ia_capacity.
  // Plan gratuito = 1 tablero. Mientras la capacidad carga, no bloqueamos (el
  // servidor enforce el límite real con un trigger; migración 027).
  const ownedCount = myProjects.filter(p => p.owner_id === authUser?.id).length;
  const isPremium = !!(capacity?.tier && capacity.tier !== 'free');
  const projectLimit = capacity?.total_max ?? null;
  const atLimit = projectLimit != null && ownedCount >= projectLimit;

  // Returns the authenticated user that will actually back the JWT on the
  // next request. We must use auth.getUser() (server round-trip) instead of
  // auth.getSession() (local cache only): a cached session can look fine
  // while its access_token is already expired, causing RLS to see
  // auth.uid() = NULL even though the React layer thinks we're logged in.
  // If validation fails, try refreshing once before giving up.
  const getSessionUserOrFail = async () => {
    const probe = await supabase.auth.getUser();
    if (!probe.error && probe.data?.user) {
      return { user: probe.data.user };
    }
    console.warn('[auth] getUser failed, attempting refresh', probe.error);
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr || !refreshed?.session?.user) {
      console.error('[auth] refresh failed', refreshErr);
      return { error: 'Tu sesión expiró. Vuelve a iniciar sesión para crear proyectos.' };
    }
    // Re-validate after refresh to be sure.
    const recheck = await supabase.auth.getUser();
    if (recheck.error || !recheck.data?.user) {
      return { error: 'No se pudo validar tu sesión. Cierra sesión y vuelve a entrar.' };
    }
    return { user: recheck.data.user };
  };

  const confirmDeleteProject = async () => {
    if (!deletingProject) return;
    if (deleteConfirmText !== DELETE_CONFIRM_PHRASE) {
      setErr(`Debes escribir exactamente "${DELETE_CONFIRM_PHRASE}" para confirmar.`);
      return;
    }
    setDeletingBusy(true);
    setErr('');
    const { error } = await supabase.from('projects').delete().eq('id', deletingProject.id);
    setDeletingBusy(false);
    if (error) {
      console.error('[deleteProject] error:', error);
      setErr('No se pudo borrar el proyecto: ' + (error.message || 'desconocido'));
      return;
    }
    // Clean up local references so we don't try to reopen the dead project.
    const stored = localStorage.getItem('pp_project_id');
    if (stored && Number(stored) === Number(deletingProject.id)) {
      localStorage.removeItem('pp_project_id');
    }
    const storedLast = localStorage.getItem('pp_last_project_id');
    if (storedLast && Number(storedLast) === Number(deletingProject.id)) {
      localStorage.removeItem('pp_last_project_id');
    }
    setMyProjects(prev => prev.filter(p => p.id !== deletingProject.id));
    setDeletingProject(null);
    setDeleteConfirmText('');
  };

  const createProject = async () => {
    if (!projName.trim()) { setErr("El nombre del proyecto es requerido."); return; }
    if (!projPin || projPin.length < 4) { setErr("La clave debe tener al menos 4 caracteres."); return; }
    if (atLimit) {
      setErr(`Llegaste al límite de ${projectLimit} tablero${projectLimit === 1 ? '' : 's'} del plan ${capacity?.display_name || 'actual'}. Sube de plan para crear más.`);
      return;
    }
    setCreating(true); setErr("");
    const session = await getSessionUserOrFail();
    if (session.error) { setErr(session.error); setCreating(false); return; }
    const ownerId = session.user.id;
    const config = {
      pin: projPin,
      dimensions: DEFAULT_DIMENSIONS,
    };
    console.info('[createProject] sending RPC create_project_secure', { sessionUserId: session.user.id, sessionEmail: session.user.email });

    // Preferred path: server-side RPC that derives owner_id from auth.uid().
    // Removes any room for client/server JWT desync to cause an RLS denial.
    let data = null;
    let error = null;
    const rpc = await supabase.rpc('create_project_secure', {
      p_name: projName.trim(),
      p_description: projDesc.trim(),
      p_config: config,
    });
    if (!rpc.error && rpc.data) {
      data = rpc.data;
    } else if (rpc.error?.code === '42883' || /function .* does not exist/i.test(rpc.error?.message || '')) {
      // Migration 009 not applied yet — fall back to the legacy direct insert.
      console.warn('[createProject] RPC not found, falling back to direct insert');
      const payload = { name: projName.trim(), description: projDesc.trim(), config, owner_id: ownerId };
      const ins = await supabase.from('projects').insert(payload).select().single();
      data = ins.data; error = ins.error;
    } else {
      error = rpc.error;
    }

    if (error || !data) {
      // Server-side observability: ask the DB what it sees in the JWT.
      let diag = null;
      try {
        const d = await supabase.rpc('whoami_diag');
        diag = d.error ? { rpcError: d.error.message } : d.data;
      } catch (e) { diag = { caught: String(e) }; }
      console.error('[createProject] failed', {
        code: error?.code,
        status: error?.status,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        ownerIdSent: ownerId,
        sessionUserId: session.user.id,
        serverWhoami: diag,
      });
      const msg = error?.message || 'desconocido';
      const isAuthNull = /auth\.uid is NULL/i.test(msg) || diag?.uid === null;
      const isRls = error?.code === '42501' || /row-level security/i.test(msg) || error?.status === 403;
      const isLimit = error?.code === 'P0001' || /l[ií]mite de .* tablero/i.test(msg);
      setErr(isLimit
        ? msg
        : isAuthNull
          ? 'El servidor no reconoce tu sesión (auth.uid es null). Cierra sesión y vuelve a entrar.'
          : isRls
            ? 'Permiso denegado por el servidor. Revisa la consola y cierra/abre sesión.'
            : 'Error creando proyecto: ' + msg);
      setCreating(false);
      return;
    }
    await supabase.from('project_members').upsert(
      { project_id: data.id, email: session.user.email, name: session.user.user_metadata?.full_name || session.user.email, user_id: ownerId },
      { onConflict: 'project_id,email' }
    );
    localStorage.setItem('pp_project_id', String(data.id));
    onProjectLoaded(data);
  };

  const createFromTemplate = async () => {
    if (!selectedTemplate) return;
    if (!tplPin || tplPin.length < 4) { setErr("La clave debe tener al menos 4 caracteres."); return; }
    if (atLimit) {
      setErr(`Llegaste al límite de ${projectLimit} tablero${projectLimit === 1 ? '' : 's'} del plan ${capacity?.display_name || 'actual'}. Sube de plan para crear más.`);
      return;
    }
    setTplCreating(true); setErr("");
    const session = await getSessionUserOrFail();
    if (session.error) { setErr(session.error); setTplCreating(false); return; }
    const ownerId = session.user.id;
    const tpl = selectedTemplate;
    const config = {
      pin: tplPin,
      dimensions: tpl.config?.dimensions || DEFAULT_DIMENSIONS,
    };
    const { data: proj, error } = await supabase.from('projects').insert({ name: tpl.name, description: tpl.description, config, owner_id: ownerId }).select().single();
    if (error || !proj) {
      console.error('[createFromTemplate] insert error:', error);
      const msg = error?.message || 'desconocido';
      const isRls = error?.code === '42501' || /row-level security/i.test(msg);
      setErr(isRls
        ? 'Tu sesión no coincide con el dueño esperado. Cierra sesión y vuelve a entrar.'
        : 'Error creando proyecto: ' + msg);
      setTplCreating(false);
      return;
    }
    await supabase.from('project_members').upsert(
      { project_id: proj.id, email: session.user.email, name: session.user.user_metadata?.full_name || session.user.email, user_id: ownerId },
      { onConflict: 'project_id,email' }
    );
    // Insert sample tasks
    const taskSchema = Array.isArray(tpl.tasks_schema) ? tpl.tasks_schema : [];
    if (taskSchema.length) {
      const sampleTasks = [];
      for (const [i, t] of taskSchema.entries()) {
        const { data: claimedId } = await supabase.rpc('claim_task_id');
        sampleTasks.push({
          id: claimedId || Date.now() + i, title: t.title, type: t.type || 'Operativa', status: t.status || 'Sin iniciar',
          project_id: proj.id, estimated_time: 5, difficulty: 5, strategic_value: 5,
          progress_percent: 0, subtasks: [], indicators: [],
        });
      }
      await supabase.from('tasks').insert(sampleTasks);
    }
    // Insert sample indicators
    const inds = Array.isArray(tpl.indicators) ? tpl.indicators : [];
    if (inds.length) {
      await supabase.from('indicators').insert(inds.map((name) => ({ name, project_id: proj.id })));
    }
    localStorage.setItem('pp_project_id', String(proj.id));
    onProjectLoaded(proj);
  };

  const joinProject = async () => {
    const code = joinCode.trim();
    if (!code) { setErr("Ingresa el código de invitación."); return; }
    setJoining(true); setErr("");
    const data = await joinProjectByCode(code, authUser);
    if (!data) { setErr("Código inválido o proyecto no encontrado."); setJoining(false); return; }
    localStorage.setItem('pp_project_id', String(data.id));
    onProjectLoaded(data);
  };

  const btnBase = { border: "none", borderRadius: 10, padding: "12px", cursor: "pointer", fontWeight: 700, fontSize: 14, width: "100%", transition: "all 0.2s" };
  const inp = { background: "#fafafa", border: "1.5px solid #e0e0e0", borderRadius: 8, padding: "10px 14px", fontSize: 14, outline: "none", fontFamily: "inherit", color: "#2d2d2d", width: "100%", boxSizing: "border-box", transition: "border-color 0.2s" };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#0d0d1a 0%,#1a1a2e 50%,#2d1b4e 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: (authUser && myProjects.length > 0) ? 920 : 460, transition: "max-width .3s ease" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 72, fontWeight: 900, background: "linear-gradient(135deg,#ec6c04,#f5a623,#149cac)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1, letterSpacing: -3 }}>P+</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 5, textTransform: "uppercase", marginTop: 6 }}>Productivity-Plus</div>
        </div>

        {/* Logged-in user */}
        {authUser && (
          <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
            {authUser.email} · <button onClick={() => supabase.auth.signOut()} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', fontFamily: 'inherit' }}>Cerrar sesión</button>
          </div>
        )}

        {/* My Projects */}
        {authUser && (loadingProjects ? (
          <div style={{ textAlign: 'center', marginBottom: 20, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Cargando proyectos...</div>
        ) : myProjects.length > 0 ? (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 10, textAlign: 'center' }}>Mis proyectos</div>
            {ownedCount >= 1 && (
              <div style={{ maxWidth: 460, margin: '0 auto 16px' }}>
                <button onClick={() => setShowConsolidated(true)} style={{ width: '100%', background: 'linear-gradient(135deg, rgba(20,156,172,0.22), rgba(84,44,156,0.22))', border: '1px solid rgba(20,156,172,0.4)', color: '#fff', borderRadius: 12, padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit' }}>
                  📊 Visión consolidada de mis tableros
                </button>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 12 }}>
              {myProjects.map(proj => {
                const isOwner = proj.owner_id === authUser.id;
                const inviter = ownerNames[proj.id];
                // Tablero invitado: acento teal + etiqueta de quién invitó, para
                // distinguirlo de los propios (acento naranja "PROPIETARIO").
                return (
                  <div key={proj.id}
                    onClick={() => { localStorage.setItem('pp_project_id', String(proj.id)); onProjectLoaded(proj); }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 28px rgba(0,0,0,0.35)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                    style={{
                      position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 120,
                      background: isOwner ? 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))' : 'linear-gradient(180deg, rgba(20,156,172,0.16), rgba(20,156,172,0.05))',
                      border: isOwner ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(20,156,172,0.45)',
                      borderLeft: isOwner ? '1px solid rgba(255,255,255,0.12)' : '3px solid #149cac',
                      borderRadius: 14, padding: '15px 16px', cursor: 'pointer',
                      transition: 'transform .15s ease, box-shadow .15s ease',
                    }}>
                    {isOwner && (
                      <button title="Borrar proyecto"
                        onClick={(e) => { e.stopPropagation(); setDeletingProject(proj); setDeleteConfirmText(''); setErr(''); }}
                        style={{ position: 'absolute', top: 10, right: 10, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.28)', borderRadius: 8, color: '#f87171', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                        🗑
                      </button>
                    )}
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#fff', lineHeight: 1.3, paddingRight: isOwner ? 34 : 0, marginBottom: proj.description ? 5 : 0 }}>{proj.name}</div>
                    {proj.description && (
                      <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{proj.description}</div>
                    )}
                    <div style={{ marginTop: 'auto', paddingTop: 12 }}>
                      {isOwner ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, color: '#f5a623', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ec6c04' }} />Propietario
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(20,156,172,0.18)', border: '1px solid rgba(20,156,172,0.4)', borderRadius: 999, padding: '3px 9px' }}>
                          <span style={{ fontSize: 10 }}>👥</span>
                          <span style={{ fontSize: 10, color: '#4dd8e8', fontWeight: 700, letterSpacing: 0.3 }}>Invitado{inviter ? ` por ${inviter}` : ''}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ textAlign: 'center', margin: '18px 0 4px', fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>o crea o únete a otro proyecto</div>
          </div>
        ) : null)}

        {/* Compra de plan visible antes de crear un tablero */}
        {authUser && (
          <div style={{ maxWidth: 460, margin: '0 auto 18px' }}>
            <PlansLauncher variant="landing" />
          </div>
        )}

        {/* Card */}
        <div style={{ maxWidth: 460, margin: "0 auto", background: "rgba(255,255,255,0.05)", backdropFilter: "blur(12px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 4, marginBottom: 28 }}>
            {[['join','Unirse'],['create','Crear'],['template','Plantillas']].map(([t, l]) => (
              <button key={t} onClick={() => { setTab(t); setErr(""); setSelectedTemplate(null); }}
                style={{ flex: 1, background: tab === t ? "rgba(236,108,4,0.9)" : "transparent", color: "#fff", border: "none", borderRadius: 8, padding: "9px", cursor: "pointer", fontWeight: tab === t ? 700 : 400, fontSize: 12, transition: "all 0.2s" }}>
                {l}
              </button>
            ))}
          </div>

          {tab === 'join' ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Código de invitación</label>
                <input style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                  value={joinCode} onChange={e => setJoinCode(e.target.value)} onKeyDown={e => e.key === "Enter" && joinProject()}
                  placeholder="Pega el código aquí..." autoFocus />
              </div>
              {err && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{err}</div>}
              <button onClick={joinProject} disabled={joining}
                style={{ ...btnBase, background: joining ? "#555" : "linear-gradient(135deg,#ec6c04,#f07d1e)", color: "#fff", boxShadow: joining ? "none" : "0 4px 20px rgba(236,108,4,0.4)", marginTop: 4 }}>
                {joining ? "Verificando..." : "Unirse al proyecto →"}
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Nombre del proyecto *</label>
                <input style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                  value={projName} onChange={e => setProjName(e.target.value)} placeholder="Ej: Equipo Comercial Q2" autoFocus />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Descripción (opcional)</label>
                <input style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                  value={projDesc} onChange={e => setProjDesc(e.target.value)} placeholder="Breve descripción del proyecto..." />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Clave de configuración *</label>
                <input type="password" style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                  value={projPin} onChange={e => setProjPin(e.target.value)} onKeyDown={e => e.key === "Enter" && createProject()} placeholder="Mínimo 4 caracteres..." />
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>Solo el dueño del proyecto conoce esta clave</div>
              </div>
              {authUser && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: atLimit ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${atLimit ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 8, padding: '8px 12px' }}>
                  <span style={{ fontSize: 11, color: atLimit ? '#f87171' : 'rgba(255,255,255,0.45)' }}>
                    Tableros creados: {ownedCount} / {projectLimit ?? '—'}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: isPremium ? '#f5a623' : 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>
                    {isPremium ? 'Premium' : 'Gratuito'}
                  </span>
                </div>
              )}
              {err && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{err}</div>}
              <button onClick={createProject} disabled={creating || atLimit}
                style={{ ...btnBase, background: (creating || atLimit) ? '#555' : 'linear-gradient(135deg,#542c9c,#6e3ebf)', color: '#fff', boxShadow: (creating || atLimit) ? 'none' : '0 4px 20px rgba(84,44,156,0.4)', marginTop: 4, opacity: atLimit ? 0.6 : 1, cursor: atLimit ? 'not-allowed' : 'pointer' }}>
                {creating ? 'Creando proyecto...' : atLimit ? `Límite de ${projectLimit} proyectos alcanzado` : 'Crear proyecto →'}
              </button>
            </div>
          )}

          {tab === 'template' && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {templates.length === 0 && (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", textAlign: "center", padding: "20px 0" }}>Cargando plantillas...</div>
              )}
              {!selectedTemplate ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {templates.map(tpl => (
                    <div key={tpl.id} onClick={() => setSelectedTemplate(tpl)} style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: "14px 16px", cursor: "pointer", transition: "all 0.2s" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{tpl.name}</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>{tpl.description}</div>
                      <div style={{ marginTop: 8, fontSize: 11, color: "rgba(236,108,4,0.8)" }}>
                        {(Array.isArray(tpl.tasks_schema) ? tpl.tasks_schema : []).length} tareas de ejemplo
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => setSelectedTemplate(null)} style={{ background: "rgba(255,255,255,0.1)", border: "none", color: "rgba(255,255,255,0.6)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>← Volver</button>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{selectedTemplate.name}</span>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Clave de configuración *</label>
                    <input type="password" style={{ ...inp, background: "rgba(255,255,255,0.08)", border: "1.5px solid rgba(255,255,255,0.15)", color: "#fff" }}
                      value={tplPin} onChange={e => setTplPin(e.target.value)} placeholder="Mínimo 4 caracteres..." autoFocus />
                  </div>
                  {authUser && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: atLimit ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${atLimit ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 8, padding: '8px 12px' }}>
                      <span style={{ fontSize: 11, color: atLimit ? '#f87171' : 'rgba(255,255,255,0.45)' }}>
                        Tableros creados: {ownedCount} / {projectLimit ?? '—'}
                      </span>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: isPremium ? '#f5a623' : 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>
                        {isPremium ? 'Premium' : 'Gratuito'}
                      </span>
                    </div>
                  )}
                  {err && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500 }}>{err}</div>}
                  <button onClick={createFromTemplate} disabled={tplCreating || atLimit}
                    style={{ ...btnBase, background: (tplCreating || atLimit) ? '#555' : 'linear-gradient(135deg,#ec6c04,#f07d1e)', color: '#fff', boxShadow: (tplCreating || atLimit) ? 'none' : '0 4px 20px rgba(236,108,4,0.4)', opacity: atLimit ? 0.6 : 1, cursor: atLimit ? 'not-allowed' : 'pointer' }}>
                    {tplCreating ? 'Creando...' : atLimit ? `Límite de ${projectLimit} proyectos alcanzado` : `Crear proyecto desde "${selectedTemplate.name}" →`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: 2 }}>
          PRODUCTIVITY-PLUS · GESTIÓN ESTRATÉGICA
        </div>
      </div>

      {/* ── Confirm-delete-project modal ─────────────────── */}
      {deletingProject && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
             onClick={() => { if (!deletingBusy) { setDeletingProject(null); setDeleteConfirmText(''); setErr(''); } }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ background: 'rgba(20,18,28,0.98)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 16, padding: '28px 28px 24px', maxWidth: 460, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#f87171', marginBottom: 8, letterSpacing: 0.3 }}>⚠ Borrar proyecto</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.55, marginBottom: 14 }}>
              Vas a borrar <strong style={{ color: '#fff' }}>"{deletingProject.name}"</strong>. Se eliminarán para siempre todas sus tareas, indicadores, OKRs, sprints, plantillas de campos, historial y miembros. <strong style={{ color: '#fcd34d' }}>Esta acción no se puede deshacer.</strong>
            </div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Escribe <code style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 6px', borderRadius: 4, color: '#fcd34d' }}>{DELETE_CONFIRM_PHRASE}</code> para confirmar
            </label>
            <input
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deletingBusy}
              placeholder={DELETE_CONFIRM_PHRASE}
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 12px', fontSize: 13, color: '#fff', outline: 'none', fontFamily: 'inherit', marginBottom: 12 }}
            />
            {err && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                disabled={deletingBusy}
                onClick={() => { setDeletingProject(null); setDeleteConfirmText(''); setErr(''); }}
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '9px 18px', color: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                Cancelar
              </button>
              <button
                disabled={deletingBusy || deleteConfirmText !== DELETE_CONFIRM_PHRASE}
                onClick={confirmDeleteProject}
                style={{ background: deleteConfirmText === DELETE_CONFIRM_PHRASE && !deletingBusy ? 'linear-gradient(135deg,#dc2626,#ef4444)' : 'rgba(220,38,38,0.3)', border: 'none', borderRadius: 8, padding: '9px 18px', color: '#fff', cursor: deleteConfirmText === DELETE_CONFIRM_PHRASE && !deletingBusy ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
                {deletingBusy ? 'Borrando…' : 'Borrar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showConsolidated && (
        <Suspense fallback={null}>
          <ConsolidatedDashboard
            authUser={authUser}
            onClose={() => setShowConsolidated(false)}
            onOpenProject={(proj) => { setShowConsolidated(false); localStorage.setItem('pp_project_id', String(proj.id)); onProjectLoaded(proj); }}
          />
        </Suspense>
      )}
    </div>
  );
}
