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

import { OTP_LENGTH, OTP_TTL_MINUTES } from '../../src/lib/otp.js';

// URL de la app (pantalla de acceso) y del sitio de marketing. Son
// constantes propias de Productivity-Plus, no el `{{ .SiteURL }}` de
// Supabase (que depende de una config externa que no controlamos desde
// aquí): así el botón de "invite" y el pie de página siempre apuntan a
// donde queremos, sin depender de esa config.
export const APP_URL = 'https://productivityplus.softatumedida.com/app';
export const SITE_URL = 'https://productivityplus.softatumedida.com';

// ─── Identidad visual (ver imagen OG de referencia) ────────────────────────
// orange y turquoise son los acentos de marca (logo "P+", franja tricolor):
// decorativos, no llevan texto encima y no están sujetos a AA de texto.
// buttonBg y linkTeal son variantes MÁS OSCURAS para texto/UI, calculadas y
// verificadas con la fórmula de contraste relativo de WCAG 2.x en Node
// (ver notas de ctaButton y footerBlock/emailChangeContent):
//   #ec6c04 (orange) sobre blanco   → 3.13:1  ← falla AA (mínimo 4.5:1)
//   #bf5803 (buttonBg) sobre blanco → 4.55:1  ← pasa
//   #149cac (turquoise) como enlace sobre lavanda → 2.94:1 ← falla
//   #0d6d78 (linkTeal) sobre lavanda               → 5.39:1 ← pasa
const COLOR = {
  navyDeep: '#0d0d1a',
  navy: '#1a1a2e',
  navyMid: '#2d1b4e',
  orange: '#ec6c04',
  turquoise: '#149cac',
  buttonBg: '#bf5803',
  linkTeal: '#0d6d78',
  violet: '#542c9c',
  ink: '#1a1a2e',
  inkSoft: '#4a4560',
  lavender: '#f3f1f8',
  codeBg: '#fff7ef',
  codeBorder: '#f3c896',
  noteBg: '#faf9fd',
  noteBorder: '#ede8f8',
};

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO_STACK = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

// Relleno invisible para que, tras el preheader real, los clientes de correo
// (Gmail, Outlook web) no completen la vista previa con el primer texto
// visible del cuerpo. Es el truco estándar de &zwnj; + &nbsp; repetido.
const PREHEADER_PADDING = '&zwnj;&nbsp;'.repeat(120);

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

// Botón "bulletproof": celda de color sólido + <a> con padding, sin
// background-image ni nada que Outlook ignore de forma visible.
// bgcolor usa buttonBg (#bf5803), no el orange de marca (#ec6c04): texto
// blanco de 15px sobre #ec6c04 da 3.13:1 y falla AA (mínimo 4.5:1 para
// texto que no es "grande"; 15px/700 no llega al umbral de texto grande).
// rel="noopener noreferrer" evita que la pestaña abierta controle esta.
function ctaButton(url, label) {
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 4px;">
        <tr>
          <td align="center" bgcolor="${COLOR.buttonBg}" style="border-radius:10px;">
            <a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 34px;font-family:${FONT_STACK};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
          </td>
        </tr>
      </table>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 14px;font-family:${FONT_STACK};font-size:22px;font-weight:800;color:${COLOR.ink};">${text}</h1>`;
}

function paragraph(html) {
  return `<p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:14.5px;line-height:1.7;color:${COLOR.inkSoft};">${html}</p>`;
}

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

// ─── Pie de página (tabla propia, sobre el fondo lavanda, sin sombra) ──────
// Todos los tamaños de texto de aquí son "pequeños" para WCAG (por debajo
// del umbral de texto grande), así que exigen 4.5:1 sobre el fondo lavanda
// (#f3f1f8). Antes la última línea usaba un gris (#9490a8) que daba 2.75:1
// y fallaba; ahora usa inkSoft (8.11:1). El enlace usa linkTeal, no el
// turquoise decorativo (ese da 2.94:1 sobre lavanda, linkTeal da 5.39:1).
function footerBlock() {
  const siteLabel = SITE_URL.replace(/^https?:\/\//, '');
  return `
      <p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:12px;font-weight:700;color:${COLOR.violet};letter-spacing:0.02em;">Productivity-Plus · Gestión estratégica para equipos</p>
      <p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:11.5px;color:${COLOR.inkSoft};">Un producto de Soft a Tu Medida</p>
      <p style="margin:0 0 14px;font-family:${FONT_STACK};font-size:11.5px;"><a href="${SITE_URL}" style="color:${COLOR.linkTeal};text-decoration:none;">${siteLabel}</a></p>
      <p style="margin:0;font-family:${FONT_STACK};font-size:10.5px;color:${COLOR.inkSoft};line-height:1.5;">Recibes este correo porque se solicitó acceso con {{ .Email }}.</p>`;
}

// Cabecera oscura: logotipo en texto (visible aunque el cliente de correo
// bloquee imágenes, porque no es una imagen). La barra tricolor NO va aquí:
// es su propia fila entre esta cabecera y el cuerpo blanco (ver tricolorRow),
// para no chocar con las esquinas redondeadas de ninguna de las dos.
function headerBlock() {
  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="center" style="padding:34px 32px 28px;">
                <span style="font-family:${FONT_STACK};font-size:34px;font-weight:800;line-height:1;">
                  <span style="color:${COLOR.orange};">P</span><span style="color:${COLOR.turquoise};">+</span>
                </span>
                <div style="margin-top:10px;font-family:${FONT_STACK};font-size:12px;font-weight:700;letter-spacing:4px;color:#ffffff;text-transform:uppercase;">PRODUCTIVITY-PLUS</div>
              </td>
            </tr>
          </table>`;
}

// Franja tricolor como fila propia de la tabla de la tarjeta, entre la
// cabecera oscura (radio arriba) y el cuerpo blanco (radio abajo): al ser
// un rectángulo recto intercalado, no se superpone a ninguna esquina.
function tricolorRow() {
  return `
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="33.34%" height="4" style="background-color:${COLOR.orange};font-size:0;line-height:0;">&nbsp;</td>
                <td width="33.33%" height="4" style="background-color:${COLOR.turquoise};font-size:0;line-height:0;">&nbsp;</td>
                <td width="33.33%" height="4" style="background-color:${COLOR.violet};font-size:0;line-height:0;">&nbsp;</td>
              </tr>
            </table>
          </td>
        </tr>`;
}

// ─── Layout compartido: documento completo, email-safe ────────────────────
//
// Maquetación con tablas (Gmail, Outlook escritorio/web, Apple Mail, móvil),
// sin un solo comentario HTML (ver nota de cabecera del archivo):
// - Ancho con la técnica híbrida en las dos tablas de contenido: atributo
//   `width="100%"` + `style="max-width:560px"` (nunca `width` fijo en el
//   estilo, ver la nota de cabecera del archivo — con ancho fijo el móvil
//   se desborda).
// - Dos tablas separadas dentro del mismo `<td>` centrado: la TARJETA
//   (cabecera + franja + cuerpo, con sombra y esquinas redondeadas) y el
//   PIE (sin sombra, sobre el mismo fondo lavanda de la página, para que se
//   lea como que está fuera de la tarjeta en vez de como una segunda caja).
// - Cero JS, cero <link>, cero fuentes web: todo inline y con stack de
//   fuentes del sistema, para que sobreviva a cualquier sanitizador.
function layout({ title, preheader, contentHtml }) {
  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.lavender};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${COLOR.lavender};">${preheader}${PREHEADER_PADDING}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.lavender};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;box-shadow:0 18px 40px rgba(13,13,26,0.12);">
        <tr>
          <td style="background-color:${COLOR.navy};background-image:linear-gradient(135deg, ${COLOR.navyDeep} 0%, ${COLOR.navy} 45%, ${COLOR.navyMid} 100%);border-radius:16px 16px 0 0;padding:0;">
${headerBlock()}
          </td>
        </tr>
${tricolorRow()}
        <tr>
          <td style="background-color:#ffffff;border-radius:0 0 16px 16px;padding:40px 36px 34px;">
${contentHtml}
          </td>
        </tr>
      </table>
      <div style="height:24px;line-height:24px;font-size:0;">&nbsp;</div>
      <table role="presentation" width="100%" align="center" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;">
        <tr>
          <td align="center" style="padding:0 24px 8px;">
${footerBlock()}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// ─── Ensamblaje: una entrada por clave de Supabase Auth ────────────────────
// `usesCode` documenta si la plantilla es de las 5 que llevan {{ .Token }}
// (true) o la única de enlace, email_change (false); lo usa el CLI de
// --preview solo para el mensaje en consola, no cambia el HTML.
export const AUTH_EMAIL_TEMPLATES = {
  magic_link: {
    subject: 'Tu código de acceso a Productivity-Plus',
    usesCode: true,
    html: layout({
      title: 'Tu código de acceso a Productivity-Plus',
      preheader: `Tu código de acceso a Productivity-Plus · vence en ${OTP_TTL_MINUTES} minutos`,
      contentHtml: magicLinkContent(),
    }),
  },
  confirmation: {
    subject: 'Bienvenido a Productivity-Plus: tu código de acceso',
    usesCode: true,
    html: layout({
      title: 'Bienvenido a Productivity-Plus',
      preheader: `Bienvenido a Productivity-Plus: tu código de acceso · vence en ${OTP_TTL_MINUTES} minutos`,
      contentHtml: confirmationContent(),
    }),
  },
  recovery: {
    subject: 'Tu código de acceso a Productivity-Plus',
    usesCode: true,
    html: layout({
      title: 'Tu código de acceso a Productivity-Plus',
      preheader: `Tu código de acceso a Productivity-Plus · vence en ${OTP_TTL_MINUTES} minutos`,
      contentHtml: recoveryContent(),
    }),
  },
  invite: {
    subject: 'Te invitaron a Productivity-Plus',
    usesCode: true,
    html: layout({
      title: 'Te invitaron a Productivity-Plus',
      preheader: 'Te invitaron a Productivity-Plus · entra con tu código de acceso',
      contentHtml: inviteContent(),
    }),
  },
  reauthentication: {
    subject: 'Confirma que eres tú en Productivity-Plus',
    usesCode: true,
    html: layout({
      title: 'Confirma que eres tú en Productivity-Plus',
      preheader: `Confirma que eres tú en Productivity-Plus · vence en ${OTP_TTL_MINUTES} minutos`,
      contentHtml: reauthenticationContent(),
    }),
  },
  email_change: {
    subject: 'Confirma tu nuevo correo en Productivity-Plus',
    usesCode: false,
    html: layout({
      title: 'Confirma tu nuevo correo en Productivity-Plus',
      preheader: 'Confirma tu nuevo correo para seguir usando Productivity-Plus',
      contentHtml: emailChangeContent(),
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

// Extrae el texto del div oculto del preheader (identificado por
// `mso-hide:all`, un marcador que solo lleva ese div, no los demás divs del
// documento). Se usa para comprobar que el código NUNCA queda ahí: el
// preheader se lee en la vista previa de la bandeja de entrada y en
// notificaciones de pantalla bloqueada, ambas visibles sin abrir el correo
// ni desbloquear el teléfono. Devuelve null si el HTML no trae ese div (para
// que la prueba falle alto y claro en vez de comparar contra una cadena
// vacía).
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
