#!/usr/bin/env node
// scripts/apply-auth-email-templates.mjs
//
// Publica (o solo compara) las plantillas de correo de Supabase Auth vía la
// Management API. El contenido vive en scripts/auth-email/templates.js;
// este script no define copy, solo lo transporta.
//
// Uso:
//   node scripts/apply-auth-email-templates.mjs                # dry-run (solo lectura, no toca nada)
//   node scripts/apply-auth-email-templates.mjs --apply        # publica y verifica clave por clave
//   node scripts/apply-auth-email-templates.mjs --preview=DIR  # escribe HTML de muestra en DIR, sin red
//
// Variables de entorno:
//   SUPABASE_ACCESS_TOKEN  token personal de Supabase (obligatorio salvo --preview). NUNCA se imprime.
//   SUPABASE_PROJECT_REF   ref del proyecto (por defecto pkccbrzsvcipkmnllxhz, Productivity-Plus).
//
// ⚠️ --apply lo corre el PM en el momento exacto del despliegue: el orden de
// publicación importa (config + código de la app deben quedar sincronizados).

import { mkdir, writeFile } from 'node:fs/promises';
import { AUTH_EMAIL_TEMPLATES, toAuthConfigPatch, renderSample, APP_URL } from './auth-email/templates.js';
import { RESEND_COOLDOWN_SECONDS } from '../src/lib/otp.js';

const DEFAULT_PROJECT_REF = 'pkccbrzsvcipkmnllxhz';
const REQUEST_TIMEOUT_MS = 20000;

// Valores de ejemplo para --preview: representan lo que Supabase sustituiría
// en un envío real, para poder ver el correo terminado en un navegador.
const SAMPLE_VARS = {
  Token: '48291037',
  Email: 'ana@empresa.com',
  NewEmail: 'ana.nueva@empresa.com',
  SiteURL: APP_URL,
  ConfirmationURL: 'https://productivityplus.softatumedida.com/app#ejemplo',
};

function parseArgs(argv) {
  const args = { apply: false, preview: null };
  for (const raw of argv) {
    if (raw === '--apply') {
      args.apply = true;
    } else if (raw.startsWith('--preview=')) {
      args.preview = raw.slice('--preview='.length);
    } else if (raw === '--preview') {
      throw new Error('--preview requiere un directorio: --preview=<dir>');
    } else {
      throw new Error(`Argumento no reconocido: ${raw}`);
    }
  }
  return args;
}

function authConfigUrl(ref) {
  return `https://api.supabase.com/v1/projects/${ref}/config/auth`;
}

async function fetchAuthConfig(ref, token) {
  const res = await fetch(authConfigUrl(ref), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET config/auth → HTTP ${res.status}. ${body.slice(0, 300)}`);
  }
  return res.json();
}

// GET del proyecto (no de su config de Auth): confirma a qué proyecto real
// apunta SUPABASE_PROJECT_REF antes de leer o publicar nada. Si el ref está
// mal escrito o apunta a otro proyecto (ej. uno de staging), esto lo dice
// con nombre propio en vez de operar en silencio sobre el proyecto
// equivocado.
async function fetchProjectInfo(ref, token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GET /v1/projects/${ref} → HTTP ${res.status}. ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function patchAuthConfig(ref, token, patch) {
  const res = await fetch(authConfigUrl(ref), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PATCH config/auth → HTTP ${res.status}. ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Describe el cambio de UNA clave sin imprimir el HTML completo de las
// plantillas (solo su longitud): los asuntos y números sí muestran el
// valor viejo → nuevo porque no son secretos y ayudan a revisar el dry-run.
function describeDiff(key, before, after) {
  const isTemplateContent = key.startsWith('mailer_templates_');
  if (isTemplateContent) {
    const beforeLen = typeof before === 'string' ? before.length : 0;
    const afterLen = typeof after === 'string' ? after.length : 0;
    return before === after
      ? `igual (${beforeLen} caracteres)`
      : `CAMBIA (${beforeLen} → ${afterLen} caracteres)`;
  }
  return before === after
    ? `igual (${JSON.stringify(before)})`
    : `CAMBIA (${JSON.stringify(before)} → ${JSON.stringify(after)})`;
}

async function runPreview(dir) {
  await mkdir(dir, { recursive: true });
  console.log(`Escribiendo vista previa en ${dir}\n`);
  for (const [key, tpl] of Object.entries(AUTH_EMAIL_TEMPLATES)) {
    const rendered = renderSample(tpl.html, SAMPLE_VARS);
    const filePath = `${dir}/${key}.html`;
    await writeFile(filePath, rendered, 'utf8');
    const kb = (Buffer.byteLength(rendered, 'utf8') / 1024).toFixed(1);
    console.log(`  · ${key}.html (${kb} KB)${tpl.usesCode ? '' : ' [enlace, sin código]'}`);
  }
  console.log('\nListo. Ninguna llamada de red se hizo para --preview.');
}

async function runDryRun(ref, token) {
  const patch = toAuthConfigPatch();
  console.log(`Dry-run contra el proyecto ${ref} (solo lectura: no se modifica nada)\n`);
  const current = await fetchAuthConfig(ref, token);
  for (const key of Object.keys(patch)) {
    console.log(`  ${key}: ${describeDiff(key, current[key], patch[key])}`);
  }
  if (
    current.smtp_max_frequency !== undefined &&
    current.smtp_max_frequency !== RESEND_COOLDOWN_SECONDS
  ) {
    console.log(
      `\n⚠ smtp_max_frequency actual = ${current.smtp_max_frequency}s, esperado ${RESEND_COOLDOWN_SECONDS}s (RESEND_COOLDOWN_SECONDS en src/lib/otp.js).`
    );
  }
  console.log('\nDry-run completo. Nada se modificó. Usa --apply para publicar.');
}

async function runApply(ref, token) {
  const patch = toAuthConfigPatch();
  console.log(`Publicando en el proyecto ${ref}...`);
  console.log(`Claves a enviar: ${Object.keys(patch).join(', ')}`);
  await patchAuthConfig(ref, token, patch);
  console.log('PATCH enviado. Verificando contra la config publicada...');
  const after = await fetchAuthConfig(ref, token);
  let ok = true;
  for (const [key, expected] of Object.entries(patch)) {
    const matches = after[key] === expected;
    console.log(`  ${key}: ${matches ? 'OK' : 'FALLA'}`);
    if (!matches) ok = false;
  }
  if (!ok) {
    console.error('\nAlgunas claves no coincidieron con lo esperado tras el PATCH.');
    process.exitCode = 1;
    return;
  }
  console.log('\nTodo publicado y verificado.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.preview) {
    await runPreview(args.preview);
    return;
  }

  const ref = process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'Falta SUPABASE_ACCESS_TOKEN en el entorno (obligatorio salvo con --preview). No se pide por ningún otro medio.'
    );
  }

  // Si el ref no existe o no es accesible, fetchProjectInfo lanza y main()
  // aborta ANTES de leer o publicar nada.
  const project = await fetchProjectInfo(ref, token);
  console.log(`Proyecto: ${project.name} (${ref})\n`);

  if (args.apply) {
    await runApply(ref, token);
  } else {
    await runDryRun(ref, token);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
