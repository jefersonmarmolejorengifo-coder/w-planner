import sanitizeHtml from "sanitize-html";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAILS = 10;
const MAX_HTML_BYTES = 300_000;

// Permite el subset que un correo HTML compatible con Gmail/Outlook necesita:
// estructura básica, tablas, estilos inline, divs/spans con style.
const SANITIZE_OPTIONS = {
  allowedTags: [
    "html", "head", "body", "title", "meta",
    "div", "span", "p", "br", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    "strong", "b", "em", "i", "u", "small", "sub", "sup",
    "a", "blockquote", "pre", "code",
    "style",
  ],
  allowedAttributes: {
    "*": ["style", "class", "id", "align", "width", "height", "bgcolor", "valign", "border", "cellpadding", "cellspacing", "colspan", "rowspan"],
    a: ["href", "title", "target", "rel"],
    meta: ["charset", "name", "content", "http-equiv"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { a: ["http", "https", "mailto"] },
  allowProtocolRelative: false,
  // Permite que sanitize-html mantenga atributos style con contenido CSS seguro.
  allowedStyles: {
    "*": {
      // Casi todo lo común para HTML email queda permitido.
      color: [/^[#a-z0-9(),.\s%-]+$/i],
      "background": [/^[#a-z0-9(),.\s%-]+$/i],
      "background-color": [/^[#a-z0-9(),.\s%-]+$/i],
      "background-image": [/^(linear|radial)-gradient\(.+\)$/i],
      "font-family": [/^[\w\s,'"-]+$/],
      "font-size": [/^\d+(\.\d+)?(px|em|rem|%|pt)?$/],
      "font-weight": [/^(bold|normal|lighter|bolder|[1-9]00)$/],
      "font-style": [/^(italic|normal|oblique)$/],
      "text-align": [/^(left|right|center|justify)$/],
      "text-decoration": [/^[\w\s-]+$/],
      "line-height": [/^[\d.]+(px|em|%)?$/],
      "letter-spacing": [/^-?\d+(\.\d+)?(px|em)$/],
      "padding": [/^[\d.\s%pxem-]+$/],
      "padding-top": [/^[\d.\s%pxem-]+$/],
      "padding-right": [/^[\d.\s%pxem-]+$/],
      "padding-bottom": [/^[\d.\s%pxem-]+$/],
      "padding-left": [/^[\d.\s%pxem-]+$/],
      "margin": [/^[\d.\s%pxem-]+$/],
      "margin-top": [/^[\d.\s%pxem-]+$/],
      "margin-right": [/^[\d.\s%pxem-]+$/],
      "margin-bottom": [/^[\d.\s%pxem-]+$/],
      "margin-left": [/^[\d.\s%pxem-]+$/],
      "border": [/^[\w\s#(),.%-]+$/],
      "border-top": [/^[\w\s#(),.%-]+$/],
      "border-right": [/^[\w\s#(),.%-]+$/],
      "border-bottom": [/^[\w\s#(),.%-]+$/],
      "border-left": [/^[\w\s#(),.%-]+$/],
      "border-radius": [/^[\d.\s%pxem-]+$/],
      "border-color": [/^[#a-z0-9(),.\s%-]+$/i],
      "border-style": [/^(solid|dashed|dotted|double|none)$/],
      "border-width": [/^[\d.\s%pxem-]+$/],
      "width": [/^[\d.\s%pxem-]+$/],
      "max-width": [/^[\d.\s%pxem-]+$/],
      "min-width": [/^[\d.\s%pxem-]+$/],
      "height": [/^[\d.\s%pxem-]+$/],
      "max-height": [/^[\d.\s%pxem-]+$/],
      "display": [/^(block|inline|inline-block|none|table|table-row|table-cell)$/],
      "vertical-align": [/^(top|middle|bottom|baseline|sub|super)$/],
      "text-transform": [/^(uppercase|lowercase|capitalize|none)$/],
      "white-space": [/^(normal|nowrap|pre|pre-wrap|pre-line)$/],
      "overflow": [/^(hidden|visible|scroll|auto)$/],
      "opacity": [/^[\d.]+$/],
    },
  },
  // Bloquea url() en CSS (data:/javascript: dentro de url()).
  parser: { lowerCaseAttributeNames: true },
  disallowedTagsMode: "discard",
};

const configError = (message) => {
  const err = new Error(message);
  err.status = 500;
  return err;
};

export const getResendConfig = () => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REPORT_FROM_EMAIL;
  if (!apiKey) throw configError("RESEND_API_KEY no esta configurada");
  if (!from) throw configError("REPORT_FROM_EMAIL no esta configurado");
  return { apiKey, from };
};

export const normalizeRecipients = (emails) => {
  const recipients = Array.isArray(emails)
    ? [...new Set(emails.map((email) => String(email).trim().toLowerCase()))]
    : [];

  if (!recipients.length) {
    const err = new Error("No hay correos configurados");
    err.status = 400;
    throw err;
  }
  if (recipients.length > MAX_EMAILS) {
    const err = new Error(`Maximo ${MAX_EMAILS} destinatarios`);
    err.status = 400;
    throw err;
  }
  if (recipients.some((email) => !EMAIL_RE.test(email))) {
    const err = new Error("Hay correos invalidos");
    err.status = 400;
    throw err;
  }

  return recipients;
};

// Sanitiza el HTML del reporte usando sanitize-html con allowlist explícita.
// Reemplaza el sanitizador regex anterior, frágil ante HTML malformado.
export const sanitizeReportHtml = (html) => {
  const value = String(html || "");

  const byteLength = typeof Buffer !== "undefined"
    ? Buffer.byteLength(value, "utf8")
    : new TextEncoder().encode(value).byteLength;
  if (byteLength > MAX_HTML_BYTES) {
    const err = new Error("El reporte supera el tamano permitido");
    err.status = 413;
    throw err;
  }
  if (!value.trim().toLowerCase().startsWith("<!doctype html")) {
    const err = new Error("El HTML del reporte no tiene el formato esperado");
    err.status = 400;
    throw err;
  }

  // sanitize-html elimina tags/atributos/CSS no permitidos sin romper el resto.
  const sanitized = sanitizeHtml(value, SANITIZE_OPTIONS);

  // Re-validar tamaño post-sanitización (debería bajar, no subir).
  const cleanLength = typeof Buffer !== "undefined"
    ? Buffer.byteLength(sanitized, "utf8")
    : new TextEncoder().encode(sanitized).byteLength;
  if (cleanLength > MAX_HTML_BYTES) {
    const err = new Error("El reporte sanitizado sigue siendo demasiado grande");
    err.status = 413;
    throw err;
  }

  // Preserva el <!doctype> porque sanitize-html lo descarta.
  return `<!DOCTYPE html>\n${sanitized}`;
};

// Sanitiza HTML enriquecido para persistir (p.ej. el evolutivo, H-012) usando la
// misma allowlist que los correos, pero SIN exigir <!doctype>: el evolutivo se
// renderiza en un iframe srcDoc y puede llegar como documento o como fragmento.
// Conserva el doctype solo si venía. Lanza 413 si excede el tamaño máximo.
export const sanitizeRichHtml = (html) => {
  const value = String(html || "");

  const byteLength = typeof Buffer !== "undefined"
    ? Buffer.byteLength(value, "utf8")
    : new TextEncoder().encode(value).byteLength;
  if (byteLength > MAX_HTML_BYTES) {
    const err = new Error("El contenido supera el tamano permitido");
    err.status = 413;
    throw err;
  }

  const sanitized = sanitizeHtml(value, SANITIZE_OPTIONS);
  const hadDoctype = value.trim().toLowerCase().startsWith("<!doctype");
  return hadDoctype ? `<!DOCTYPE html>\n${sanitized}` : sanitized;
};
