import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { getAuthJsonHeaders } from "../../lib/authHeaders";
import { calcAporte } from "../../lib/aporte";
import { getColombiaNow } from "../../lib/format";
import { STATUS_COLORS } from "../../constants";

// "Mi Día": tareas activas del usuario, ordenadas por vencimiento y aporte, con
// acciones rápidas de estado. Incluye el banner de retros pendientes (cluster
// retros: PendingRetrosBanner + SprintRetroForm, solo usado aquí). Extraído del
// monolito (H-002), cargado con React.lazy.

const RETRO_EMOJIS = [
  { e: "🔥", label: "Acelerado, en flujo" },
  { e: "💪", label: "Fuerte, listo" },
  { e: "😄", label: "Motivado" },
  { e: "😍", label: "Encantado" },
  { e: "🌟", label: "Reconocido" },
  { e: "🤝", label: "En equipo" },
  { e: "😐", label: "Neutral" },
  { e: "🥱", label: "Aburrido / repetitivo" },
  { e: "😟", label: "Preocupado" },
  { e: "😅", label: "Apenas alcancé" },
  { e: "😴", label: "Agotado" },
  { e: "😡", label: "Frustrado" },
];

function SprintRetroForm({ periodId, sprintName, projectId, onClose, onSubmitted }) {
  const [emoji, setEmoji] = useState(null);
  const [liked, setLiked] = useState("");
  const [disliked, setDisliked] = useState("");
  const [peerStrategic, setPeerStrategic] = useState("");
  const [peerGiveMore, setPeerGiveMore] = useState("");
  const [peerHadItTough, setPeerHadItTough] = useState("");
  const [participants, setParticipants] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled || !projectId) return;
      const { data } = await supabase.from("participants").select("name").eq("project_id", projectId);
      if (!cancelled) setParticipants((data || []).map(p => p.name).sort());
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const submit = async () => {
    if (!emoji) { setError("Elige un emoji"); return; }
    if (!liked.trim()) { setError("Describe brevemente qué te gustó"); return; }
    if (!disliked.trim()) { setError("Describe brevemente qué no te gustó"); return; }
    setBusy(true); setError("");
    try {
      const headers = await getAuthJsonHeaders();
      const res = await fetch("/api/submit-retro", {
        method: "POST", headers,
        body: JSON.stringify({
          periodId, emoji, liked, disliked,
          peerStrategic: peerStrategic || null,
          peerCouldGiveMore: peerGiveMore || null,
          peerHadItTough: peerHadItTough || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      onSubmitted();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 22, maxWidth: 640, width: "100%", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, color: "#542c9c", fontSize: 18 }}>Retro · {sprintName}</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, cursor: "pointer", color: "#888" }}>×</button>
        </div>

        {/* Emoji selector */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 8 }}>¿Cómo te sentiste al cerrar este sprint?</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {RETRO_EMOJIS.map(({ e, label }) => (
              <button key={e} title={label}
                onClick={() => setEmoji(e)}
                style={{
                  background: emoji === e ? "#542c9c22" : "#fafafa",
                  border: `2px solid ${emoji === e ? "#542c9c" : "#e0e0e0"}`,
                  borderRadius: 10, padding: "8px 10px", cursor: "pointer",
                  fontSize: 22, lineHeight: 1,
                }}>
                {e}
              </button>
            ))}
          </div>
        </div>

        {/* Liked */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#27ae60", marginBottom: 6 }}>✨ Lo que me gustó del sprint (1 párrafo max)</div>
          <textarea value={liked} onChange={e => setLiked(e.target.value)} maxLength={2000}
            placeholder="Cuéntame qué fluyó, qué disfrutaste, qué te sumó..."
            style={{ width: "100%", minHeight: 70, padding: 10, border: "1px solid #ddd", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}/>
          <div style={{ fontSize: 10, color: "#bbb", textAlign: "right" }}>{liked.length}/2000</div>
        </div>

        {/* Disliked */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#e74c3c", marginBottom: 6 }}>⚠ Lo que no me gustó (1 párrafo max)</div>
          <textarea value={disliked} onChange={e => setDisliked(e.target.value)} maxLength={2000}
            placeholder="Qué te frenó, qué te frustró, qué cambiarías..."
            style={{ width: "100%", minHeight: 70, padding: 10, border: "1px solid #ddd", borderRadius: 6, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}/>
          <div style={{ fontSize: 10, color: "#bbb", textAlign: "right" }}>{disliked.length}/2000</div>
        </div>

        {/* Peer signals */}
        <div style={{ background: "#fafafa", borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 8, fontStyle: "italic" }}>
            Las siguientes señalizaciones son <b>anónimas</b> para el resto del equipo. El PO solo ve conteos agregados.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#27ae60", marginBottom: 4 }}>🌟 Quien aportó más estratégicamente</div>
              <select value={peerStrategic} onChange={e => setPeerStrategic(e.target.value)}
                style={{ width: "100%", padding: 7, border: "1px solid #ddd", borderRadius: 5, fontSize: 12 }}>
                <option value="">(opcional)</option>
                {participants.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#ef7218", marginBottom: 4 }}>⚡ Quien podría dar más</div>
              <select value={peerGiveMore} onChange={e => setPeerGiveMore(e.target.value)}
                style={{ width: "100%", padding: 7, border: "1px solid #ddd", borderRadius: 5, fontSize: 12 }}>
                <option value="">(opcional)</option>
                {participants.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#c0392b", marginBottom: 4 }}>💔 Quien la pasó difícil</div>
              <select value={peerHadItTough} onChange={e => setPeerHadItTough(e.target.value)}
                style={{ width: "100%", padding: 7, border: "1px solid #ddd", borderRadius: 5, fontSize: 12 }}>
                <option value="">(opcional)</option>
                {participants.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>

        {error && <div style={{ background: "#fde8e8", color: "#c0392b", padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={busy} style={{ background: "#fff", border: "1px solid #ddd", color: "#555", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13 }}>Cerrar</button>
          <button onClick={submit} disabled={busy} style={{ background: busy ? "#ddd" : "linear-gradient(135deg,#542c9c,#6e3ebf)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", cursor: busy ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700 }}>
            {busy ? "Enviando..." : "Enviar retro"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PendingRetrosBanner() {
  const [pending, setPending] = useState([]);
  const [formPeriodId, setFormPeriodId] = useState(null);
  const [formSprintName, setFormSprintName] = useState("");
  const [formProjectId, setFormProjectId] = useState(null);

  const load = async () => {
    const { data } = await supabase.rpc("sprint_retro_pending_for_user");
    setPending(data || []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => { if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, []);

  if (pending.length === 0) return null;

  return (
    <>
      <div style={{ background: "linear-gradient(135deg,#f5a623,#ef7218)", color: "#fff", padding: 14, borderRadius: 10, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, boxShadow: "0 4px 14px rgba(245,166,35,0.3)" }}>
        <div style={{ fontSize: 22 }}>📋</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            Tienes {pending.length} retro{pending.length === 1 ? "" : "s"} de sprint pendiente{pending.length === 1 ? "" : "s"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.92, marginTop: 2 }}>
            Tu opinión ayuda al equipo a mejorar. Toma menos de 5 minutos.
          </div>
        </div>
        <button
          onClick={() => {
            setFormPeriodId(pending[0].period_id);
            setFormSprintName(pending[0].sprint_name);
            setFormProjectId(pending[0].project_id);
          }}
          style={{ background: "#fff", color: "#ef7218", border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
          Responder ahora
        </button>
      </div>
      {formPeriodId && (
        <SprintRetroForm
          periodId={formPeriodId}
          sprintName={formSprintName}
          projectId={formProjectId}
          onClose={() => setFormPeriodId(null)}
          onSubmitted={() => { setFormPeriodId(null); load(); }}
        />
      )}
    </>
  );
}

export default function FocusTab({ tasks, activeUser, updateTask, dimensions }) {
  const today = new Date().toISOString().split('T')[0];

  const myTasks = useMemo(() => {
    if (!activeUser) return [];
    return tasks
      .filter(t => t.responsible === activeUser.name && !['Finalizada', 'Cancelada'].includes(t.status))
      .sort((a, b) => {
        const ao = a.endDate && a.endDate < today ? 1 : 0;
        const bo = b.endDate && b.endDate < today ? 1 : 0;
        if (bo !== ao) return bo - ao;
        return calcAporte(b, dimensions) - calcAporte(a, dimensions);
      });
  }, [tasks, activeUser, dimensions, today]);

  const setStatus = async (task, newStatus) => {
    await updateTask({ ...task, status: newStatus, ...(newStatus === 'Finalizada' && !task.finalizedAt ? { finalizedAt: getColombiaNow() } : {}) });
  };

  const emoji = { 'Sin iniciar': '⏳', 'En proceso': '🔄', 'En pausa': '⏸', 'Bloqueada': '🔒', 'Finalizada': '✅' };

  return (
    <div>
      {/* Banner de retros pendientes (bloqueo blando) */}
      <PendingRetrosBanner />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#542c9c' }}>
          Mi Día {activeUser && <span style={{ fontWeight: 400, fontSize: 14, color: '#888' }}>· {activeUser.name}</span>}
        </div>
        {myTasks.length > 0 && <span style={{ fontSize: 12, color: '#969696', marginLeft: 'auto' }}>{myTasks.length} tarea{myTasks.length !== 1 ? 's' : ''} activa{myTasks.length !== 1 ? 's' : ''}</span>}
      </div>

      {!activeUser && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#969696' }}>Inicia sesión con tu perfil para ver tus tareas.</div>
      )}

      {activeUser && myTasks.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#27ae60', marginBottom: 8 }}>¡Todo al día!</div>
          <div style={{ fontSize: 13, color: '#969696' }}>No tienes tareas activas asignadas.</div>
        </div>
      )}

      {myTasks.map(t => {
        const isOverdue = t.endDate && t.endDate < today;
        const aporte = calcAporte(t, dimensions);
        return (
          <div key={t.id} style={{
            background: '#fff', borderRadius: 14, padding: '14px 18px', marginBottom: 10,
            boxShadow: '0 2px 14px rgba(84,44,156,0.07)',
            borderLeft: `4px solid ${isOverdue ? '#c0392b' : STATUS_COLORS[t.status] || '#888'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 10, color: '#969696' }}>#{t.id}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#2d2d2d' }}>{t.title}</span>
                  {isOverdue && <span style={{ fontSize: 10, fontWeight: 700, background: '#fde8e8', color: '#c0392b', padding: '1px 7px', borderRadius: 8 }}>VENCIDA</span>}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#888', flexWrap: 'wrap' }}>
                  <span>{emoji[t.status] || '•'} {t.status}</span>
                  {t.endDate && <span>🏁 {t.endDate}</span>}
                  <span style={{ color: '#ec6c04', fontWeight: 600 }}>★ {aporte.toFixed(1)}</span>
                  {t.progressPercent > 0 && <span>{Number(t.progressPercent).toFixed(0)}%</span>}
                </div>
                {t.subtasks?.length > 0 && (
                  <div style={{ marginTop: 5, height: 4, background: '#f0e8ff', borderRadius: 2, overflow: 'hidden', maxWidth: 180 }}>
                    <div style={{ height: '100%', width: `${t.progressPercent || 0}%`, background: '#ec6c04', borderRadius: 2 }} />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                {['En proceso', 'En pausa', 'Finalizada'].filter(s => s !== t.status).map(s => (
                  <button key={s} onClick={() => setStatus(t, s)} style={{
                    border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 11, padding: '5px 10px',
                    background: s === 'Finalizada' ? 'linear-gradient(135deg,#27ae60,#2ecc71)' : s === 'En proceso' ? 'linear-gradient(135deg,#ec6c04,#f07d1e)' : '#f4f4f4',
                    color: (s === 'Finalizada' || s === 'En proceso') ? '#fff' : '#666',
                    title: s,
                  }}>
                    {s === 'Finalizada' ? '✓' : s === 'En proceso' ? '▶' : '⏸'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
