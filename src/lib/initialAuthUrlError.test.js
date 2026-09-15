// Pruebas del parser puro de initialAuthUrlError.js (H-065).
// NO se prueba aquí el efecto de importación (lee `window.location.hash` y
// llama `history.replaceState` al evaluarse el módulo): eso lo cubrirá el
// especialista de testing con jsdom real. Esto fija el contrato de
// `parseAuthUrlError`, que sí es una función pura.

import { describe, it, expect } from 'vitest';
import { parseAuthUrlError } from './initialAuthUrlError';

describe('parseAuthUrlError', () => {
  it('hash vacío, sin hash o solo "#" da null', () => {
    expect(parseAuthUrlError('')).toBeNull();
    expect(parseAuthUrlError(null)).toBeNull();
    expect(parseAuthUrlError(undefined)).toBeNull();
    expect(parseAuthUrlError('#')).toBeNull();
  });

  it('un hash de error real de Supabase (enlace vencido) da code y description', () => {
    const hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    expect(parseAuthUrlError(hash)).toEqual({
      code: 'otp_expired',
      description: 'Email link is invalid or has expired',
    });
  });

  it('funciona igual sin el "#" inicial (por si el caller ya lo recortó)', () => {
    const hash = 'error=access_denied&error_code=otp_expired&error_description=algo';
    expect(parseAuthUrlError(hash)).toEqual({ code: 'otp_expired', description: 'algo' });
  });

  it('un hash con access_token (enlace viejo pero AÚN vigente) da null: no se toca', () => {
    const hash = '#access_token=abc123&refresh_token=def456&expires_in=3600&token_type=bearer&type=magiclink';
    expect(parseAuthUrlError(hash)).toBeNull();
  });

  it('access_token gana aunque el mismo hash también traiga error_code', () => {
    // Caso defensivo: no debería pasar en la práctica, pero si Supabase
    // alguna vez manda ambos, ganar el lado "no tocar" es el más seguro
    // (nunca borrar un token todavía usable).
    const hash = '#access_token=abc123&error_code=otp_expired';
    expect(parseAuthUrlError(hash)).toBeNull();
  });

  it('hash sin error ni access_token (ruta normal de la app) da null', () => {
    expect(parseAuthUrlError('#/alguna-ruta')).toBeNull();
    expect(parseAuthUrlError('#foo=bar')).toBeNull();
  });

  it('solo error_code sin error_description también cuenta como error', () => {
    expect(parseAuthUrlError('#error_code=otp_expired')).toEqual({ code: 'otp_expired', description: null });
  });
});
