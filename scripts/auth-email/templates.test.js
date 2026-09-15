// scripts/auth-email/templates.test.js
//
// Guardas de regresión de las plantillas de correo de Supabase Auth.
// El caso que más importa: NINGUNA plantilla de código puede llevar un
// enlace con token (lo abre un escáner corporativo antes que la persona y
// lo gasta). La prueba de findTokenLinks se ancla a la plantilla de fábrica
// real que causó el problema en producción, no a un ejemplo inventado.

import { describe, it, expect } from 'vitest';
import {
  AUTH_EMAIL_TEMPLATES,
  toAuthConfigPatch,
  findTokenLinks,
  extractPreheader,
  renderSample,
  APP_URL,
  SITE_URL,
} from './templates.js';
import { OTP_LENGTH, OTP_TTL_MINUTES } from '../../src/lib/otp.js';

const CODE_KEYS = ['magic_link', 'confirmation', 'recovery', 'invite', 'reauthentication'];
const ALL_KEYS = Object.keys(AUTH_EMAIL_TEMPLATES);

// Variables permitidas por clave (Go template `{{ .Nombre }}`), tomadas del
// código fuente de supabase/auth (internal/mailer/templatemailer). Ver el
// comentario de cabecera de templates.js para la fuente exacta.
const ALLOWED_VARS = {
  confirmation: ['SiteURL', 'ConfirmationURL', 'Email', 'Token', 'TokenHash', 'Data', 'RedirectTo'],
  invite: ['SiteURL', 'ConfirmationURL', 'Email', 'Token', 'TokenHash', 'Data', 'RedirectTo'],
  magic_link: ['SiteURL', 'ConfirmationURL', 'Email', 'Token', 'TokenHash', 'Data', 'RedirectTo'],
  recovery: ['SiteURL', 'ConfirmationURL', 'Email', 'Token', 'TokenHash', 'Data', 'RedirectTo'],
  reauthentication: ['SiteURL', 'Email', 'Token', 'Data'],
  email_change: ['SiteURL', 'ConfirmationURL', 'Email', 'NewEmail', 'Token', 'TokenHash', 'Data', 'RedirectTo'],
};

const FORBIDDEN_WORDS = ['Supabase', 'Microsoft', 'Claude', 'Anthropic', 'OpenAI', 'GPT', 'Gemini'];
const FORBIDDEN_ENGLISH = ['Log In', 'Magic Link', 'Confirm your', 'Follow this link'];

// La plantilla de fábrica real que Supabase publica por defecto para
// magic_link (en inglés, con enlace). Es justo lo que reemplazamos y lo que
// findTokenLinks debe seguir detectando si algún día se vuelve a colar.
const OLD_PRODUCTION_TEMPLATE =
  '<h2>Magic Link</h2><p>Follow this link to login:</p><p><a href="{{ .ConfirmationURL }}">Log In</a></p>';

describe('findTokenLinks', () => {
  it('detecta la plantilla vieja de producción (regresión real, no un ejemplo inventado)', () => {
    const found = findTokenLinks(OLD_PRODUCTION_TEMPLATE);
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((f) => f.variable === 'ConfirmationURL')).toBe(true);
  });

  it('también marca TokenHash y RedirectTo sueltos, no solo dentro de href', () => {
    expect(findTokenLinks('Contexto: {{ .TokenHash }}').length).toBe(1);
    expect(findTokenLinks('Contexto: {{ .RedirectTo }}').length).toBe(1);
  });

  it('no marca un HTML que solo lleva el código y el correo', () => {
    expect(findTokenLinks('<p>Hola {{ .Email }}, tu código es {{ .Token }}</p>')).toEqual([]);
  });
});

describe.each(CODE_KEYS)('plantilla de código: %s', (key) => {
  const tpl = AUTH_EMAIL_TEMPLATES[key];

  it('existe y trae asunto no vacío', () => {
    expect(tpl).toBeTruthy();
    expect(tpl.subject.trim().length).toBeGreaterThan(0);
  });

  it('contiene {{ .Token }}', () => {
    expect(tpl.html).toContain('{{ .Token }}');
  });

  it('no lleva ningún enlace con token (el correo no se puede gastar solo)', () => {
    expect(findTokenLinks(tpl.html)).toEqual([]);
  });

  it(`menciona la vigencia de ${OTP_TTL_MINUTES} minutos`, () => {
    expect(tpl.html).toContain(`${OTP_TTL_MINUTES} minutos`);
  });

  it('trae el aviso de seguridad de "no pediste este código"', () => {
    expect(tpl.html).toContain('¿No pediste este código?');
  });
});

it('email_change usa el enlace de confirmación (no tiene código propio: Supabase no lo emite para este flujo)', () => {
  const tpl = AUTH_EMAIL_TEMPLATES.email_change;
  expect(tpl.html).toContain('{{ .ConfirmationURL }}');
  expect(tpl.html).not.toContain('{{ .Token }}');
});

describe.each(ALL_KEYS)('reglas generales: %s', (key) => {
  const tpl = AUTH_EMAIL_TEMPLATES[key];

  it('usa solo variables permitidas para esta clave, en forma {{ .Nombre }}', () => {
    const matches = [...tpl.html.matchAll(/\{\{\s*\.([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
    expect(matches.length).toBeGreaterThan(0);
    for (const name of matches) {
      expect(ALLOWED_VARS[key]).toContain(name);
    }
  });

  it('no deja llaves de plantilla sin balancear', () => {
    const opens = (tpl.html.match(/\{\{/g) || []).length;
    const closes = (tpl.html.match(/\}\}/g) || []).length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThan(0);
  });

  it('declara lang="es" y menciona la marca', () => {
    expect(tpl.html).toContain('lang="es"');
    expect(tpl.html).toContain('Productivity-Plus');
  });

  it('no incluye <script> ni <link> (cero JS, cero hojas externas)', () => {
    const lower = tpl.html.toLowerCase();
    expect(lower).not.toContain('<script');
    expect(lower).not.toContain('<link');
  });

  it('no menciona proveedores ni modelos de IA', () => {
    for (const word of FORBIDDEN_WORDS) {
      expect(tpl.html).not.toContain(word);
    }
  });

  it('no deja restos en inglés de la plantilla de fábrica', () => {
    for (const phrase of FORBIDDEN_ENGLISH) {
      expect(tpl.html).not.toContain(phrase);
    }
  });

  it('pesa menos de 30 KB (Gmail recorta a partir de 102 KB, dejamos margen)', () => {
    const bytes = Buffer.byteLength(tpl.html, 'utf8');
    expect(bytes).toBeLessThan(30 * 1024);
  });

  it('no lleva comentarios HTML (Supabase usa html/template de Go y los elimina)', () => {
    // Un `<!--[if mso]>...<![endif]-->` (o cualquier otro comentario) se
    // parsea y se borra en el servidor antes de enviarse: si se cuela aquí
    // es HTML muerto que nunca llega a producción, y con él se pierde
    // silenciosamente cualquier ajuste que dependiera de ese comentario
    // (ej. el ancho fijo para Outlook, que por eso se resuelve con el
    // atributo `width`, no con un condicional).
    expect(tpl.html).not.toContain('<!--');
  });

  it('no queda el gris de bajo contraste #9490a8 (2.75:1 sobre lavanda, falla AA)', () => {
    expect(tpl.html).not.toContain('#9490a8');
  });

  it('ningún <a> usa el turquesa decorativo como color de texto (2.94:1 sobre lavanda, falla AA)', () => {
    const anchorStyles = [...tpl.html.matchAll(/<a\b[^>]*style="([^"]*)"/g)].map((m) => m[1]);
    for (const style of anchorStyles) {
      expect(style).not.toContain('#149cac');
    }
  });
});

describe('contraste AA del botón (invite y email_change)', () => {
  const BUTTON_KEYS = ['invite', 'email_change'];

  it.each(BUTTON_KEYS)('%s: usa el naranja oscuro accesible (#bf5803 ≈4.55:1), no el decorativo (#ec6c04 ≈3.13:1)', (key) => {
    const html = AUTH_EMAIL_TEMPLATES[key].html;
    expect(html).toContain('bgcolor="#bf5803"');
    expect(html).not.toContain('bgcolor="#ec6c04"');
  });

  it.each(BUTTON_KEYS)('%s: el enlace del botón lleva rel="noopener noreferrer"', (key) => {
    expect(AUTH_EMAIL_TEMPLATES[key].html).toContain('rel="noopener noreferrer"');
  });
});

describe('extractPreheader — el código nunca queda en el preheader', () => {
  // El preheader se lee en la vista previa de la bandeja de entrada y en
  // notificaciones de pantalla bloqueada: ambas visibles sin abrir el
  // correo ni desbloquear el teléfono. Antes de confiar en que la función
  // "no encuentra el token", hay que probar que SÍ lo encuentra cuando
  // está — si no, una extracción rota que siempre devuelve vacío pasaría
  // la prueba sin haber comprobado nada.
  it('detecta el token cuando SÍ está presente (control positivo)', () => {
    const sample = '<div style="display:none;mso-hide:all;">Tu código: {{ .Token }} · vence pronto</div>';
    expect(extractPreheader(sample)).toContain('{{ .Token }}');
  });

  it('devuelve null si el HTML no trae el div de preheader (evita comparar contra vacío)', () => {
    expect(extractPreheader('<p>sin preheader aquí</p>')).toBeNull();
  });

  it.each(ALL_KEYS)('%s: el preheader no contiene {{ .Token }}', (key) => {
    const preheader = extractPreheader(AUTH_EMAIL_TEMPLATES[key].html);
    expect(preheader).not.toBeNull();
    expect(preheader).not.toContain('{{ .Token }}');
  });
});

describe('toAuthConfigPatch', () => {
  it('tiene exactamente las 14 claves esperadas (6 asuntos + 6 contenidos + 2 números)', () => {
    const patch = toAuthConfigPatch();
    const expectedKeys = [
      ...ALL_KEYS.map((k) => `mailer_subjects_${k}`),
      ...ALL_KEYS.map((k) => `mailer_templates_${k}_content`),
      'mailer_otp_length',
      'mailer_otp_exp',
    ];
    expect(Object.keys(patch).sort()).toEqual(expectedKeys.sort());
    expect(Object.keys(patch)).toHaveLength(14);
  });

  it('publica mailer_otp_length y mailer_otp_exp desde src/lib/otp.js (fuente única)', () => {
    const patch = toAuthConfigPatch();
    expect(patch.mailer_otp_length).toBe(OTP_LENGTH);
    expect(patch.mailer_otp_exp).toBe(OTP_TTL_MINUTES * 60);
  });
});

describe('renderSample', () => {
  it('sustituye variables conocidas y deja intactas las desconocidas', () => {
    const out = renderSample('{{ .Token }} - {{ .Email }} - {{ .Desconocida }}', {
      Token: '12345678',
      Email: 'a@b.com',
    });
    expect(out).toBe('12345678 - a@b.com - {{ .Desconocida }}');
  });
});

describe('constantes', () => {
  it('APP_URL y SITE_URL son absolutas y propias de Productivity-Plus', () => {
    expect(APP_URL).toBe('https://productivityplus.softatumedida.com/app');
    expect(SITE_URL).toBe('https://productivityplus.softatumedida.com');
  });
});
