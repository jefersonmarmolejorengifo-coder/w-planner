// api/_email-brand.test.js
//
// Guardas del módulo de marca compartido por las plantillas de Supabase
// Auth (scripts/auth-email/templates.js) y por los correos que la propia
// app dispara vía Resend (api/invite.js, api/open-retro.js). El caso que
// más importa: la prueba de escapeHtml debe DISTINGUIR — tiene que fallar
// si alguien quita el escape, no solo pasar porque el input de la prueba
// era inofensivo.

import { describe, it, expect } from 'vitest';
import { escapeHtml, layout, heading, paragraph, ctaButton, infoBox, COLOR, SITE_URL } from './_email-brand.js';

describe('escapeHtml', () => {
  it('neutraliza <script> y comillas (control positivo: SÍ debe cambiar el input)', () => {
    const dirty = `<script>alert('x')</script> & "comillas"`;
    const out = escapeHtml(dirty);
    expect(out).not.toContain('<script>');
    expect(out).not.toContain("'");
    expect(out).not.toContain('"');
    expect(out).toBe('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;comillas&quot;');
  });

  it('no toca un texto ya inofensivo (no over-escapa)', () => {
    expect(escapeHtml('Sprint 12 - Equipo Norte')).toBe('Sprint 12 - Equipo Norte');
  });

  it('null/undefined se tratan como cadena vacía, no como el literal "null"', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('ctaButton', () => {
  const html = ctaButton('https://example.com', 'Ir');

  it('usa el naranja oscuro accesible (#bf5803), no el decorativo (#ec6c04)', () => {
    expect(html).toContain('bgcolor="#bf5803"');
    expect(html).not.toContain('bgcolor="#ec6c04"');
  });

  it('lleva rel="noopener noreferrer" (la pestaña abierta no controla esta)', () => {
    expect(html).toContain('rel="noopener noreferrer"');
  });
});

describe('layout', () => {
  const html = layout({
    title: 'Título de prueba',
    preheader: 'Preheader de prueba',
    contentHtml: paragraph('cuerpo'),
    footerNote: 'Nota de pie de prueba',
  });

  it('declara lang="es"', () => {
    expect(html).toContain('lang="es"');
  });

  it('lleva la marca (logo P+ y nombre)', () => {
    expect(html).toContain('>P<');
    expect(html).toContain('>+<');
    expect(html).toContain('PRODUCTIVITY-PLUS');
  });

  it('lleva la franja tricolor con los tres acentos de marca', () => {
    expect(html).toContain(COLOR.orange);
    expect(html).toContain(COLOR.turquoise);
    expect(html).toContain(COLOR.violet);
  });

  it('el pie enlaza a SITE_URL y muestra footerNote', () => {
    expect(html).toContain(`href="${SITE_URL}"`);
    expect(html).toContain('Nota de pie de prueba');
  });

  it('sin footerNote no deja un párrafo vacío colgando', () => {
    const sinNota = layout({ title: 't', preheader: 'p', contentHtml: '<p>x</p>' });
    expect(sinNota).not.toContain('undefined');
  });

  it('no incluye <script> ni <link> (cero JS, cero hojas externas)', () => {
    const lower = html.toLowerCase();
    expect(lower).not.toContain('<script');
    expect(lower).not.toContain('<link');
  });
});

describe('heading y paragraph', () => {
  it('heading produce un <h1> con el texto dado', () => {
    expect(heading('Hola')).toBe(
      `<h1 style="margin:0 0 14px;font-family:${'-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif'};font-size:22px;font-weight:800;color:${COLOR.ink};">Hola</h1>`
    );
  });

  it('paragraph envuelve HTML arbitrario en un <p>', () => {
    expect(paragraph('<strong>x</strong>')).toContain('<strong>x</strong>');
    expect(paragraph('<strong>x</strong>')).toMatch(/^<p /);
  });
});

describe('infoBox', () => {
  it('con mono=true usa el stack monoespaciado y letter-spacing', () => {
    const html = infoBox({ label: 'Código', value: '12345678', mono: true });
    expect(html).toContain('SFMono-Regular');
    expect(html).toContain('letter-spacing:3px');
    expect(html).toContain('12345678');
    expect(html).toContain('Código');
  });

  it('sin label, no deja un <p> vacío para la etiqueta', () => {
    const html = infoBox({ value: 'solo valor' });
    expect(html).not.toContain('text-transform:uppercase');
  });
});
