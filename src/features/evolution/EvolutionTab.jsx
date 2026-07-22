import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { getAuthJsonHeaders } from "../../lib/authHeaders";
import { extractUsageMarker } from "../../aiModels";

// Evolutivo profesional del equipo (Pro Power+ con IA). Owner ve el histórico y
// puede generar uno nuevo (bimensual). El HTML se renderiza en un iframe
// sandboxed para aislar estilos. Extraído del monolito (H-002), cargado con lazy.
export default function EvolutionTab({ projectId, isOwner }) {
  const [canUse, setCanUse] = useState(null);
  const [evolutions, setEvolutions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState(0);

  const reload = async () => {
    if (!projectId) return;
    const [{ data: can }, { data: list }] = await Promise.all([
      supabase.rpc("project_can_use_evolutivo", { p_project_id: projectId }),
      supabase.from("user_evolutions")
        .select("id, period_start, period_end, generated_at, model_used, tokens_input, tokens_output, status")
        .eq("project_id", projectId)
        .order("period_end", { ascending: false }),
    ]);
    setCanUse(can === true);
    setEvolutions(list || []);
    if (list?.length && !selectedId) setSelectedId(list[0].id);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await reload();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const generateNow = async () => {
    setGenerating(true);
    setMsg("Generando tarjetas profesionales del equipo...");
    setProgress(0);
    try {
      // Periodo: últimos 60 días.
      const today = new Date();
      const start = new Date(today); start.setDate(today.getDate() - 60);
      const fmt = (d) => d.toISOString().split("T")[0];
      const periodStart = fmt(start);
      const periodEnd = fmt(today);

      const headers = await getAuthJsonHeaders();
      const genRes = await fetch("/api/generate-evolution", {
        method: "POST",
        headers,
        body: JSON.stringify({ projectId, periodStart, periodEnd }),
      });
      if (!genRes.ok) {
        const e = await genRes.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${genRes.status}`);
      }

      // Acumula stream
      let html = "";
      if (genRes.body?.getReader) {
        const reader = genRes.body.getReader();
        const decoder = new TextDecoder();
        let chunks = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          html += decoder.decode(value, { stream: true });
          chunks++;
          setProgress(html.length);
          if (chunks % 10 === 0) setMsg(`Generando... ${(html.length/1024).toFixed(1)} KB recibidos`);
        }
        html += decoder.decode();
      } else {
        html = await genRes.text();
      }

      setMsg("Guardando...");
      // El stream adjunta el costo real (Opus 4.8) como un comentario HTML al
      // final, porque los tokens de salida solo se conocen cuando Anthropic
      // termina de generar (no pueden ir en un header de la respuesta). Se
      // extrae acá, best-effort: si algo falla, se guarda igual el evolutivo
      // con el HTML crudo, solo sin metadata de costo (el costo es dato
      // secundario, nunca debe bloquear el guardado del reporte).
      let cleanHtml = html;
      let usage = null;
      try {
        const extracted = extractUsageMarker(html);
        cleanHtml = extracted.html;
        usage = extracted.usage;
      } catch (e) {
        console.warn("[evolution] No pude extraer métricas de uso:", e?.message);
      }

      const saveRes = await fetch("/api/save-evolution", {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectId, periodStart, periodEnd, html: cleanHtml,
          modelUsed: usage?.model,
          tokensInput: usage?.tokens_input,
          tokensOutput: usage?.tokens_output,
          costUsd: usage?.cost_usd,
          truncated: html.includes("WPLANNER_TRUNCATED"),
        }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok) throw new Error(saved.error || "Error guardando");

      setMsg("✓ Evolutivo generado y guardado");
      setTimeout(() => setMsg(""), 4000);
      await reload();
      setSelectedId(saved.evolution?.id);
    } catch (err) {
      setMsg("Error: " + err.message);
    }
    setGenerating(false);
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando evolutivo…</div>;

  if (canUse === false) {
    return (
      <div style={{ padding: 40, textAlign: "center", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
        <div style={{ fontSize: 56, marginBottom: 14 }}>💎</div>
        <h3 style={{ margin: "0 0 8px 0", color: "#542c9c" }}>Evolutivo profesional</h3>
        <p style={{ color: "#666", fontSize: 14, maxWidth: 540, margin: "0 auto 16px" }}>
          Tarjetas profesionales por miembro con rol detectado, fortalezas, oportunidades, y recomendaciones de células para distintos tipos de proyecto. Esta feature requiere <b>Pro Power</b> o <b>Enterprise</b> con IA activa en este proyecto.
        </p>
        <p style={{ color: "#999", fontSize: 12 }}>Configúralo en Configuración del proyecto.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 4 }}>
      {/* Cabecera */}
      <div style={{ background: "linear-gradient(135deg, #542c9c 0%, #f5a623 100%)", borderRadius: 12, padding: 22, marginBottom: 18, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: "0 0 4px 0", fontSize: 22, fontWeight: 700 }}>💎 Evolutivo profesional</h2>
            <p style={{ margin: 0, opacity: 0.92, fontSize: 13 }}>
              Tarjetas individuales con rol detectado, fortalezas, oportunidades y recomendaciones de células para tu equipo. Reporte privado: solo tú lo ves.
            </p>
          </div>
          {isOwner && (
            <button onClick={generateNow} disabled={generating}
              style={{ background: "#fff", color: "#542c9c", border: "none", borderRadius: 8, padding: "10px 18px", cursor: generating ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, boxShadow: "0 3px 12px rgba(0,0,0,0.15)" }}>
              {generating ? "⏳ Generando..." : "🤖 Generar nueva tarjeta del equipo"}
            </button>
          )}
        </div>
        {msg && (
          <div style={{ marginTop: 12, fontSize: 12, padding: "6px 10px", background: "rgba(255,255,255,0.15)", borderRadius: 6 }}>
            {msg}
            {generating && progress > 0 && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {(progress/1024).toFixed(1)} KB</span>}
          </div>
        )}
      </div>

      {evolutions.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#888", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
          <div style={{ fontSize: 14, color: "#555", marginBottom: 6 }}>Aún no hay evolutivos generados.</div>
          {isOwner && <div style={{ fontSize: 12, color: "#888" }}>Genera el primero con el botón de arriba. Tarda ~1-2 min.</div>}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14 }}>
          {/* Lista lateral */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Histórico</div>
            {evolutions.map(e => (
              <button key={e.id}
                onClick={() => setSelectedId(e.id)}
                style={{
                  background: selectedId === e.id ? "linear-gradient(135deg,#542c9c,#6e3ebf)" : "#fff",
                  color: selectedId === e.id ? "#fff" : "#333",
                  border: "1px solid " + (selectedId === e.id ? "#542c9c" : "#e0e0e0"),
                  borderRadius: 8, padding: "10px 12px", cursor: "pointer",
                  textAlign: "left", fontSize: 12,
                }}>
                <div style={{ fontWeight: 600, marginBottom: 3 }}>
                  {new Date(e.period_start).toLocaleDateString("es-CO", { day: "numeric", month: "short" })} → {new Date(e.period_end).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}
                </div>
                <div style={{ fontSize: 10, opacity: 0.75 }}>
                  {new Date(e.generated_at).toLocaleDateString("es-CO")} · {e.status}
                </div>
              </button>
            ))}
          </div>

          {/* Vista del evolutivo seleccionado */}
          <div style={{ background: "#fff", borderRadius: 12, padding: 0, border: "1px solid #e0e0e0", overflow: "hidden" }}>
            {selectedId ? (
              <EvolutionRender id={selectedId} />
            ) : (
              <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Selecciona un evolutivo del histórico.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EvolutionRender({ id }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      const { data } = await supabase.from("user_evolutions").select("html").eq("id", id).maybeSingle();
      if (cancelled) return;
      setHtml(data?.html || "<p>No hay HTML guardado para este evolutivo.</p>");
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>;

  // Render en iframe sandboxed para aislar estilos del resto de la app.
  return (
    <iframe
      title="Evolutivo profesional"
      srcDoc={html}
      style={{ width: "100%", height: "75vh", border: "none", background: "#fff" }}
      sandbox="allow-same-origin"
    />
  );
}
