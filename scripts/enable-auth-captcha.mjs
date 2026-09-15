#!/usr/bin/env node
// scripts/enable-auth-captcha.mjs
//
// Activa o revierte Cloudflare Turnstile en Supabase Auth (hallazgos H-054 y
// H-062). La pantalla de acceso ya manda el token cuando existe
// VITE_TURNSTILE_SITE_KEY; este script es el paso de servidor.
//
// Uso (SUPABASE_PROJECT_REF explícito, igual que --apply de las plantillas):
//   SUPABASE_PROJECT_REF=pkccbrzsvcipkmnllxhz node scripts/enable-auth-captcha.mjs --enable
//   SUPABASE_PROJECT_REF=pkccbrzsvcipkmnllxhz node scripts/enable-auth-captcha.mjs --disable
//
// --enable  → CAPTCHA on (provider turnstile, secret TURNSTILE_SECRET_KEY de
//             .env.local) + rate_limit_email_sent 30 → 100 (subir el tope sin
//             CAPTCHA solo le daría más margen a un abuso).
// --disable → reversión: CAPTCHA off + tope de vuelta a 30.
//
// ORDEN OBLIGATORIO: primero la variable VITE_TURNSTILE_SITE_KEY en Vercel +
// redeploy (y comprobar el widget en producción); DESPUÉS --enable. Al revés,
// nadie podría pedir un código.
//
// Tras el PATCH verifica por GET (el secret nunca se imprime) y, al activar,
// prueba que un envío SIN token es RECHAZADO: si no lo fuera, el CAPTCHA no
// estaría protegiendo nada.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const enable = process.argv.includes('--enable');
const disable = process.argv.includes('--disable');

if (enable === disable) { console.error('uso: --enable | --disable'); process.exit(2); }
if (!REF) { console.error('Falta SUPABASE_PROJECT_REF explícito (producción: pkccbrzsvcipkmnllxhz).'); process.exit(1); }
if (!token) { console.error('Falta SUPABASE_ACCESS_TOKEN en el entorno.'); process.exit(1); }

const envTxt = readFileSync(resolve(REPO, '.env.local'), 'utf8');
const readVar = (name) => {
  const m = envTxt.match(new RegExp('^' + name + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

let patch;
if (enable) {
  const secret = readVar('TURNSTILE_SECRET_KEY');
  if (!secret) { console.error('Falta TURNSTILE_SECRET_KEY en .env.local (secret del widget de Turnstile).'); process.exit(1); }
  patch = { security_captcha_enabled: true, security_captcha_provider: 'turnstile', security_captcha_secret: secret, rate_limit_email_sent: 100 };
} else {
  patch = { security_captcha_enabled: false, rate_limit_email_sent: 30 };
}

const url = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const p = await fetch(url, { method: 'PATCH', headers: H, body: JSON.stringify(patch), signal: AbortSignal.timeout(20000) });
if (!p.ok) { console.error(`PATCH config/auth → HTTP ${p.status}: ${(await p.text()).slice(0, 300)}`); process.exit(1); }

const cfg = await (await fetch(url, { headers: H, signal: AbortSignal.timeout(20000) })).json();
console.log('security_captcha_enabled =', cfg.security_captcha_enabled);
console.log('security_captcha_provider =', cfg.security_captcha_provider);
console.log('security_captcha_secret =', cfg.security_captcha_secret ? '(definido, oculto)' : '(vacío)');
console.log('rate_limit_email_sent =', cfg.rate_limit_email_sent);

let fails = 0;
for (const [k, v] of Object.entries(patch)) {
  if (k === 'security_captcha_secret') continue; // basta con que quede definido
  if (cfg[k] !== v) { console.error(`FALLA: ${k} quedó ${JSON.stringify(cfg[k])}, se esperaba ${JSON.stringify(v)}`); fails++; }
}

if (enable) {
  const require = createRequire(resolve(REPO, 'package.json'));
  const { createClient } = require('@supabase/supabase-js');
  const anon = createClient(readVar('VITE_SUPABASE_URL'), readVar('VITE_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  // Correo inexistente + shouldCreateUser:false: sin CAPTCHA la respuesta sería
  // "Signups not allowed for otp"; con CAPTCHA activo debe fallar ANTES, por él.
  const { error } = await anon.auth.signInWithOtp({ email: 'sonda-captcha@example.invalid', options: { shouldCreateUser: false } });
  const blocked = !!error && /captcha/i.test(`${error.code} ${error.message}`);
  console.log(`envío sin token de CAPTCHA → ${error ? `status=${error.status} code=${error.code}` : 'SIN ERROR'} → ${blocked ? 'RECHAZADO por captcha (PASA)' : 'NO rechazado por captcha (FALLA)'}`);
  if (!blocked) fails++;
}

console.log(fails ? `RESULTADO: ${fails} FALLA(S)` : 'RESULTADO: TODO PASA');
process.exit(fails ? 1 : 0);
