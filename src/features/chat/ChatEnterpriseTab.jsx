import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { getAuthJsonHeaders } from "../../lib/authHeaders";

// Chat en vivo del PO con la IA cargada con datos del equipo. Feature Pro Power+.
// Cada proyecto tiene su propia sesión activa por owner; el historial se persiste
// en chat_messages. Extraído del monolito (H-002), cargado con React.lazy.
// (El keyframe global "pulse" lo inyecta el árbol principal.)
export default function ChatEnterpriseTab({ projectId, isOwner }) {
  const [canUse, setCanUse] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [draftAssistant, setDraftAssistant] = useState("");
  const [error, setError] = useState("");
  const [quota, setQuota] = useState(null);  // {quota, used, remaining}

  const refreshQuota = async () => {
    const { data } = await supabase.rpc("project_chat_quota_remaining", { p_project_id: projectId });
    if (data) setQuota(data);
  };

  // Verifica feature y carga sesión activa.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled || !projectId) return;
      const { data: can } = await supabase.rpc("project_can_use_chat", { p_project_id: projectId });
      if (cancelled) return;
      setCanUse(can === true);
      if (can === true) {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: sess } = await supabase
          .from("chat_sessions")
          .select("id")
          .eq("project_id", projectId)
          .eq("owner_user_id", user?.id)
          .is("archived_at", null)
          .maybeSingle();
        if (cancelled) return;
        if (sess?.id) {
          setSessionId(sess.id);
          const { data: msgs } = await supabase
            .from("chat_messages")
            .select("role, content, created_at")
            .eq("session_id", sess.id)
            .order("created_at", { ascending: true });
          if (!cancelled) setHistory(msgs || []);
        }
        await refreshQuota();
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const send = async () => {
    const userMsg = input.trim();
    if (!userMsg || streaming) return;
    setError("");
    setStreaming(true);
    setDraftAssistant("");
    setHistory(h => [...h, { role: "user", content: userMsg, created_at: new Date().toISOString() }]);
    setInput("");

    try {
      const headers = await getAuthJsonHeaders();
      const res = await fetch("/api/chat-stream", {
        method: "POST", headers,
        body: JSON.stringify({ projectId, sessionId, userMessage: userMsg }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        // 429 = cuota mensual agotada: muestra el detalle y refresca contador.
        if (res.status === 429) {
          await refreshQuota();
          const renewLabel = e.renews_on ? new Date(e.renews_on).toLocaleDateString("es-CO", { day: "numeric", month: "long" }) : "el 1 del próximo mes";
          throw new Error(`Cuota mensual del chat alcanzada (${e.used}/${e.quota}). Se renueva el ${renewLabel}.`);
        }
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const sIdHeader = res.headers.get("X-Wplanner-Session");
      if (sIdHeader) setSessionId(Number(sIdHeader));

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistant = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        assistant += chunk;
        setDraftAssistant(assistant);
      }
      assistant += decoder.decode();
      setHistory(h => [...h, { role: "assistant", content: assistant, created_at: new Date().toISOString() }]);
      setDraftAssistant("");
      refreshQuota();  // descuenta el mensaje recién enviado en el contador
    } catch (err) {
      setError(err.message);
      setHistory(h => h.slice(0, -1)); // descarta el user msg si falló
      setInput(userMsg);
    }
    setStreaming(false);
  };

  if (canUse === null) return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Cargando…</div>;
  if (canUse === false) {
    return (
      <div style={{ padding: 40, textAlign: "center", border: "2px dashed #e0e0e0", borderRadius: 12 }}>
        <div style={{ fontSize: 56, marginBottom: 14 }}>🤖</div>
        <h3 style={{ margin: "0 0 8px 0", color: "#542c9c" }}>Chat IA en vivo</h3>
        <p style={{ color: "#666", fontSize: 14, maxWidth: 540, margin: "0 auto 16px" }}>
          Conversación en tiempo real con la IA cargada con tarjetas profesionales del equipo, reportes recientes y estado de tareas. Pregunta lo que quieras: "¿quién está sobrecargado?", "arma una célula para X", "¿por qué Diego se atrasa?".
        </p>
        <p style={{ color: "#999", fontSize: 12 }}>Esta función está incluida en el plan <b>Pro Power</b>.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 4 }}>
      <div style={{ background: "linear-gradient(135deg, #1e1e3a 0%, #542c9c 100%)", borderRadius: 12, padding: 20, marginBottom: 14, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 28 }}>🤖</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: "0 0 4px 0", fontSize: 20, fontWeight: 700 }}>Chat IA en vivo</h2>
            <p style={{ margin: 0, opacity: 0.85, fontSize: 13 }}>
              Conversa con tu consultor de talento. Tiene cargados los últimos 2 reportes mensuales, el último evolutivo y el estado actual del proyecto.
            </p>
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #e0e0e0", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Historial */}
        <div style={{ maxHeight: "55vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
          {history.length === 0 && !draftAssistant && !streaming && (
            <div style={{ textAlign: "center", color: "#999", fontSize: 13, padding: 40, fontStyle: "italic" }}>
              Empieza la conversación. Sugerencias:<br />
              <span style={{ fontSize: 12, color: "#bbb" }}>"¿Quién es el eje más crítico del proyecto ahora?"<br />"Arma una célula de 3 personas para un proyecto digital."<br />"¿Cómo está Diego este mes vs el anterior?"</span>
            </div>
          )}
          {history.map((m, i) => <ChatBubble key={i} role={m.role} content={m.content} />)}
          {streaming && draftAssistant && <ChatBubble role="assistant" content={draftAssistant + " ▌"} />}
          {streaming && !draftAssistant && (
            <div style={{ display: "flex", gap: 6, padding: 10, alignItems: "center" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#542c9c", animation: "pulse 1s infinite" }} />
              <span style={{ fontSize: 12, color: "#888" }}>Pensando…</span>
            </div>
          )}
        </div>

        {error && <div style={{ fontSize: 12, color: "#c0392b", padding: 8, background: "#fde8e8", borderRadius: 6 }}>{error}</div>}

        {/* Input */}
        {isOwner ? (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                disabled={streaming || (quota && quota.remaining <= 0)}
                placeholder={quota && quota.remaining <= 0
                  ? "Cuota mensual alcanzada, se renueva el 1 del próximo mes"
                  : "Pregunta sobre tu equipo... (Enter para enviar, Shift+Enter para nueva línea)"}
                style={{ flex: 1, minHeight: 60, maxHeight: 200, padding: 10, border: "1px solid #ddd", borderRadius: 8, fontSize: 14, fontFamily: "inherit", resize: "vertical" }}
              />
              <button onClick={send} disabled={!input.trim() || streaming || (quota && quota.remaining <= 0)}
                style={{
                  background: !input.trim() || streaming || (quota && quota.remaining <= 0) ? "#ddd" : "linear-gradient(135deg, #542c9c, #6e3ebf)",
                  color: "#fff", border: "none", borderRadius: 8, padding: "12px 18px",
                  cursor: !input.trim() || streaming || (quota && quota.remaining <= 0) ? "not-allowed" : "pointer",
                  fontSize: 13, fontWeight: 700,
                }}>
                {streaming ? "..." : "Enviar"}
              </button>
            </div>
            {quota && quota.quota > 0 && (() => {
              const pct = Math.min(100, (quota.used / quota.quota) * 100);
              const lowColor = quota.remaining <= 10 ? "#c0392b" : quota.remaining <= 30 ? "#ec6c04" : "#542c9c";
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#888", marginTop: 4 }}>
                  <span><b style={{ color: lowColor }}>{quota.used}</b> / {quota.quota} mensajes este mes</span>
                  <div style={{ flex: 1, height: 4, background: "#f0e8ff", borderRadius: 2, overflow: "hidden", maxWidth: 200 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: lowColor, transition: "width 0.3s" }} />
                  </div>
                  {quota.remaining <= 10 && <span style={{ color: lowColor, fontWeight: 600 }}>Te quedan {quota.remaining}</span>}
                </div>
              );
            })()}
          </>
        ) : (
          <div style={{ fontSize: 12, color: "#888", padding: 10, background: "#fafafa", borderRadius: 6, textAlign: "center" }}>
            Solo el owner del proyecto puede chatear con la IA.
          </div>
        )}
      </div>
    </div>
  );
}

function ChatBubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "85%",
        background: isUser ? "linear-gradient(135deg, #542c9c, #6e3ebf)" : "#f5f5f7",
        color: isUser ? "#fff" : "#222",
        borderRadius: 14,
        padding: "10px 14px",
        fontSize: 13.5,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        boxShadow: isUser ? "0 3px 12px rgba(84,44,156,0.18)" : "0 1px 3px rgba(0,0,0,0.05)",
      }}>{content}</div>
    </div>
  );
}
