// Código de acceso por correo: helpers puros + guarda de regresión.
//
// POR QUÉ ESTE ARCHIVO
// El login pasó de "link mágico" a "código de 8 dígitos" porque los filtros
// de correo corporativos (Microsoft 365 Safe Links) abrían el enlace solos y
// gastaban el token antes de que la persona hiciera clic (ver src/lib/otp.js).
// Estas pruebas fijan dos contratos que si se rompen, revive el bug:
//   1. Los helpers de normalización/validación/mensajes de error.
//   2. Una guarda estática que lee el código fuente de AuthScreen.jsx y
//      exige que verifyOtp use `type: 'email'` y que ya no exista
//      `emailRedirectTo` (rastro del flujo de enlace).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  OTP_LENGTH, OTP_TTL_MINUTES, RESEND_COOLDOWN_SECONDS,
  normalizeEmail, isValidEmail, normalizeOtpInput, authErrorMessage, remainingSeconds,
} from './otp';

describe('constantes del código de acceso', () => {
  it('OTP_LENGTH está en el rango que acepta Supabase (6 a 10 dígitos)', () => {
    expect(OTP_LENGTH).toBeGreaterThanOrEqual(6);
    expect(OTP_LENGTH).toBeLessThanOrEqual(10);
    expect(Number.isInteger(OTP_LENGTH)).toBe(true);
  });

  it('OTP_TTL_MINUTES y RESEND_COOLDOWN_SECONDS son positivos', () => {
    expect(OTP_TTL_MINUTES).toBeGreaterThan(0);
    expect(RESEND_COOLDOWN_SECONDS).toBeGreaterThan(0);
  });
});

describe('normalizeEmail + isValidEmail', () => {
  it('recorta espacios y baja a minúsculas', () => {
    expect(normalizeEmail('  Ana@Correo.COM  ')).toBe('ana@correo.com');
  });

  it('null/undefined no revientan, se tratan como cadena vacía', () => {
    expect(normalizeEmail(null)).toBe('');
    expect(normalizeEmail(undefined)).toBe('');
  });

  it('acepta un correo bien formado (con o sin espacios/mayúsculas)', () => {
    expect(isValidEmail('  Persona@Empresa.com ')).toBe(true);
  });

  it('rechaza correos sin arroba, sin dominio o con espacios internos', () => {
    expect(isValidEmail('sin-arroba.com')).toBe(false);
    expect(isValidEmail('persona@sindominio')).toBe(false);
    expect(isValidEmail('per sona@correo.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('normalizeOtpInput', () => {
  it('deja solo dígitos y descarta espacios y guiones de un pegado', () => {
    expect(normalizeOtpInput('1234 5678')).toBe('12345678'.slice(0, OTP_LENGTH));
    expect(normalizeOtpInput('1234-5678')).toBe('12345678'.slice(0, OTP_LENGTH));
  });

  it('descarta letras y símbolos', () => {
    expect(normalizeOtpInput('12a3b4c5d6')).toBe('123456'.slice(0, OTP_LENGTH));
  });

  it('recorta a OTP_LENGTH aunque venga un pegado más largo', () => {
    const largo = '9'.repeat(OTP_LENGTH + 5);
    const resultado = normalizeOtpInput(largo);
    expect(resultado).toBe('9'.repeat(OTP_LENGTH));
    expect(resultado.length).toBe(OTP_LENGTH);
  });

  it('null/undefined no revientan, se tratan como cadena vacía', () => {
    expect(normalizeOtpInput(null)).toBe('');
    expect(normalizeOtpInput(undefined)).toBe('');
  });
});

describe('remainingSeconds', () => {
  it('tiempo ya pasado da 0, nunca negativo', () => {
    expect(remainingSeconds(1000, 5000)).toBe(0);
  });

  it('en el instante exacto de fin da 0', () => {
    expect(remainingSeconds(5000, 5000)).toBe(0);
  });

  it('redondea fracciones de segundo hacia arriba (falta menos de 1s → cuenta como 1s)', () => {
    expect(remainingSeconds(5900, 5000)).toBe(1); // faltan 0.9s
    expect(remainingSeconds(5001, 5000)).toBe(1); // falta 1ms
    expect(remainingSeconds(7000, 5000)).toBe(2); // faltan exactos 2s
  });

  it('DISTINGUE de un decremento por tick: un salto grande de `now` (pestaña en segundo plano) recalcula de una vez, no resta de a uno', () => {
    // Cooldown de 60s que arrancó en t=0; la pestaña se congela y `now`
    // salta directo a los 45s reales transcurridos. Un contador que solo
    // supiera restar 1 por tick seguiría cerca de 59 (le faltó ponerse al
    // día); remainingSeconds, anclado a endAt, da el valor real: 15.
    const endAt = 60_000;
    expect(remainingSeconds(endAt, 45_000)).toBe(15);
    expect(remainingSeconds(endAt, 45_000)).not.toBe(59);
  });
});

describe('authErrorMessage', () => {
  // Cada caso lleva un mensaje en inglés distinto tal como lo manda auth-js,
  // para poder afirmar que NUNCA se cuela crudo en el texto devuelto.
  const CASOS = [
    { code: 'otp_expired', mensajeIngles: 'Token has expired or is invalid', fase: 'verify' },
    { code: 'over_email_send_rate_limit', mensajeIngles: 'Email rate limit exceeded', fase: 'send' },
    { code: 'over_request_rate_limit', mensajeIngles: 'Request rate limit reached', fase: 'verify' },
    { code: 'email_address_invalid', mensajeIngles: 'Unable to validate email address: invalid format', fase: 'send' },
    { code: 'validation_failed', mensajeIngles: 'Invalid email format', fase: 'send' },
    { code: 'validation_failed', mensajeIngles: 'Token must be six characters', fase: 'verify' },
    { code: 'signup_disabled', mensajeIngles: 'Signups not allowed for this instance', fase: 'send' },
    { code: 'email_address_not_authorized', mensajeIngles: 'Email address not authorized', fase: 'send' },
    { code: 'algun_codigo_nuevo_que_no_conocemos', mensajeIngles: 'Something unexpected happened', fase: 'verify' },
  ];

  for (const { code, mensajeIngles, fase } of CASOS) {
    it(`code=${code} en fase '${fase}' devuelve español y nunca el mensaje inglés original`, () => {
      const error = { name: 'AuthApiError', status: 400, code, message: mensajeIngles };
      const resultado = authErrorMessage(error, fase);
      expect(typeof resultado).toBe('string');
      expect(resultado.length).toBeGreaterThan(0);
      expect(resultado).not.toBe(mensajeIngles);
      expect(resultado).not.toContain(mensajeIngles);
    });
  }

  it("validation_failed en 'verify' menciona la cantidad de dígitos", () => {
    const error = { name: 'AuthApiError', status: 422, code: 'validation_failed', message: 'Token must be six characters' };
    expect(authErrorMessage(error, 'verify')).toContain(String(OTP_LENGTH));
  });

  it('otp_expired cubre tanto código incorrecto como vencido (mismo código en auth-js)', () => {
    const error = { name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' };
    const resultado = authErrorMessage(error, 'verify');
    expect(resultado.toLowerCase()).toMatch(/vál|venc/);
  });

  it('fallo de red (AuthRetryableFetchError, status 0) da un mensaje de conexión', () => {
    const error = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' };
    const resultado = authErrorMessage(error, 'send');
    expect(resultado).not.toContain('Failed to fetch');
    expect(resultado.toLowerCase()).toContain('conectar');
  });

  it('un TypeError crudo de fetch también se trata como fallo de red', () => {
    const error = new TypeError('Failed to fetch');
    const resultado = authErrorMessage(error, 'verify');
    expect(resultado.toLowerCase()).toContain('conectar');
  });

  it('un error sin código reconocido cae en el mensaje genérico, no en error.message', () => {
    const error = { name: 'AuthUnknownError', message: 'some internal detail leaked here' };
    const resultado = authErrorMessage(error, 'send');
    expect(resultado).not.toContain('some internal detail leaked here');
  });

  it('nunca revienta si error es null/undefined', () => {
    expect(() => authErrorMessage(null, 'send')).not.toThrow();
    expect(() => authErrorMessage(undefined, 'verify')).not.toThrow();
  });
});

// ─── Guarda estática: AuthScreen debe usar el código, no el enlace ─────────
// Recorre el TEXTO fuente (no lo ejecuta) y falla si detecta que la pantalla
// volvió al flujo de link mágico. Mismo patrón que src/lib/noSilentWrites.test.js.
function auditarAuthScreen(codigoFuente) {
  const bloqueVerifyOtp = codigoFuente.match(/\.verifyOtp\s*\(([\s\S]{0,400}?)\)\s*;/);
  const llamaVerifyOtp = !!bloqueVerifyOtp;
  const verifyOtpConTypeEmail = llamaVerifyOtp && /type\s*:\s*['"]email['"]/.test(bloqueVerifyOtp[1]);
  const sinEmailRedirectTo = !/emailRedirectTo/.test(codigoFuente);
  return {
    ok: llamaVerifyOtp && verifyOtpConTypeEmail && sinEmailRedirectTo,
    llamaVerifyOtp, verifyOtpConTypeEmail, sinEmailRedirectTo,
  };
}

describe('AuthScreen usa código de acceso, no link mágico', () => {
  it('el AuthScreen actual llama verifyOtp con type: "email" y no usa emailRedirectTo', () => {
    const codigoFuente = readFileSync(new URL('../screens/AuthScreen.jsx', import.meta.url), 'utf8');
    const resultado = auditarAuthScreen(codigoFuente);
    expect(resultado, JSON.stringify(resultado)).toEqual({
      ok: true, llamaVerifyOtp: true, verifyOtpConTypeEmail: true, sinEmailRedirectTo: true,
    });
  });

  // Prueba que la guarda DISTINGUE: contra el AuthScreen anterior (link
  // mágico) debe fallar. Se usa un fixture LITERAL con el fragmento real de
  // esa versión, no `git show HEAD`: leer HEAD se rompe en cuanto este
  // cambio se commitee (HEAD pasaría a tener la versión nueva y `ok` daría
  // true) y, si git no estuviera disponible, la prueba pasaría en silencio
  // sin afirmar nada — un detector que pasa siempre no es un detector.
  const AUTH_SCREEN_ANTERIOR_FRAGMENTO = `
    const { error: err } = await supabase.auth.signInWithOtp({
      email: mail,
      options: {
        emailRedirectTo: window.location.origin + '/app' + window.location.search,
        shouldCreateUser: true,
      },
    });
  `;

  it('la guarda falla contra el AuthScreen anterior (link mágico)', () => {
    const resultado = auditarAuthScreen(AUTH_SCREEN_ANTERIOR_FRAGMENTO);
    expect(resultado.ok).toBe(false);
  });
});
