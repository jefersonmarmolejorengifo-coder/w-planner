// Abre el período de retrospectiva para un sprint:
//   1. Crea sprint_retro_periods con closes_at = +7 días.
//   2. Envía correo de invitación a participantes que respondieron tareas
//      del sprint (resolución por email via project_members).
//
// Body: { sprintId, trigger?: 'manual'|'sprint_closed'|'end_date_passed' }
// Llamadores: cron (via X-Cron-Secret) o owner del proyecto.

import {
  applyCors,
  assertProjectAccess,
  createSupabase,
  getAuthenticatedUser,
  getBearerToken,
  getSupabaseServiceKey,
  getSupabaseUrl,
  handleApiError,
} from "./_auth.js";
import { getResendConfig } from "./_email.js";
import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "nodejs", maxDuration: 30 };

function buildEmailHtml({ sprintName, projectName, closesAtLocal, appUrl }) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;">
    <tr><td style="background:linear-gradient(135deg,#542c9c,#f5a623);padding:28px;text-align:center;color:#fff;">
      <div style="font-size:22px;font-weight:700;">Retro del Sprint pendiente</div>
      <div style="font-size:13px;margin-top:6px;">${sprintName} · ${projectName}</div>
    </td></tr>
    <tr><td style="padding:24px;color:#333;font-size:14px;line-height:1.6;">
      <p>Hola,</p>
      <p>El sprint <b>${sprintName}</b> cerró. Tu opinión es importante para entender cómo se está sintiendo el equipo y qué patrones repetir o ajustar el próximo ciclo.</p>
      <p>Tienes hasta <b>${closesAtLocal}</b> para responder. Toma menos de 5 minutos:</p>
      <ul style="padding-left:20px;color:#555;">
        <li>Emoji de cómo te sentiste al cerrar el sprint</li>
        <li>Un párrafo de lo que te gustó</li>
        <li>Un párrafo de lo que no te gustó</li>
        <li>Tres señalizaciones sobre tus compañeros del sprint</li>
      </ul>
      <p style="text-align:center;margin-top:24px;">
        <a href="${appUrl}" style="background:linear-gradient(135deg,#542c9c,#6e3ebf);color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Responder ahora</a>
      </p>
      <p style="font-size:11px;color:#888;margin-top:24px;">Las señalizaciones son anónimas en la vista del PO. Solo se ven los conteos agregados.</p>
    </td></tr>
    <tr><td style="background:#0aa0ab;color:#fff;text-align:center;padding:14px;font-size:11px;">
      Productivity-Plus
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const getAppBaseUrl = () =>
  process.env.APP_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://w-planner.vercel.app");

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { sprintId, trigger = "manual" } = req.body || {};
    if (!sprintId) return res.status(400).json({ error: "sprintId requerido" });

    // Autenticación: owner del proyecto via Bearer, O cron via X-Cron-Secret.
    const cronSecret = process.env.CRON_SECRET;
    const isInternal = cronSecret && req.headers["x-cron-secret"] === cronSecret;

    const adminUrl = getSupabaseUrl();
    const adminKey = getSupabaseServiceKey();
    const admin = createClient(adminUrl, adminKey, { auth: { persistSession: false } });

    // Obtiene sprint y proyecto.
    const { data: sprint } = await admin.from("sprints").select("*").eq("id", sprintId).single();
    if (!sprint) return res.status(404).json({ error: "Sprint no encontrado" });

    if (!isInternal) {
      const token = getBearerToken(req);
      const user = await getAuthenticatedUser(token);
      const supabase = createSupabase(token);
      await assertProjectAccess(supabase, user, sprint.project_id, { ownerOnly: true });
    }

    // Crea período (UNIQUE en sprint_id, así que upsert por idempotencia).
    const closesAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: period, error: periodErr } = await admin
      .from("sprint_retro_periods")
      .upsert(
        { sprint_id: sprintId, project_id: sprint.project_id, trigger, closes_at: closesAt, status: "open" },
        { onConflict: "sprint_id" }
      )
      .select("*")
      .single();
    if (periodErr) return res.status(500).json({ error: periodErr.message });

    // Si ya se enviaron notificaciones para este período, no re-envía.
    if (period.notifications_sent && trigger !== "manual") {
      return res.status(200).json({ ok: true, period_id: period.id, info: "notifications already sent" });
    }

    // Identifica participantes: personas que tocaron tareas en el sprint.
    const { data: tasks } = await admin
      .from("tasks")
      .select("responsible")
      .eq("sprint_id", sprintId);
    const participantNames = new Set((tasks || []).map(t => t.responsible).filter(Boolean));

    // Resuelve emails via project_members (por nombre o por email manual).
    const { data: members } = await admin
      .from("project_members")
      .select("email, name, user_id")
      .eq("project_id", sprint.project_id);

    const emails = [];
    (members || []).forEach(m => {
      if (m.email && participantNames.has(m.name)) emails.push(m.email);
    });

    let emailsSent = 0;
    if (emails.length > 0) {
      try {
        const { apiKey, from } = getResendConfig();
        const appUrl = getAppBaseUrl();
        const closesAtLocal = new Date(closesAt).toLocaleDateString("es-CO", {
          day: "numeric", month: "long", year: "numeric",
        });
        const html = buildEmailHtml({
          sprintName: sprint.name,
          projectName: `Proyecto #${sprint.project_id}`,
          closesAtLocal, appUrl,
        });

        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            from,
            to: emails,
            subject: `Retro pendiente · ${sprint.name}`,
            html,
          }),
        });
        if (resp.ok) emailsSent = emails.length;
        else console.warn("[open-retro] Resend error:", await resp.text());
      } catch (e) {
        console.warn("[open-retro] No pude enviar correos:", e?.message);
      }
    }

    // Marca notifications_sent
    await admin.from("sprint_retro_periods")
      .update({ notifications_sent: true })
      .eq("id", period.id);

    return res.status(200).json({
      ok: true,
      period_id: period.id,
      closes_at: closesAt,
      participants_count: participantNames.size,
      emails_sent: emailsSent,
    });
  } catch (err) {
    return handleApiError(err, res);
  }
}
