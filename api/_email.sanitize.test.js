import { describe, it, expect } from 'vitest';
import { sanitizeRichHtml } from './_email.js';

describe('sanitizeRichHtml (H-012)', () => {
  it('elimina <script> pero conserva el contenido permitido', () => {
    const dirty = '<div><script>alert(1)</script><p>hola</p></div>';
    const clean = sanitizeRichHtml(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).toContain('<p>hola</p>');
  });

  it('quita handlers inline tipo onerror/onclick', () => {
    const dirty = '<img src=x onerror="steal()"><button onclick="x()">x</button>';
    const clean = sanitizeRichHtml(dirty);
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).not.toMatch(/onclick/i);
  });

  it('neutraliza href con javascript:', () => {
    const clean = sanitizeRichHtml('<a href="javascript:alert(1)">x</a>');
    expect(clean).not.toMatch(/javascript:/i);
  });

  it('conserva el doctype solo si venía en el origen', () => {
    expect(sanitizeRichHtml('<!DOCTYPE html><div>a</div>')).toMatch(/^<!DOCTYPE html>/);
    expect(sanitizeRichHtml('<div>a</div>')).not.toMatch(/doctype/i);
  });

  it('lanza 413 si excede el tamaño máximo', () => {
    const huge = '<div>' + 'x'.repeat(400_000) + '</div>';
    try {
      sanitizeRichHtml(huge);
      throw new Error('no lanzó');
    } catch (e) {
      expect(e.status).toBe(413);
    }
  });
});
