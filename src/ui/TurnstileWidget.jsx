/**
 * TurnstileWidget.jsx — Cloudflare Turnstile (CAPTCHA invisible) para el login.
 *
 * Por qué sin librería de terceros: el SDK de Turnstile es un único script
 * global (`window.turnstile`) con una API imperativa muy chica (render/reset/
 * remove); envolverlo aquí son ~80 líneas, menos código y menos superficie de
 * confianza que sumar una dependencia npm para lo mismo (H-054).
 *
 * Uso:
 *   const ref = useRef(null);
 *   <TurnstileWidget ref={ref} sitekey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
 *     onVerify={(token) => ...} onError={(codigo) => ...} />
 *   ref.current.reset(); // el token es de un solo uso: llamar tras CADA intento
 *
 * Contrato de `onVerify`: recibe el token en éxito, y `null` cuando el token
 * expira (Turnstile ya está reintentando solo en ese caso, no hace falta
 * remontar). Contrato de `onError`: recibe un código de texto (el que manda
 * Cloudflare en error-callback, o 'timeout'/'load_timeout' si el fallo es
 * nuestro) para que quien lo use pueda ofrecer "Reintentar" o contacto
 * (H-054, revisión de seguridad: sin esto, un bloqueador de anuncios o una
 * red corporativa que corta challenges.cloudflare.com dejaba a la persona
 * viendo "Verificando…" para siempre, sin salida).
 *
 * Si `VITE_TURNSTILE_SITE_KEY` no está definida, quien lo use ni siquiera
 * debe montar este componente (ver AuthScreen.jsx).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
// Techo de espera para que `window.turnstile` quede disponible tras inyectar
// el script. Cubre el caso de un bloqueador que deja pasar la etiqueta
// <script> (dispara `load`) pero sirve una respuesta vacía o interceptada:
// ni `onload` ni `onerror` avisan del problema real, así que sin este
// vencimiento el widget se queda esperando para siempre.
const SCRIPT_LOAD_TIMEOUT_MS = 10_000;

// Promesa compartida a nivel de módulo: si el componente se remonta (o hay
// más de una instancia) el script solo se descarga una vez. Se limpia a null
// en cualquier fallo para que un reintento (remontaje con nueva `key`)
// pueda volver a intentar desde cero.
let scriptPromise = null;
function cargarScriptTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const vencimiento = setTimeout(() => {
      scriptPromise = null;
      reject('load_timeout');
    }, SCRIPT_LOAD_TIMEOUT_MS);
    const listo = () => {
      clearTimeout(vencimiento);
      if (window.turnstile) resolve();
      else { scriptPromise = null; reject('load_timeout'); }
    };
    const fallo = () => { clearTimeout(vencimiento); scriptPromise = null; reject('load_timeout'); };

    const existente = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    if (existente) {
      if (window.turnstile) return listo();
      existente.addEventListener('load', listo);
      existente.addEventListener('error', fallo);
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = listo;
    script.onerror = fallo;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

const TurnstileWidget = forwardRef(function TurnstileWidget({ sitekey, onVerify, onError }, ref) {
  const contenedorRef = useRef(null);
  const widgetIdRef = useRef(null);
  // Callbacks en refs: así el efecto de montaje (que solo depende de
  // `sitekey`) siempre llama a la versión más reciente sin tener que
  // desmontar/remontar el widget cada vez que AuthScreen re-renderiza.
  const callbacksRef = useRef({ onVerify, onError });
  callbacksRef.current = { onVerify, onError };

  useImperativeHandle(ref, () => ({
    reset() {
      if (window.turnstile && widgetIdRef.current != null) {
        window.turnstile.reset(widgetIdRef.current);
      }
    },
  }), []);

  useEffect(() => {
    let cancelado = false;
    cargarScriptTurnstile()
      .then(() => {
        if (cancelado || !contenedorRef.current) return;
        widgetIdRef.current = window.turnstile.render(contenedorRef.current, {
          sitekey,
          appearance: 'interaction-only',
          language: 'es',
          callback: (token) => callbacksRef.current.onVerify?.(token),
          // El token expiró (pasaron ~5 min): Turnstile refresca el widget
          // solo, no hace falta remontar. Se avisa con null para que quien
          // use el componente vuelva a deshabilitar el botón hasta el
          // siguiente `callback`.
          'expired-callback': () => callbacksRef.current.onVerify?.(null),
          // Cloudflare manda un código de error real (p. ej. "300030" con
          // la sitekey de prueba "siempre falla"): se reenvía tal cual, sin
          // envolverlo en un Error, para que quien lo consuma decida el
          // mensaje.
          'error-callback': (codigo) => callbacksRef.current.onError?.(codigo || 'unknown_error'),
          'timeout-callback': () => callbacksRef.current.onError?.('timeout'),
        });
      })
      .catch((codigo) => { if (!cancelado) callbacksRef.current.onError?.(typeof codigo === 'string' ? codigo : 'load_error'); });

    return () => {
      cancelado = true;
      if (window.turnstile && widgetIdRef.current != null) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [sitekey]);

  return <div ref={contenedorRef} />;
});

export default TurnstileWidget;
