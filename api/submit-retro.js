// Recibe la retrospectiva de un miembro al cierre de un sprint.
// Body: {
//   periodId, emoji, liked, disliked,
//   peerStrategic: "Nombre"|null,
//   peerCouldGiveMore: "Nombre"|null,
//   peerHadItTough: "Nombre"|null
// }

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

    if (!periodId) return res.status(400).json({ error: "periodId requerido" });
    if (!ALLOWED_EMOJIS.includes(emoji)) return res.status(400).json({ error: "emoji invalido" });
    if (!liked || liked.trim().length === 0) return res.status(400).json({ error: "liked vacio" });
    if (!disliked || disliked.trim().length === 0) return res.status(400).json({ error: "disliked vacio" });
    if (liked.length > 2000 || disliked.length > 2000) return res.status(400).json({ error: "texto demasiado largo" });

    const token = getBearerToken(req);
    const user = await getAuthenticatedUser(token);
    const supabase = createSupabase(token);

    const respondentName = user.user_metadata?.full_name || user.email || "Anónimo";

    // Upsert: si ya respondió, actualiza.
    const { data: existing, error: exErr } = await supabase
      .from("sprint_retros")
      .select("id")
      .eq("period_id", periodId)
      .eq("respondent_user_id", user.id)
      .maybeSingle();
    if (exErr) return res.status(500).json({ error: exErr.message });

    let retroId;
    if (existing) {
      const { error: upErr } = await supabase
        .from("sprint_retros")
        .update({ emoji, liked: liked.trim(), disliked: disliked.trim() })
        .eq("id", existing.id);
      if (upErr) return res.status(500).json({ error: upErr.message });
      retroId = existing.id;

      // Limpiar señales anteriores para reescribirlas
      await supabase.from("sprint_retro_peer_signals").delete().eq("retro_id", retroId);
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("sprint_retros")
        .insert({
          period_id: periodId,
          respondent_user_id: user.id,
          respondent_name: respondentName,
          emoji,
          liked: liked.trim(),
          disliked: disliked.trim(),
        })
        .select("id")
        .single();
      if (insErr) return res.status(500).json({ error: insErr.message });
      retroId = inserted.id;
    }

    // Insertar señalizaciones (si vienen)
    const signals = [];
    if (peerStrategic) signals.push({ retro_id: retroId, signal_type: "strategic_contributor", signaled_name: String(peerStrategic).trim() });
    if (peerCouldGiveMore) signals.push({ retro_id: retroId, signal_type: "could_give_more", signaled_name: String(peerCouldGiveMore).trim() });
    if (peerHadItTough) signals.push({ retro_id: retroId, signal_type: "had_it_tough", signaled_name: String(peerHadItTough).trim() });
    if (signals.length > 0) {
      const { error: sigErr } = await supabase.from("sprint_retro_peer_signals").insert(signals);
      if (sigErr) console.warn("[submit-retro] No pude guardar señales:", sigErr.message);
    }

    return res.status(200).json({ ok: true, retro_id: retroId, signals_count: signals.length });
  } catch (err) {
    return handleApiError(err, res);
  }
}
