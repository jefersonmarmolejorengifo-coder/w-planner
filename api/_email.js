const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAILS = 10;
const MAX_HTML_BYTES = 300_000;

const DISALLOWED_TAG_RE = /<\/?\s*(script|iframe|object|embed|form|input|button|meta|link|base|img)\b/i;
const EVENT_HANDLER_RE = /\son[a-z0-9_-]+\s*=/i;
const DANGEROUS_URL_RE = /\b(?:href|src|xlink:href)\s*=\s*(['"]?)\s*(?:javascript|data|vbscript):/i;
const CSS_URL_RE = /url\s*\(/i;

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

export const sanitizeReportHtml = (html) => {
  const value = String(html || "");
  if (Buffer.byteLength(value, "utf8") > MAX_HTML_BYTES) {
    const err = new Error("El reporte supera el tamano permitido");
    err.status = 413;
    throw err;
  }
  if (!value.trim().toLowerCase().startsWith("<!doctype html")) {
    const err = new Error("El HTML del reporte no tiene el formato esperado");
    err.status = 400;
    throw err;
  }
  if (
    DISALLOWED_TAG_RE.test(value) ||
    EVENT_HANDLER_RE.test(value) ||
    DANGEROUS_URL_RE.test(value) ||
    CSS_URL_RE.test(value)
  ) {
    const err = new Error("El HTML del reporte contiene contenido no permitido");
    err.status = 400;
    throw err;
  }
  return value;
};
