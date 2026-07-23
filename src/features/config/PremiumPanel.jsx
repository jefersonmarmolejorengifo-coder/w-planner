import { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { getAuthJsonHeaders } from "../../lib/authHeaders";

// Dos cards: (1) estado de suscripción del usuario actual + botón upgrade,
// y (2) toggle "Activar IA en este proyecto" si el usuario es owner. El
// toggle llama a la RPC set_project_ia_enabled que valida capacidad del tier.
// Extraído del monolito (H-002).
export default function PremiumPanel({ projectId }) {
  const [capacity, setCapacity] = useState(null);
  const [project, setProject] = useState(null);
  const [authUser, setAuthUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalErr, setPortalErr] = useState("");

  // Abre el panel central de Soft a Tu Medida (Hub) con un link firmado. La
  // firma la hace el servidor (/api/subscription-portal) con el email del JWT;
  // acá solo pedimos la URL ya firmada y navegamos a ella.
  const abrirPortal = async () => {
    setPortalBusy(true);
    setPortalErr("");
    try {
      const headers = await getAuthJsonHeaders();
      const res = await fetch("/api/subscription-portal", { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        throw new Error(data.error || "No pudimos abrir el panel de gestión.");
      }
      window.location.assign(data.url);
    } catch (e) {
      setPortalErr(e instanceof Error ? e.message : "Error inesperado.");
      setPortalBusy(false);
    }
  };

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setAuthUser(user);
    if (!user || !projectId) { setLoading(false); return; }

    const [{ data: cap }, { data: proj }] = await Promise.all([
      supabase.rpc("user_ia_capacity").single(),
      supabase.from("projects").select("id, owner_id, name, ia_enabled").eq("id", projectId).maybeSingle(),
    ]);
    setCapacity(cap || null);
    setProject(proj || null);
    setLoading(false);
  };

  useEffect(() => {
    // Lint react-hooks/set-state-in-effect: hacemos setState dentro del async
    // function (no en el body síncrono del effect), eso pasa.
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const toggleIa = async (next) => {
    setBusy(true);
    setMsg(next ? "Activando IA en el proyecto…" : "Desactivando IA…");
    const { error } = await supabase.rpc("set_project_ia_enabled", { p_project_id: projectId, p_enabled: next });
    setBusy(false);
    if (error) {
      setMsg("⚠ " + error.message);
      return;
    }
    setMsg(next ? "✓ IA activa en este proyecto" : "✓ IA desactivada");
    setTimeout(() => setMsg(""), 3000);
    await load();
  };

  if (loading) {
    return <div style={{ padding: 12, color: "#888", fontSize: 13 }}>Cargando estado premium…</div>;
  }
  if (!capacity) {
    return (
      <div style={{ background: "#fff8e0", border: "1px solid #f0c060", padding: 14, borderRadius: 10, fontSize: 13 }}>
        ⚠️ Aplica la migración 016 para activar el sistema premium.
      </div>
    );
  }

  const isOwner = project?.owner_id === authUser?.id;
  const tier = capacity.tier;
  const status = capacity.status;
  const isPaid = tier !== "free" && status === "active";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Card 1: Estado de la suscripción del usuario */}
      <div style={{
        background: isPaid ? "linear-gradient(135deg, #2d2d54 0%, #542c9c 100%)" : "#fff",
        color: isPaid ? "#fff" : "#333",
        borderRadius: 14, padding: 18,
        border: isPaid ? "none" : "1px solid #f0e8d6",
        boxShadow: isPaid ? "0 8px 24px rgba(84,44,156,0.25)" : "0 2px 8px rgba(0,0,0,0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 22 }}>{isPaid ? "💎" : "🆓"}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Plan {capacity.display_name}</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Estado: <b>{status}</b> · IA: <b>{capacity.ia_current}/{capacity.ia_max}</b> proyectos · Total: <b>{capacity.total_current}/{capacity.total_max}</b>
            </div>
          </div>
        </div>

        {!isPaid && (
          <div style={{ fontSize: 13, color: "#666", marginTop: 12 }}>
            Activa un plan Pro para habilitar la IA en tus tableros. Usa el botón <b>✨ Planes</b> en la barra superior para ver y elegir tu plan.
          </div>
        )}

        {isPaid && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.9, marginBottom: 10 }}>
              Suscripción activa. Gestiona o cancela tu plan desde el panel de Soft a Tu Medida.
            </div>
            <button
              type="button"
              onClick={abrirPortal}
              disabled={portalBusy}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: "rgba(255,255,255,0.15)", color: "#fff",
                border: "1px solid rgba(255,255,255,0.35)", borderRadius: 8,
                padding: "8px 14px", fontSize: 13, fontWeight: 600,
                cursor: portalBusy ? "default" : "pointer", opacity: portalBusy ? 0.7 : 1,
              }}
            >
              {portalBusy ? "Abriendo…" : "Gestionar o cancelar mi plan"}
              {!portalBusy && <span aria-hidden="true">↗</span>}
            </button>
            {portalErr && (
              <div role="alert" style={{ fontSize: 12, color: "#ffd7d7", marginTop: 8 }}>{portalErr}</div>
            )}
          </div>
        )}
      </div>

      {/* Card 2: Toggle IA en este proyecto (solo owner) */}
      {isOwner && (
        <div style={{ background: "#fff", borderRadius: 14, padding: 18, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", border: "1px solid #e8e0f4" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 22 }}>🤖</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#333" }}>IA en este proyecto</div>
              <div style={{ fontSize: 12, color: "#777", marginTop: 2 }}>
                {project?.ia_enabled
                  ? "Activa. Los reportes IA pueden dispararse manualmente o por cron."
                  : "Inactiva. Los reportes IA están bloqueados hasta que la actives."}
              </div>
            </div>
            <button
              onClick={() => toggleIa(!project?.ia_enabled)}
              disabled={busy}
              style={{
                background: project?.ia_enabled
                  ? "linear-gradient(135deg, #27ae60, #2ecc71)"
                  : capacity.can_enable_more
                    ? "linear-gradient(135deg, #ef7218, #f5a623)"
                    : "#bbb",
                color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px",
                cursor: busy ? "not-allowed" : "pointer",
                fontSize: 13, fontWeight: 700,
                boxShadow: "0 3px 12px rgba(0,0,0,0.15)",
              }}>
              {project?.ia_enabled ? "Desactivar" : capacity.can_enable_more ? "Activar IA" : "Sin capacidad"}
            </button>
          </div>
          {!project?.ia_enabled && !capacity.can_enable_more && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#c0392b", padding: 10, background: "#fde8e8", borderRadius: 6 }}>
              {tier === "free"
                ? "El plan Gratis no incluye IA. Sube a Pro Solo o superior."
                : status !== "active"
                  ? `Tu suscripción no está activa (status: ${status}).`
                  : `Llegaste al límite de ${capacity.ia_max} proyectos con IA del plan ${capacity.display_name}. Desactiva IA en otro proyecto o sube de tier.`}
            </div>
          )}
        </div>
      )}

      {msg && (
        <div style={{ fontSize: 13, padding: 10, borderRadius: 6, background: msg.startsWith("Error") || msg.startsWith("⚠") ? "#fde8e8" : "#e8f8ee", color: msg.startsWith("Error") || msg.startsWith("⚠") ? "#c0392b" : "#27ae60" }}>
          {msg}
        </div>
      )}
    </div>
  );
}
