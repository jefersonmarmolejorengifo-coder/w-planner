// ─── Código de acceso por correo (OTP) ────────────────────────────────────
// Fuente única de verdad de los parámetros del código con el que se entra a la
// app. Los consumen la pantalla de login (src/screens/AuthScreen.jsx) y el
// script que publica plantillas y configuración en Supabase Auth
// (scripts/apply-auth-email-templates.mjs), para que el correo, la pantalla y
// el servidor nunca digan cosas distintas.
//
// Por qué código y no enlace: los filtros de correo corporativos (Microsoft 365
// Safe Links y similares) abren los enlaces antes que la persona y gastan el
// token de un solo uso; al hacer clic, la persona recibía "Email link is
// invalid or has expired". Un código no se puede "abrir". Diagnóstico con logs
// de producción: 2026-09-14.

// Dígitos del código. Se publica como mailer_otp_length en Supabase Auth.
export const OTP_LENGTH = 8;

// Vigencia del código en minutos. Se publica como mailer_otp_exp (segundos).
export const OTP_TTL_MINUTES = 15;

// Espera mínima entre dos envíos al mismo correo. Debe coincidir con
// smtp_max_frequency de Supabase Auth (hoy 60 s): antes de eso el servidor
// rechaza el reenvío con over_email_send_rate_limit.
export const RESEND_COOLDOWN_SECONDS = 60;

// ─── Helpers puros ─────────────────────────────────────────────────────────
// Sin React ni supabase-js: solo transforman datos, así que se prueban solos
// (src/lib/otp.test.js) y los reutiliza cualquier pantalla que necesite el
// mismo criterio (hoy solo AuthScreen).

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Recorta espacios y baja a minúsculas. Supabase no distingue mayúsculas en
// el correo, pero comparar o registrar el mismo correo escrito distinto
// (" Ana@X.com" vs "ana@x.com") es una fuente clásica de bugs silenciosos.
export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

// Valida el correo ya normalizado con el mismo regex que usaba AuthScreen.
export function isValidEmail(value) {
  return EMAIL_RE.test(normalizeEmail(value));
}

// Deja solo dígitos y recorta a OTP_LENGTH. Es el único lugar que decide el
// tamaño final: el <input> NO usa `maxLength` porque cortaría un pegado con
// espacios o guiones ("1234 5678") antes de limpiarlo.
export function normalizeOtpInput(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, OTP_LENGTH);
}

// Segundos que faltan hasta `endAt` (ambos timestamps en ms epoch), nunca
// negativos. `endAt - now` en vez de un decremento por tick: un decremento
// (`c => c - 1` en cada setInterval) asume que el intervalo corrió cada
// segundo exacto, pero un navegador congela los timers de una pestaña en
// segundo plano (típico: la persona se va a su correo a buscar el código) y
// el contador se atrasa, dejando el botón de reenvío bloqueado más de los
// RESEND_COOLDOWN_SECONDS reales. Anclado a una hora de fin absoluta, un
// solo recálculo (al volver a primer plano o en el siguiente tick) siempre
// da el valor correcto sin importar cuánto se congeló el timer.
export function remainingSeconds(endAt, now) {
  return Math.max(0, Math.ceil((endAt - now) / 1000));
}

// Traduce cualquier error de supabase-js a un mensaje en español, apto para
// mostrar en pantalla. NUNCA devuelve error.message crudo (viene en inglés y
// a veces expone detalle interno de la petición).
//
// phase distingue el paso que falló porque el mismo código de error significa
// cosas distintas según de dónde venga:
//   'send'   → supabase.auth.signInWithOtp (pedir el código)
//   'verify' → supabase.auth.verifyOtp (escribir el código)
export function authErrorMessage(error, phase) {
  const code = error?.code;
  const status = error?.status;
  const name = error?.name;

  // Fallo de red: auth-js envuelve cualquier fetch que lance (offline, DNS,
  // CORS) en AuthRetryableFetchError con status 0 (ver
  // node_modules/@supabase/auth-js/dist/module/lib/fetch.js). Si algo se
  // colara sin envolver, un TypeError también es señal de fetch caído.
  if (name === 'AuthRetryableFetchError' || status === 0 || error instanceof TypeError) {
    return 'No pudimos conectar. Revisa tu internet e intenta de nuevo.';
  }

  switch (code) {
    case 'otp_expired':
      // Supabase usa el mismo código para "código incorrecto" y "código
      // vencido": no hay forma de distinguirlos desde el cliente.
      return 'El código no es válido o ya venció. Revisa que sea el del correo más reciente o pide uno nuevo.';
    case 'over_email_send_rate_limit':
      return 'Ya te enviamos un código hace muy poco. Espera un minuto antes de pedir otro.';
    case 'over_request_rate_limit':
      return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo.';
    case 'email_address_invalid':
      return 'Revisa el correo: no parece válido.';
    case 'validation_failed':
      return phase === 'verify'
        ? `El código debe tener ${OTP_LENGTH} dígitos.`
        : 'Revisa el correo: no parece válido.';
    case 'signup_disabled':
    case 'email_address_not_authorized':
    default:
      return 'No pudimos completar el paso. Intenta de nuevo en un momento.';
  }
}
