import { useState, useEffect } from "react";
import { supabase } from '../../supabaseClient';

// ─── PulseList ─────────────────────────────────────────────
function PulseList({ title, color, items }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 6 }}>{title}</div>
      {items.length === 0 ? (
        <div style={{ fontSize: 11, color: "#bbb", fontStyle: "italic" }}>(sin votos)</div>
      ) : items.slice(0, 5).map(([name, c]) => (
        <div key={name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", fontSize: 12, color: "#444" }}>
          <span style={{ background: color, color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: "center" }}>{c}</span>
          <span>{name}</span>
        </div>
      ))}
    </div>
  );
}

// ─── SprintPulseCard ───────────────────────────────────────
function SprintPulseCard({ pulse }) {
  const emojis = Object.entries(pulse.emoji_breakdown || {}).sort((a,b) => b[1] - a[1]);
  const warriors = Object.entries(pulse.strategic_warriors || {}).sort((a,b) => b[1] - a[1]);
  const giveMore = Object.entries(pulse.could_give_more || {}).sort((a,b) => b[1] - a[1]);
  const tough = Object.entries(pulse.had_it_tough || {}).sort((a,b) => b[1] - a[1]);

  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 18, border: "1px solid #e0e0e0", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#333" }}>{pulse.sprint_name}</div>
          <div style={{ fontSize: 11, color: "#888" }}>
            {pulse.start_date} → {pulse.end_date} · {pulse.total_respondents} respondieron · estado: {pulse.period_status}
          </div>
        </div>
        {emojis.length > 0 && (
          <div style={{ background: "#f5f5f7", padding: "6px 12px", borderRadius: 8, fontSize: 18 }}>
            {emojis.map(([e, c]) => <span key={e} title={`${c} votos`}>{e}<sub style={{ fontSize: 9, color: "#888", marginLeft: 1, marginRight: 5 }}>{c}</sub></span>)}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
        <PulseList title="🌟 Guerreros estratégicos" color="#27ae60" items={warriors} />
        <PulseList title="⚡ Podrían dar más" color="#ef7218" items={giveMore} />
        <PulseList title="💔 La pasaron difícil" color="#c0392b" items={tough} />
      </div>

      {(pulse.liked_aggregate || pulse.disliked_aggregate) && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "#542c9c", fontWeight: 600 }}>Ver respuestas textuales del equipo</summary>
          {pulse.liked_aggregate && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#27ae60", marginBottom: 4 }}>✨ Lo que les gustó:</div>
              <div style={{ background: "#f8fdf9", padding: 10, borderRadius: 6, fontSize: 12, color: "#333", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{pulse.liked_aggregate}</div>
            </div>
          )}
          {pulse.disliked_aggregate && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#e74c3c", marginBottom: 4 }}>⚠ Lo que no les gustó:</div>
              <div style={{ background: "#fdf8f8", padding: 10, borderRadius: 6, fontSize: 12, color: "#333", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{pulse.disliked_aggregate}</div>
            </div>
          )}
        </details>
      )}
    </div>
  );
}

// ─── TeamPulseTab ──────────────────────────────────────────
// Vista del owner: pulso del equipo sprint a sprint. Emojis dominantes,
// guerreros reconocidos, oportunidades, quienes la pasaron difícil, y un
// resumen textual agregado de lo que el equipo dijo. Anónimo en conteos.
// Props: projectId (string), isOwner (bool).
// sprints y participants se reciben pero no se usan directamente aquí;
// los datos reales vienen del RPC team_pulse_for_project.
export default function TeamPulseTab({ projectId, isOwner }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled || !projectId) return;
      // Verifica feature
      const { data: feat } = await supabase.rpc("project_has_feature", { p_project_id: projectId, p_feature: "team_pulse" });
      if (cancelled) return;
      if (feat !== true) {
        setError("Esta feature requiere plan Pro Solo o superior con IA activa en el proyecto.");
        setLoading(false);
        return;
      }
      const { data: pulse, error: pErr } = await supabase.rpc("team_pulse_for_project", { p_project_id: projectId });
      if (cancelled) return;
      if (pErr) setError(pErr.message);
      else setData(pulse || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando pulso del equipo…</div>;
  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
        <div style={{ fontSize: 56, marginBottom: 14 }}>🌡</div>
        <h3 style={{ margin: "0 0 8px 0", color: "#542c9c" }}>Pulso del equipo</h3>
        <p style={{ color: "#666", fontSize: 13, maxWidth: 500, margin: "0 auto" }}>{error}</p>
      </div>
    );
  }
  if (!isOwner) {
    return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Esta vista es solo para el owner del proyecto.</div>;
  }

  return (
    <div style={{ padding: 4 }}>
      <div style={{ background: "linear-gradient(135deg,#542c9c,#0aa0ab)", borderRadius: 12, padding: 20, marginBottom: 18, color: "#fff" }}>
        <h2 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 700 }}>🌡 Pulso del equipo</h2>
        <p style={{ margin: 0, opacity: 0.92, fontSize: 13 }}>
          Sentimiento sprint a sprint según lo que el propio equipo te cuenta. Las señalizaciones son anónimas: solo ves conteos agregados.
        </p>
      </div>

      {data.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 14, color: "#555" }}>Aún no hay retrospectivas registradas.</div>
          <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
            Cuando cierres un sprint o pasen 3 días desde su end_date, se abrirá la retro automáticamente y los participantes recibirán un correo.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {data.map(p => <SprintPulseCard key={p.period_id} pulse={p} />)}
        </div>
      )}
    </div>
  );
}
