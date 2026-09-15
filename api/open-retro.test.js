// api/open-retro.test.js
//
// Guardas del correo de "retro pendiente" (buildRetroEmailHtml). El caso
// que más importa: `sprintName` lo escribe libremente quien crea el sprint
// y ANTES no se escapaba — un nombre de sprint con <script> se habría
// ejecutado en la bandeja de entrada de todo el equipo (varios
// destinatarios a la vez, ver `to: emails` en el handler).

import { describe, it, expect } from 'vitest';
import { buildRetroEmailHtml } from './open-retro.js';

const BASE = {
  sprintName: 'Sprint 12',
  projectName: 'Proyecto #7',
  closesAtLocal: '21 de septiembre de 2026',
  appUrl: 'https://w-planner.vercel.app/app',
};

describe('buildRetroEmailHtml — escapa el nombre del sprint (dato libre de usuario)', () => {
  it('escapa <script> y comillas en sprintName', () => {
    const html = buildRetroEmailHtml({
      ...BASE,
      sprintName: `<script>alert('x')</script> "Sprint"`,
    });
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;Sprint&quot;');
  });

  it('sin sprintName, usa un valor por defecto en vez de "undefined"', () => {
    const html = buildRetroEmailHtml({ ...BASE, sprintName: '' });
    expect(html).not.toContain('undefined');
  });
});

describe('buildRetroEmailHtml — marca e identidad visual', () => {
  const html = buildRetroEmailHtml(BASE);

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

  it('el botón apunta a appUrl y dice "Responder ahora"', () => {
    expect(html).toContain(BASE.appUrl);
    expect(html).toContain('Responder ahora');
  });

  it('conserva el aviso de anonimato de las señalizaciones', () => {
    expect(html).toContain('Las señalizaciones son anónimas en la vista del PO');
  });

  it('conserva la fecha límite y el nombre del proyecto', () => {
    expect(html).toContain(BASE.closesAtLocal);
    expect(html).toContain(BASE.projectName);
  });
});
