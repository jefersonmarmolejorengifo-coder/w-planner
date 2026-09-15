// ─── Error inicial en la URL (enlace viejo de link mágico) ─────────────────
// H-065: el login pasó de "link mágico" a "código de 8 dígitos" (ver
// src/lib/otp.js), pero un correo VIEJO que alguien no haya abierto todavía
// puede seguir circulando. Si ese enlace ya venció, Supabase redirige con el
// error en el hash de la URL:
//   #error=access_denied&error_code=otp_expired&error_description=...
// supabase-js LEE ese hash al construirse (createClient) y LANZA una
// excepción sin limpiarlo. Si no lo quitamos ANTES, cada recarga de la
// página vuelve a mostrar el mismo error para siempre (la URL nunca cambia
// sola). Por eso este módulo se importa en la PRIMERA línea de
// src/supabaseClient.js: corre antes de que exista el cliente.
//
// Un hash con `access_token` es un enlace VIEJO PERO AÚN VIGENTE: ese sí lo
// necesita supabase-js para completar el login, así que no se toca.

// Función pura: no lee `window`, así que se prueba sin jsdom real.
export function parseAuthUrlError(hash) {
  const crudo = String(hash ?? '').replace(/^#/, '');
  if (!crudo) return null;
  const params = new URLSearchParams(crudo);
  if (params.has('access_token')) return null;
  const code = params.get('error_code');
  const description = params.get('error_description');
  if (!params.has('error') && !code && !description) return null;
  return { code: code || null, description: description || null };
}

// Efecto al importar (intencional): se calcula UNA vez, con la URL de carga
// de la página, y limpia el hash de inmediato para que no sobreviva a un
// refresh. Se exporta el resultado para que AuthScreen decida qué mostrar.
export const initialAuthUrlError = typeof window === 'undefined'
  ? null
  : (() => {
      const resultado = parseAuthUrlError(window.location.hash);
      if (resultado) {
        // Conserva pathname + query (p. ej. ?join=...); solo borra el hash.
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      }
      return resultado;
    })();
