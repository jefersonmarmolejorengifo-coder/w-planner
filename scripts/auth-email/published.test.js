// scripts/auth-email/published.test.js
//
// Guarda de integridad entre el CÓDIGO de las plantillas y lo que de verdad
// está publicado en Supabase Auth (scripts/auth-email/published.json, que
// escribe apply-auth-email-templates.mjs --apply tras verificar el PATCH).
//
// Por qué existe: el 2026-09-14 la app se desplegó con la pantalla de código
// pero las plantillas de correo quedaron sin publicar un rato, y nada avisó
// (H-056). Esta prueba corre en cada CI (.github/workflows/ci.yml → npm test)
// y falla en rojo si alguien edita una plantilla y no vuelve a correr
// --apply: la huella del código ya no coincidiría con la registrada.
//
// Lo que esta prueba NO hace: no llama a la Management API ni a la red — es
// una comparación local entre dos huellas. Que "published.json coincida con
// el código" no prueba que Supabase tenga esa huella en este momento (eso lo
// hace `--check` en vivo); prueba que nadie tocó una plantilla sin re-publicar
// desde la última vez que alguien corrió --apply.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { patchFingerprint } from './templates.js';

const publishedPath = fileURLToPath(new URL('./published.json', import.meta.url));
const published = JSON.parse(readFileSync(publishedPath, 'utf8'));

describe('published.json vs. patchFingerprint()', () => {
  it('la huella del código coincide con la última publicada', () => {
    const current = patchFingerprint();
    expect(
      current,
      `las plantillas cambiaron (huella actual ${current}) y no coinciden con ` +
        `published.json (${published.sha256}, publicado ${published.publishedAt} ` +
        `en ${published.ref}): corre --apply con SUPABASE_PROJECT_REF explícito ` +
        `y commitea el published.json actualizado.`
    ).toBe(published.sha256);
  });

  it('published.json trae las tres claves esperadas', () => {
    expect(Object.keys(published).sort()).toEqual(['publishedAt', 'ref', 'sha256']);
    expect(published.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(published.ref).toBeTruthy();
    expect(() => new Date(published.publishedAt).toISOString()).not.toThrow();
  });
});
