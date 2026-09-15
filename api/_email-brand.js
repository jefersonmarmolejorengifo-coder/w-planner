// api/_email-brand.js
//
// Piezas de marca compartidas por TODO correo HTML de Productivity-Plus:
// tanto las plantillas de Supabase Auth (scripts/auth-email/templates.js,
// consumidor original de estos colores y de este layout) como los correos
// que la propia app dispara vía Resend (api/invite.js, api/open-retro.js).
// Antes cada uno tenía su propia cabecera (degradado naranja→turquesa vs.
// la azul noche→morado real de la marca): dos identidades visuales el mismo
// día se leen como phishing, no como dos correos legítimos del mismo
// producto.
//
// Funciones puras que devuelven strings HTML. Ninguna conoce la sintaxis de
// plantilla Go de Supabase (`{{ .Nombre }}`): quien la necesita (hoy solo
// scripts/auth-email/templates.js) se la pasa como un string opaco más
// (p. ej. en `footerNote`), igual que cualquier otro valor.
//
// Convención del repo: los módulos de api/ que empiezan por `_` no son rutas
// (Vercel no los expone como endpoint), son utilidades compartidas — ver
// api/_auth.js, api/_email.js, api/_http.js.

export const SITE_URL = 'https://productivityplus.softatumedida.com';

// ─── Identidad visual ───────────────────────────────────────────────────
// orange y turquoise son los acentos de marca (logo "P+", franja tricolor):
// decorativos, no llevan texto encima y no están sujetos a AA de texto.
// buttonBg y linkTeal son variantes MÁS OSCURAS para texto/UI, verificadas
// con la fórmula de contraste relativo de WCAG 2.x:
//   #ec6c04 (orange) sobre blanco   → 3.13:1  ← falla AA (mínimo 4.5:1)
//   #bf5803 (buttonBg) sobre blanco → 4.55:1  ← pasa
//   #149cac (turquoise) como enlace sobre lavanda → 2.94:1 ← falla
//   #0d6d78 (linkTeal) sobre lavanda               → 5.39:1 ← pasa
export const COLOR = {
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

export const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
export const MONO_STACK = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

// Relleno invisible para que, tras el preheader real, los clientes de correo
// (Gmail, Outlook web) no completen la vista previa con el primer texto
// visible del cuerpo. Es el truco estándar de &zwnj; + &nbsp; repetido.
const PREHEADER_PADDING = '&zwnj;&nbsp;'.repeat(120);

// Escapa un valor para insertarlo con seguridad en texto o atributo HTML.
// Todo dato que no sea un literal propio del módulo (nombre de proyecto,
// de sprint, código, URL con datos externos) debe pasar por aquí antes de
// interpolarse en cualquiera de las piezas de abajo.
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function heading(text) {
  return `<h1 style="margin:0 0 14px;font-family:${FONT_STACK};font-size:22px;font-weight:800;color:${COLOR.ink};">${text}</h1>`;
}

export function paragraph(html) {
  return `<p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:14.5px;line-height:1.7;color:${COLOR.inkSoft};">${html}</p>`;
}

// Botón "bulletproof": celda de color sólido + <a> con padding, sin
// background-image ni nada que Outlook ignore de forma visible.
// bgcolor usa buttonBg (#bf5803), no el orange de marca (#ec6c04): texto
// blanco de 15px sobre #ec6c04 da 3.13:1 y falla AA (mínimo 4.5:1 para
// texto que no es "grande"; 15px/700 no llega al umbral de texto grande).
// rel="noopener noreferrer" evita que la pestaña abierta controle esta.
export function ctaButton(url, label) {
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 4px;">
        <tr>
          <td align="center" bgcolor="${COLOR.buttonBg}" style="border-radius:10px;">
            <a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:15px 34px;font-family:${FONT_STACK};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${label}</a>
          </td>
        </tr>
      </table>`;
}

// Caja de información secundaria dentro del cuerpo (borde suave, fondo
// tenue): un dato de respaldo que la persona puede copiar o leer aparte del
// flujo principal (un código, un aviso). `value` ya debe llegar escapado
// por quien llama si viene de un dato externo.
export function infoBox({ label, value, mono = false }) {
  const labelHtml = label
    ? `<p style="margin:0 0 8px;font-family:${FONT_STACK};font-size:11px;font-weight:700;color:${COLOR.violet};text-transform:uppercase;letter-spacing:0.06em;">${label}</p>`
    : '';
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;">
        <tr>
          <td style="background-color:${COLOR.noteBg};border:1px solid ${COLOR.noteBorder};border-radius:10px;padding:16px 18px;">
            ${labelHtml}<p style="margin:0;font-family:${mono ? MONO_STACK : FONT_STACK};font-size:16px;font-weight:700;color:${COLOR.ink};letter-spacing:${mono ? '3px' : 'normal'};">${value}</p>
          </td>
        </tr>
      </table>`;
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

// Pie de página (tabla propia, sobre el fondo lavanda, sin sombra). Todos
// los tamaños de texto de aquí son "pequeños" para WCAG (por debajo del
// umbral de texto grande), así que exigen 4.5:1 sobre el fondo lavanda
// (#f3f1f8): el enlace usa linkTeal (5.39:1), no el turquoise decorativo
// (2.94:1, falla). `footerNote` es la única línea que varía entre correos
// (p. ej. "recibiste esto porque..."); si no se pasa, el pie se queda solo
// con la marca y el enlace al sitio.
function footerBlock(footerNote) {
  const siteLabel = SITE_URL.replace(/^https?:\/\//, '');
  const noteHtml = footerNote
    ? `\n      <p style="margin:0;font-family:${FONT_STACK};font-size:10.5px;color:${COLOR.inkSoft};line-height:1.5;">${footerNote}</p>`
    : '';
  return `
      <p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:12px;font-weight:700;color:${COLOR.violet};letter-spacing:0.02em;">Productivity-Plus · Gestión estratégica para equipos</p>
      <p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:11.5px;color:${COLOR.inkSoft};">Un producto de Soft a Tu Medida</p>
      <p style="margin:0 0 14px;font-family:${FONT_STACK};font-size:11.5px;"><a href="${SITE_URL}" style="color:${COLOR.linkTeal};text-decoration:none;">${siteLabel}</a></p>${noteHtml}`;
}

// ─── Layout compartido: documento completo, email-safe ────────────────────
//
// Maquetación con tablas (Gmail, Outlook escritorio/web, Apple Mail, móvil),
// sin un solo comentario HTML: Supabase Auth procesa sus plantillas con
// html/template de Go, que ELIMINA todo `<!-- ... -->` al parsear (ver la
// nota de cabecera de scripts/auth-email/templates.js); para que un mismo
// layout sirva también a esas plantillas, aquí tampoco se usan.
// - Ancho con la técnica híbrida: atributo `width="100%"` + `style="max-
//   width:560px"` (nunca `width` fijo en el estilo — con ancho fijo el
//   móvil se desborda, medido con capturas).
// - Dos tablas separadas dentro del mismo `<td>` centrado: la TARJETA
//   (cabecera + franja + cuerpo, con sombra y esquinas redondeadas) y el
//   PIE (sin sombra, sobre el mismo fondo lavanda de la página).
// - Cero JS, cero <link>, cero fuentes web: todo inline y con stack de
//   fuentes del sistema, para que sobreviva a cualquier sanitizador.
export function layout({ title, preheader, contentHtml, footerNote }) {
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
${footerBlock(footerNote)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
