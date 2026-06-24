// Persiste el referral_code capturado en localStorage en la tabla user_referrals.
//
// El frontend llama este endpoint UNA SOLA VEZ al iniciar sesión si tiene un
// código en localStorage (key: wplanner_ref_code). La tabla usa user_id como PK
// con ON CONFLICT DO NOTHING (vía ignoreDuplicates), así que si el usuario ya
// tiene un referral registrado, la llamada es idempotente y no sobreescribe
// (lifetime attribution: el primer código que llega gana).
//
// Body: { referral_code: string }
// Auth: Bearer JWT de Supabase (igual que el resto de endpoints de usuario)
//
// Por qué un endpoint separado y no inline en /save-evolution o similar:
//   - El referral puede existir antes de que el usuario haga cualquier acción.
//   - Centralizar aquí evita duplicar la lógica en cada endpoint de usuario.
//   - mp-subscribe también persiste el código si llega en su body, pero este
//     endpoint permite persistirlo antes del pago (ej. durante el onboarding).

import {
  applyCors,
  createAdminClient,
  getBearerToken,
  getAuthenticatedUser,
  handleApiError,
} from "./_auth.js";

export const config = { runtime: "nodejs", maxDuration: 10 };

// Formato que debe cumplir el referral_code.
// Solo se aceptan exactamente 8 caracteres alfanuméricos en mayúsculas, que es
// el único formato emitido por el hub. Se rechaza sin normalización previa:
// si llega en minúsculas o con guiones, es 400 — no toleramos variantes porque
// un regex permisivo permite "immunization attacks" (código tipo "----" queda
// persistido con ON CONFLICT DO NOTHING y bloquea atribuciones legítimas futuras).
const REF_REGEX = /^[A-Z0-9]{8}$/;

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { referral_code } = req.body || {};

    if (!referral_code || typeof referral_code !== "string") {
      return res.status(400).json({ error: "referral_code requerido" });
    }

    // No normalizamos antes de validar: si llega en minúsculas, con guiones o
    // con longitud distinta de 8, es un código inválido y se rechaza con 400.
    // Aplicar .toUpperCase() antes permitiría que "abcd1234" pase cuando no debería.
    const code = referral_code.trim();
    if (!REF_REGEX.test(code)) {
      return res.status(400).json({ error: "referral_code con formato inválido" });
    }

    const token = getBearerToken(req);
    const user = await getAuthenticatedUser(token);

    const admin = createAdminClient();
    if (!admin) {
      return res.status(503).json({ error: "Supabase admin no está configurado" });
    }

    // ON CONFLICT DO NOTHING: si ya existe un referral para este user, se ignora.
    // La tabla user_referrals tiene user_id como PK, así que ignoreDuplicates
    // hace exactamente esto sin error. Lifetime attribution preservada.
    const { error: insertErr } = await admin.from("user_referrals").upsert(
      {
        user_id:      user.id,
        referral_code: code,
        source:        "session",
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );

    if (insertErr) {
      // 42P01 = tabla no existe (migración 034 no aplicada). Logueamos pero no
      // rompemos: el referral se va a persistir igualmente en mp-subscribe.
      if (insertErr.code === "42P01") {
        console.warn("[capture-referral] Tabla user_referrals no existe (migración 034 pendiente).");
        return res.status(200).json({ ok: true, info: "tabla_pendiente" });
      }
      console.error("[capture-referral] Error al insertar referral:", insertErr.message);
      return res.status(500).json({ error: "No se pudo guardar el referral" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return handleApiError(err, res);
  }
}
