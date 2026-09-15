// scripts/auth-email/templates.js
//
// Fuente única de verdad de las plantillas de correo de Supabase Auth para
// Productivity-Plus: un layout de tabla compartido (email-safe) + el
// contenido propio de cada plantilla. Lo consumen:
//   - scripts/apply-auth-email-templates.mjs, el CLI que publica esto en
//     Supabase vía la Management API.
//   - scripts/auth-email/templates.test.js, las guardas de regresión.
//
// Por qué código y no enlace en 5 de las 6 plantillas: ver src/lib/otp.js.
// Los filtros de correo corporativos (Microsoft 365 Safe Links y similares)
// abren cualquier enlace del correo ANTES que la persona destinataria y
// gastan el token de un solo uso; un código de 8 dígitos no se puede "abrir"
// por un escáner. email_change es la única excepción: Supabase no emite un
// código de verificación para ese flujo (usa {{ .ConfirmationURL }}) y la
// app no tiene pantalla propia de cambio de correo, así que ahí el enlace
// es obligatorio.
//
// IMPORTANTE — cero comentarios HTML: Supabase Auth procesa cada plantilla
// con html/template de Go (internal/mailer/templatemailer/template.go),
// que ELIMINA todo `<!-- ... -->` al parsear, incluidos los condicionales
// `<!--[if mso]>` que un correo "normal" usaría para fijar el ancho en
// Outlook de escritorio. Aquí NO se usan: el ancho se maqueta con la técnica
// "híbrida" (sin comentarios): atributo HTML `width="100%"` + CSS
// `max-width:560px`, NUNCA `width:560px` fijo en el estilo. Probado y
// descartado: `width="560"` (atributo) + `style="width:560px;max-width:100%"`
// se ve bien en escritorio pero revienta en móvil — Chrome usa los 560px
// como ancho "preferido" al calcular el layout de la tabla exterior (la
// celda que lo contiene no tiene ancho propio) e IGNORA max-width en ese
// cálculo, así que el documento entero se desborda (592px de scroll en un
// viewport de 375px, medido con capturas). Con `width="100%"` en el
// atributo no hay ancho fijo que "empuje": el único límite es max-width, y
// ahí sí se respeta. El costo es que Outlook de escritorio (que ignora
// max-width) renderiza a 100% del panel de lectura en vez de fijo a 560px:
// no se rompe, solo queda un poco más ancho — compromiso aceptado a cambio
// de no depender de comentarios que Supabase borra. Ver templates.test.js:
// ninguna plantilla puede volver a llevar `<!--`, porque sería HTML muerto.
//
// Variables que Supabase Auth pasa a cada plantilla (Go template, sintaxis
// `{{ .Nombre }}`), verificado en el código fuente de supabase/auth:
//   confirmation, invite, magic_link, recovery
//     → SiteURL, ConfirmationURL, Email, Token, TokenHash, Data, RedirectTo
//   reauthentication
//     → SiteURL, Email, Token, Data   (SIN variables de enlace)
//   email_change
//     → SiteURL, ConfirmationURL, Email, NewEmail, Token, TokenHash, Data,
//       RedirectTo
// Cada plantilla de abajo usa solo un subconjunto de su lista permitida;
// templates.test.js lo verifica clave por clave.

import { createHash } from 'node:crypto';
import { OTP_LENGTH, OTP_TTL_MINUTES } from '../../src/lib/otp.js';
import { COLOR, FONT_STACK, MONO_STACK, SITE_URL, heading, paragraph, ctaButton, layout } from '../../api/_email-brand.js';

// Reexportada tal cual: la consumen apply-auth-email-templates.mjs y
// templates.test.js. Colores, stacks de fuente y layout ahora viven en
// api/_email-brand.js (compartidos con los correos que envía la propia app
// por Resend — ver api/invite.js y api/open-retro.js); esta plantilla ya no
// define su propia identidad visual, la importa.
export { SITE_URL };

// URL de la app (pantalla de acceso). Constante propia de Productivity-Plus,
// no el `{{ .SiteURL }}` de Supabase (que depende de una config externa que
// no controlamos desde aquí): así el botón de "invite" siempre apunta a
// donde queremos, sin depender de esa config.
export const APP_URL = 'https://productivityplus.softatumedida.com/app';

// Única línea del pie que varía por plantilla de Auth (las 6 comparten el
// mismo texto): quién solicitó el correo. El resto del pie (marca + enlace
// al sitio) lo pone api/_email-brand.js.
const AUTH_FOOTER_NOTE = 'Recibes este correo porque se solicitó acceso con {{ .Email }}.';

// ─── Piezas reutilizables del contenido (dentro de la tarjeta blanca) ──────

// Caja del código de acceso. El token siempre llega como {{ .Token }}: es
// literal a propósito (Supabase lo sustituye al enviar), nunca se parte con
// funciones de plantilla para que la persona pueda copiarlo de un tirón.
// padding-left compensa el letter-spacing: sin él, el espacio que el
// letter-spacing deja DESPUÉS del último dígito descentra el bloque.
function codeBox() {
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
        <tr>
          <td align="center" style="background-color:${COLOR.codeBg};border:1px solid ${COLOR.codeBorder};border-radius:12px;padding:26px 20px;">
            <div style="font-family:${MONO_STACK};font-size:34px;font-weight:800;letter-spacing:8px;padding-left:8px;color:${COLOR.ink};line-height:1;">{{ .Token }}</div>
            <div style="margin-top:14px;font-family:${FONT_STACK};font-size:12px;font-weight:600;color:${COLOR.inkSoft};letter-spacing:0.02em;">
              Vence en ${OTP_TTL_MINUTES} minutos · Solo sirve una vez
            </div>
          </td>
        </tr>
      </table>`;
}

// Aviso de seguridad para las 5 plantillas que llevan código.
function securityNote() {
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 0;">
        <tr>
          <td style="background-color:${COLOR.noteBg};border:1px solid ${COLOR.noteBorder};border-radius:10px;padding:16px 18px;">
            <p style="margin:0;font-family:${FONT_STACK};font-size:12.5px;line-height:1.6;color:${COLOR.inkSoft};">
              <strong style="color:${COLOR.violet};">¿No pediste este código?</strong> Ignora este correo: nadie puede entrar a tu cuenta sin él. Nunca te lo pediremos por teléfono, chat ni WhatsApp.
            </p>
          </td>
        </tr>
      </table>`;
}

// ctaButton, heading y paragraph ahora viven en api/_email-brand.js
// (compartidos con api/invite.js y api/open-retro.js) — importados arriba.

// ─── Contenido propio de cada plantilla ────────────────────────────────────

function magicLinkContent() {
  return `
      ${heading('Tu código de acceso')}
      ${paragraph('Escribe este código en la pantalla de acceso de Productivity-Plus para entrar con <strong style="color:' + COLOR.ink + ';">{{ .Email }}</strong>.')}
      ${codeBox()}
      ${securityNote()}`;
}

function confirmationContent() {
  return `
      ${heading('Bienvenido a Productivity-Plus')}
      ${paragraph('Ya casi entras. Escribe este código en la pantalla de acceso para confirmar tu cuenta y empezar a usar Productivity-Plus con <strong style="color:' + COLOR.ink + ';">{{ .Email }}</strong>.')}
      ${codeBox()}
      ${securityNote()}`;
}

function recoveryContent() {
  return `
      ${heading('Tu código de acceso')}
      ${paragraph('En Productivity-Plus no usas contraseña: entra con este código para <strong style="color:' + COLOR.ink + ';">{{ .Email }}</strong>.')}
      ${codeBox()}
      ${securityNote()}`;
}

// Orden pensado para que se lea de corrido antes de actuar: qué es esto →
// con qué correo entrar → el código → el botón que lleva a escribirlo.
function inviteContent() {
  return `
      ${heading('Te invitaron a Productivity-Plus')}
      ${paragraph('Alguien de tu equipo te invitó a colaborar en Productivity-Plus, la gestión estratégica para equipos.')}
      ${paragraph('Entra con tu correo <strong style="color:' + COLOR.ink + ';">{{ .Email }}</strong> y escribe este código:')}
      ${codeBox()}
      ${ctaButton(APP_URL, 'Ir a Productivity-Plus')}
      ${securityNote()}`;
}

function reauthenticationContent() {
  return `
      ${heading('Confirma que eres tú')}
      ${paragraph('Para continuar en Productivity-Plus con <strong style="color:' + COLOR.ink + ';">{{ .Email }}</strong>, escribe este código.')}
      ${codeBox()}
      ${securityNote()}`;
}

// word-break:break-all va SOLO en el <a> del enlace de respaldo, no en el
// <p> que lo envuelve: puesto en el párrafo completo, parte palabras
// normales del texto (ej. "enlace" se veía cortado a mitad de palabra).
function emailChangeContent() {
  return `
      ${heading('Confirma tu nuevo correo')}
      ${paragraph('Vas a cambiar el correo de tu cuenta de Productivity-Plus de <strong style="color:' + COLOR.ink + ';">{{ .Email }}</strong> a <strong style="color:' + COLOR.ink + ';">{{ .NewEmail }}</strong>. Confirma para completar el cambio.')}
      ${ctaButton('{{ .ConfirmationURL }}', 'Confirmar nuevo correo')}
      <p style="margin:22px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.6;color:${COLOR.inkSoft};">
        Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
        <a href="{{ .ConfirmationURL }}" style="color:${COLOR.linkTeal};word-break:break-all;">{{ .ConfirmationURL }}</a>
      </p>`;
}

// footerBlock, headerBlock, tricolorRow y layout ahora viven en
// api/_email-brand.js. El footer de las 6 plantillas comparte la misma
// última línea (AUTH_FOOTER_NOTE, definida arriba), pasada como `footerNote`
// en cada llamada a layout() de abajo.

// ─── Ensamblaje: una entrada por clave de Supabase Auth ────────────────────
// `usesCode` documenta si la plantilla es de las 5 que llevan {{ .Token }}
// (true) o la única de enlace, email_change (false); lo usa el CLI de
// --preview solo para el mensaje en consola, no cambia el HTML.
//
// Asunto con el código al inicio (decisión del dueño, 2026-09-15). Todos los
// correos de acceso llevaban el mismo asunto: Outlook/Microsoft 365 los
// agrupaba en una sola conversación y la persona escribía el código de un
// correo anterior, que ya estaba anulado porque cada pedido nuevo anula los
// anteriores. En los logs del 2026-09-15 se ven verificaciones a los 9-16 s
// del envío, con el token vigente sin usar. Con el código en el asunto, cada
// correo queda separado, el último arriba, y el código se lee sin abrirlo.
// Costo aceptado por el dueño: el código se ve sin abrir el correo, en la
// notificación del teléfono bloqueado y también donde solo se muestra el
// asunto: el panel del proveedor SMTP, el DLP o journaling corporativo, los
// resúmenes de no leídos y el "Re:" de un reenvío (revisión de security,
// 9.6/10). Lo acotan el uso único, los 15 minutos de vigencia y el CAPTCHA
// para pedirlo.
export const AUTH_EMAIL_TEMPLATES = {
  magic_link: {
    subject: '{{ .Token }} es tu código de acceso a Productivity-Plus',
    usesCode: true,
    html: layout({
      title: 'Tu código de acceso a Productivity-Plus',
      preheader: `Tu código de acceso a Productivity-Plus · vence en ${OTP_TTL_MINUTES} minutos`,
      contentHtml: magicLinkContent(),
      footerNote: AUTH_FOOTER_NOTE,
    }),
  },
  confirmation: {
    subject: '{{ .Token }} es tu código para empezar en Productivity-Plus',
    usesCode: true,
    html: layout({
      title: 'Bienvenido a Productivity-Plus',
      preheader: `Bienvenido a Productivity-Plus: tu código de acceso · vence en ${OTP_TTL_MINUTES} minutos`,
      contentHtml: confirmationContent(),
      footerNote: AUTH_FOOTER_NOTE,
    }),
  },
  recovery: {
    subject: '{{ .Token }} es tu código de acceso a Productivity-Plus',
    usesCode: true,
    html: layout({
      title: 'Tu código de acceso a Productivity-Plus',
      preheader: `Tu código de acceso a Productivity-Plus · vence en ${OTP_TTL_MINUTES} minutos`,
      contentHtml: recoveryContent(),
      footerNote: AUTH_FOOTER_NOTE,
    }),
  },
  invite: {
    subject: '{{ .Token }} es tu código: te invitaron a Productivity-Plus',
    usesCode: true,
    html: layout({
      title: 'Te invitaron a Productivity-Plus',
      preheader: 'Te invitaron a Productivity-Plus · entra con tu código de acceso',
      contentHtml: inviteContent(),
      footerNote: AUTH_FOOTER_NOTE,
    }),
  },
  reauthentication: {
    subject: '{{ .Token }} es tu código para confirmar que eres tú en Productivity-Plus',
    usesCode: true,
    html: layout({
      title: 'Confirma que eres tú en Productivity-Plus',
      preheader: `Confirma que eres tú en Productivity-Plus · vence en ${OTP_TTL_MINUTES} minutos`,
      contentHtml: reauthenticationContent(),
      footerNote: AUTH_FOOTER_NOTE,
    }),
  },
  email_change: {
    subject: 'Confirma tu nuevo correo en Productivity-Plus',
    usesCode: false,
    html: layout({
      title: 'Confirma tu nuevo correo en Productivity-Plus',
      preheader: 'Confirma tu nuevo correo para seguir usando Productivity-Plus',
      contentHtml: emailChangeContent(),
      footerNote: AUTH_FOOTER_NOTE,
    }),
  },
};

// ─── Utilidades públicas ────────────────────────────────────────────────

// Arma el objeto exacto que espera el PATCH de
// https://api.supabase.com/v1/projects/{ref}/config/auth: 6 asuntos + 6
// contenidos (12 claves) más los dos números de mailer_otp_*, siempre
// derivados de src/lib/otp.js para que nunca se desincronicen del backend.
export function toAuthConfigPatch() {
  const patch = {};
  for (const [key, tpl] of Object.entries(AUTH_EMAIL_TEMPLATES)) {
    patch[`mailer_subjects_${key}`] = tpl.subject;
    patch[`mailer_templates_${key}_content`] = tpl.html;
  }
  patch.mailer_otp_length = OTP_LENGTH;
  patch.mailer_otp_exp = OTP_TTL_MINUTES * 60;
  return patch;
}

// Huella de integridad del patch completo: sha256 hex de su JSON. No es un
// hash de seguridad (el contenido no es secreto); es un detector barato de
// "el código de las plantillas cambió". La compara published.test.js contra
// scripts/auth-email/published.json (lo que --apply dejó publicado la
// última vez) para que el CI falle en rojo si alguien toca una plantilla y
// no vuelve a correr --apply — el 2026-09-14 (H-056) esto pasó en silencio.
export function patchFingerprint() {
  return createHash('sha256').update(JSON.stringify(toAuthConfigPatch())).digest('hex');
}

// Extrae el texto del div oculto del preheader (identificado por
// `mso-hide:all`, un marcador que solo lleva ese div, no los demás divs del
// documento). Se usa para comprobar que el código NUNCA queda ahí: el
// preheader se lee en la vista previa de la bandeja de entrada y en
// notificaciones de pantalla bloqueada, ambas visibles sin abrir el correo
// ni desbloquear el teléfono. Devuelve null si el HTML no trae ese div (para
// que la prueba falle alto y claro en vez de comparar contra una cadena
// vacía).
// Nota 2026-09-15: el código SÍ va al inicio del ASUNTO por decisión del
// dueño (ver AUTH_EMAIL_TEMPLATES). El preheader se mantiene sin él para no
// repetirlo.
export function extractPreheader(html) {
  const match = html.match(/<div style="[^"]*mso-hide:all[^"]*">([\s\S]*?)<\/div>/);
  return match ? match[1] : null;
}

// Variables de Supabase Auth que, si aparecen en un HTML, representan un
// ENLACE con un token de un solo uso. Se buscan en todo el documento (no
// solo dentro de href="..."): un escáner de correo (Safe Links) sigue
// cualquier URL que encuentre, esté o no dentro de una etiqueta <a>.
const TOKEN_LINK_VARS = ['ConfirmationURL', 'TokenHash', 'RedirectTo'];
const TOKEN_LINK_PATTERN = new RegExp(`\\{\\{\\s*\\.(${TOKEN_LINK_VARS.join('|')})\\s*\\}\\}`, 'g');

// Devuelve la lista de coincidencias (variable + posición) de las tres
// variables de enlace con token. Vacío = el HTML es seguro para un escáner
// automático; cualquier resultado = el correo gasta su propio token antes
// de que la persona lo abra.
export function findTokenLinks(html) {
  const found = [];
  let match;
  TOKEN_LINK_PATTERN.lastIndex = 0;
  while ((match = TOKEN_LINK_PATTERN.exec(html)) !== null) {
    found.push({ variable: match[1], index: match.index });
  }
  return found;
}

// Sustituye `{{ .Nombre }}` por los valores de `vars` (para previsualizar
// en un navegador). Lo que no está en `vars` se deja intacto, para que un
// renderizado parcial no oculte una variable que faltó documentar.
export function renderSample(html, vars = {}) {
  return html.replace(/\{\{\s*\.([A-Za-z0-9_]+)\s*\}\}/g, (full, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : full
  );
}
