// Recibe la retrospectiva de un miembro al cierre de un sprint.
// Body: {
//   periodId, emoji, liked, disliked,
//   peerStrategic: "Nombre"|null,
//   peerCouldGiveMore: "Nombre"|null,
//   peerHadItTough: "Nombre"|null
// }
//
// CAMBIO B-5: todo el ciclo select+update/insert+delete+insert fue reemplazado
// por una única llamada RPC `submit_sprint_retro` (migración 039). La función
// PL/pgSQL ejecuta el upsert del retro + el reemplazo de señales en una sola
// transacción Postgres. Si cualquier paso falla, Postgres hace ROLLBACK de todo:
// nunca queda un estado con señales borradas y sin insertar.
//
// Antes del fix: 5 operaciones independientes → posible corrupción silenciosa
//   (DELETE de señales → INSERT de señales fallaba → console.warn → 200 OK).
// Después del fix: 1 llamada RPC → error real → 500 con mensaje → sin pérdida.

import {
  applyCors,
  createSupabase,
  getAuthenticatedUser,
  getBearerToken,
  handleApiError,
} from "./_auth.js";

export const config = { runtime: "nodejs", maxDuration: 15 };

const ALLOWED_EMOJIS = ["😄","😐","😟","😡","🥱","🔥","💪","😴","😍","😅","🤝","🌟"];

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      periodId, emoji, liked, disliked,
      peerStrategic, peerCouldGiveMore, peerHadItTough,
    } = req.body || {};

    // ── Validación de entrada (sin cambios respecto al código anterior) ───────
    if (!periodId) return res.status(400).json({ error: "periodId requerido" });
    if (!ALLOWED_EMOJIS.includes(emoji)) return res.status(400).json({ error: "emoji invalido" });
    if (!liked || liked.trim().length === 0) return res.status(400).json({ error: "liked vacio" });
    if (!disliked || disliked.trim().length === 0) return res.status(400).json({ error: "disliked vacio" });
    if (liked.length > 2000 || disliked.length > 2000) return res.status(400).json({ error: "texto demasiado largo" });

    const token = getBearerToken(req);
    const user = await getAuthenticatedUser(token);
    const supabase = createSupabase(token);

    // El nombre se resuelve aquí (igual que antes) y se pasa a la función.
    // La función NO lo acepta del cliente; siempre usa auth.uid() como id.
    const respondentName = user.user_metadata?.full_name || user.email || "Anónimo";

    // ── Llamada RPC atómica (reemplaza las 5 operaciones anteriores) ──────────
    // La función PL/pgSQL (migración 039) ejecuta en una transacción única:
    //   1. UPSERT de sprint_retros (INSERT ON CONFLICT DO UPDATE).
    //   2. DELETE de sprint_retro_peer_signals donde retro_id = v_retro_id.
    //   3. INSERT de cada señal no nula.
    // Si cualquier paso falla → ROLLBACK completo → error propagado aquí → 500.
    // Nunca se devuelve 200 si alguna escritura falló.
    //
    // Los campos peer* se pasan trimmeados: la función también hace TRIM en
    // PL/pgSQL, pero recibir el valor ya limpio evita que un espacio solo
    // cuente como señal no nula desde el lado del cliente.
    const { data, error } = await supabase.rpc("submit_sprint_retro", {
      p_period_id:            Number(periodId),
      p_respondent_name:      respondentName,
      p_emoji:                emoji,
      p_liked:                liked.trim(),
      p_disliked:             disliked.trim(),
      p_peer_strategic:       peerStrategic   ? String(peerStrategic).trim()   : null,
      p_peer_could_give_more: peerCouldGiveMore ? String(peerCouldGiveMore).trim() : null,
      p_peer_had_it_tough:    peerHadItTough  ? String(peerHadItTough).trim()  : null,
    });

    if (error) {
      // Error real de Postgres o de la RLS: la transacción ya fue revertida.
      // No hay estado corrupto. Propagamos el error al cliente con 500.
      return res.status(500).json({ error: error.message });
    }

    // data es el JSONB que devuelve la función: { retro_id, signals_count }
    return res.status(200).json({ ok: true, retro_id: data.retro_id, signals_count: data.signals_count });
  } catch (err) {
    return handleApiError(err, res);
  }
}
