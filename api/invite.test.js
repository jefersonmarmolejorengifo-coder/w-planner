// api/invite.test.js
//
// Guardas del correo de invitación a un tablero (buildInviteEmailHtml).
// El caso que más importa: el nombre del proyecto lo elige quien lo crea,
// así que un nombre con <script> o comillas debe llegar neutralizado al
// HTML que se envía por Resend a la persona invitada.

import { describe, it, expect } from 'vitest';
import { buildInviteEmailHtml } from './invite.js';

const BASE = {
  projectName: 'Lanzamiento Q3',
  inviteCode: 'ABCD1234',
  inviteUrl: 'https://productivityplus.softatumedida.com/app?join=ABCD1234',
};

describe('buildInviteEmailHtml — escapa datos controlados por usuarios', () => {
  it('escapa <script> y comillas en el nombre del proyecto', () => {
    const html = buildInviteEmailHtml({
      ...BASE,
      projectName: `<script>alert('x')</script> "Q3"`,
    });
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;Q3&quot;');
  });

  it('escapa el código de invitación', () => {
    const html = buildInviteEmailHtml({ ...BASE, inviteCode: `<b>hack</b>` });
    expect(html).not.toContain('<b>hack</b>');
    expect(html).toContain('&lt;b&gt;hack&lt;/b&gt;');
  });

  it('escapa la URL de invitación (por si el invite_code trae caracteres especiales)', () => {
    const html = buildInviteEmailHtml({ ...BASE, inviteUrl: `https://x.com/?a="><script>1</script>` });
    expect(html).not.toContain('<script>1</script>');
  });

  it('sin nombre de proyecto, usa el nombre de marca por defecto', () => {
    const html = buildInviteEmailHtml({ ...BASE, projectName: '' });
    expect(html).toContain('Productivity-Plus');
  });
});

describe('buildInviteEmailHtml — marca e identidad visual', () => {
  const html = buildInviteEmailHtml(BASE);

  it('declara lang="es"', () => {
    expect(html).toContain('lang="es"');
  });

  it('lleva la marca Productivity-Plus', () => {
    expect(html).toContain('PRODUCTIVITY-PLUS');
  });

  it('el botón usa el color accesible #bf5803 y rel="noopener noreferrer"', () => {
    expect(html).toContain('bgcolor="#bf5803"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('el enlace del botón apunta a la URL de invitación', () => {
    expect(html).toContain(BASE.inviteUrl);
  });

  it('muestra el código de invitación en texto plano (para copiar manualmente)', () => {
    expect(html).toContain(BASE.inviteCode);
  });
});
