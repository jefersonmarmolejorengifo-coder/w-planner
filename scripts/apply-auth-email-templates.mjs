#!/usr/bin/env node
// scripts/apply-auth-email-templates.mjs
//
// Publica (o solo compara) las plantillas de correo de Supabase Auth vía la
// Management API. El contenido vive en scripts/auth-email/templates.js;
// este script no define copy, solo lo transporta.
//
// Uso:
//   node scripts/apply-auth-email-templates.mjs                # dry-run (solo lectura, no toca nada)
//   node scripts/apply-auth-email-templates.mjs --check        # solo lectura: compara y sale 1 si algo difiere (pensado para CI/cron)
//   node scripts/apply-auth-email-templates.mjs --apply        # publica y verifica clave por clave
//   node scripts/apply-auth-email-templates.mjs --preview=DIR  # escribe HTML de muestra en DIR, sin red
//
// Variables de entorno:
//   SUPABASE_ACCESS_TOKEN  token personal de Supabase (obligatorio salvo --preview). NUNCA se imprime.
//   SUPABASE_PROJECT_REF   ref del proyecto. Dry-run y --check caen por
//                          defecto en pkccbrzsvcipkmnllxhz (Productivity-Plus)
//                          si no se define. --apply lo EXIGE explícito en el
//                          entorno (sin valor por defecto): publicar sin ref
//                          explícito es exactamente el descuido que casi deja
//                          plantillas sin publicar el 2026-09-14 (H-058).
//
// ⚠️ --apply lo corre el PM en el momento exacto del despliegue: el orden de
// publicación importa (config + código de la app deben quedar sincronizados).
// Tras un --apply verificado, este script deja constancia en
// scripts/auth-email/published.json (huella sha256 + ref + fecha), que
// templates.test.js compara contra el código en cada CI (H-056: que un
// cambio de plantilla sin publicar no vuelva a pasar en silencio).

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AUTH_EMAIL_TEMPLATES, toAuthConfigPatch, renderSample, patchFingerprint, APP_URL } from './auth-email/templates.js';
import { RESEND_COOLDOWN_SECONDS } from '../src/lib/otp.js';

const DEFAULT_PROJECT_REF = 'pkccbrzsvcipkmnllxhz';
const REQUEST_TIMEOUT_MS = 20000;
const PUBLISHED_PATH = fileURLToPath(new URL('./auth-email/published.json', import.meta.url));

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
  const args = { apply: false, check: false, preview: null };
  for (const raw of argv) {
    if (raw === '--apply') {
      args.apply = true;
    } else if (raw === '--check') {
      args.check = true;
    } else if (raw.startsWith('--preview=')) {
      args.preview = raw.slice('--preview='.length);
    } else if (raw === '--preview') {
      throw new Error('--preview requiere un directorio: --preview=<dir>');
    } else {
      throw new Error(`Argumento no reconocido: ${raw}`);
    }
  }
  if (args.apply && args.check) {
    throw new Error('--apply y --check son mutuamente excluyentes.');
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

// Solo lectura: compara las 14 claves contra lo publicado en producción y no
// modifica nada. Pensado para correr en CI o en un cron de guardia: sale con
// código 1 si algo no coincide (para que quien lo invoque falle visible),
// 0 si todo coincide. Por eso puede usar el ref por defecto — a diferencia de
// --apply, aquí un ref equivocado como mucho informa mal, no publica nada.
async function runCheck(ref, token) {
  const patch = toAuthConfigPatch();
  console.log(`--check contra el proyecto ${ref} (solo lectura, no modifica nada)\n`);
  const current = await fetchAuthConfig(ref, token);
  const mismatches = Object.keys(patch).filter((key) => current[key] !== patch[key]);
  if (mismatches.length === 0) {
    console.log('Las 14 claves coinciden con lo publicado en producción. Nada pendiente.');
    return;
  }
  console.log(`${mismatches.length} de 14 clave(s) NO coinciden con lo publicado:`);
  for (const key of mismatches) {
    console.log(`  ${key}: ${describeDiff(key, current[key], patch[key])}`);
  }
  console.error('\n--check encontró diferencias: corre --apply para publicarlas.');
  process.exitCode = 1;
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

  // Deja constancia de qué huella quedó publicada y en qué proyecto. Es lo
  // que templates.test.js compara contra el código en cada CI (H-056): si
  // alguien cambia una plantilla y no vuelve a correr --apply, la huella del
  // código ya no coincide con la de aquí y el test falla en rojo, en vez de
  // quedar en silencio como pasó el 2026-09-14.
  const record = { sha256: patchFingerprint(), ref, publishedAt: new Date().toISOString() };
  await writeFile(PUBLISHED_PATH, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(`Registrado en ${PUBLISHED_PATH}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.preview) {
    await runPreview(args.preview);
    return;
  }

  // --apply exige el ref EXPLÍCITO en el entorno, sin caer al valor por
  // defecto: publicar en el proyecto equivocado por un ref no fijado es
  // justo el descuido de H-058. Dry-run y --check sí pueden apoyarse en el
  // valor por defecto porque no escriben nada.
  const envRef = process.env.SUPABASE_PROJECT_REF;
  if (args.apply && !envRef) {
    throw new Error(
      'Falta SUPABASE_PROJECT_REF en el entorno: --apply lo exige explícito (sin valor por defecto), para no publicar por accidente en el proyecto equivocado. Ej.: SUPABASE_PROJECT_REF=pkccbrzsvcipkmnllxhz node scripts/apply-auth-email-templates.mjs --apply'
    );
  }
  const ref = envRef || DEFAULT_PROJECT_REF;
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
  } else if (args.check) {
    await runCheck(ref, token);
  } else {
    await runDryRun(ref, token);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
});
