// @vitest-environment jsdom
//
// Pruebas de COMPORTAMIENTO de AuthScreen (H-053 de la auditoría triple).
// src/lib/otp.test.js ya fija los helpers puros y una guarda estática; este
// archivo monta el componente de verdad (jsdom + @testing-library/react) y
// ejerce los flujos de usuario: envío de código, autoenvío de verificación,
// cooldown de reenvío, y el CAPTCHA opcional de Turnstile (H-054/H-062).
//
// No se usa @testing-library/jest-dom (no está en las dependencias que pidió
// esta tarea): las aserciones sobre el DOM (disabled, foco, texto, presencia)
// se hacen con propiedades nativas del nodo, no con matchers extra.
//
// Mocks:
//   - '../supabaseClient': nunca se toca la red real ni credenciales.
//   - '../ui/TurnstileWidget': doble controlable (forwardRef con reset() y
//     callbacks capturados) para no depender del script real de Cloudflare.
// La clave del widget (VITE_TURNSTILE_SITE_KEY) y el aviso de enlace viejo
// (initialAuthUrlError) se leen al CARGAR el módulo, así que cada escenario
// que los necesita distintos hace vi.resetModules() + vi.doMock() + import
// dinámico (vi.mock() con snapshot NO sirve: resetModules() no vuelve a
// ejecutar el factory de un módulo ya mockeado, solo limpia el caché de
// módulos "normales"; vi.doMock() sí registra un factory nuevo cada vez).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { OTP_LENGTH } from '../lib/otp';

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();

vi.mock('../supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args) => signInWithOtp(...args),
      verifyOtp: (...args) => verifyOtp(...args),
    },
  },
}));

// Estado compartido del doble de TurnstileWidget: vi.hoisted() para que sea
// el MISMO objeto en cada re-evaluación del módulo tras vi.resetModules().
const turnstile = vi.hoisted(() => ({ reset: vi.fn(), props: null }));

vi.mock('../ui/TurnstileWidget', () => ({
  default: forwardRef(function TurnstileWidgetDouble(props, ref) {
    turnstile.props = props;
    useImperativeHandle(ref, () => ({ reset: turnstile.reset }), []);
    return null;
  }),
}));

async function montarAuthScreen({ turnstileKey, authUrlError = null } = {}) {
  vi.resetModules();
  if (turnstileKey) vi.stubEnv('VITE_TURNSTILE_SITE_KEY', turnstileKey);
  else vi.unstubAllEnvs();
  // doMock (no hoisteado): se registra de nuevo en CADA llamada, así que el
  // import dinámico de más abajo siempre recoge el valor de ESTE escenario.
  vi.doMock('../lib/initialAuthUrlError', () => ({ initialAuthUrlError: authUrlError }));
  const { default: AuthScreen } = await import('./AuthScreen.jsx');
  return render(<AuthScreen />);
}

function deferido() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function getForm() {
  return document.querySelector('form');
}

beforeEach(() => {
  // Valores por defecto seguros: cada test que necesita otro resultado lo
  // sobreescribe explícitamente. Sin esto, un mock sin configurar devuelve
  // `undefined` y AuthScreen revienta al desestructurar `{ error }` (crashea
  // el test entero con un rechazo no manejado en vez de fallar la aserción
  // concreta que se quería probar).
  signInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  verifyOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  turnstile.reset.mockReset();
  turnstile.props = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AuthScreen — envío de código (paso email)', () => {
  it('caso feliz: correo válido normalizado, sin captcha, pasa al paso de código', async () => {
    await montarAuthScreen();

    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: '  Persona@Empresa.COM  ' } });
    fireEvent.submit(getForm());

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'persona@empresa.com',
      options: { shouldCreateUser: true },
    });
    // Nunca debe reaparecer emailRedirectTo (H-053: regresión al link mágico).
    const [args] = signInWithOtp.mock.calls[0];
    expect(args.options).not.toHaveProperty('emailRedirectTo');

    await screen.findByLabelText('Código de acceso');
  });

  it('caso límite: acepta un correo con acentos/unicode en la parte local', async () => {
    await montarAuthScreen();

    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'josé.pérez@empresa.com' } });
    fireEvent.submit(getForm());

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledWith({
      email: 'josé.pérez@empresa.com',
      options: { shouldCreateUser: true },
    }));
  });

  it('fallo esperado: correo inválido no llama a Supabase y muestra el error en pantalla', async () => {
    await montarAuthScreen();

    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'no-es-un-correo' } });
    fireEvent.submit(getForm());

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Escribe un correo válido.');
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('fallo esperado: error de Supabase al enviar se traduce a español y nunca muestra el mensaje inglés', async () => {
    signInWithOtp.mockResolvedValue({
      error: { name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' },
    });
    await montarAuthScreen();

    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@empresa.com' } });
    fireEvent.submit(getForm());

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).not.toContain('Email rate limit exceeded');
    expect(alerta.textContent.toLowerCase()).toMatch(/espera/);
    // Sigue en el paso de correo: un error de envío no debe avanzar de paso.
    expect(screen.queryByLabelText('Correo electrónico')).not.toBeNull();
  });

  it('candado de doble envío: dos clics muy rápidos en "Enviarme el código" llaman a Supabase UNA sola vez', async () => {
    const diferido = deferido();
    signInWithOtp.mockReturnValue(diferido.promise);
    await montarAuthScreen();

    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@empresa.com' } });

    // Dos envíos del formulario ANTES de que la primera promesa resuelva:
    // simula el doble clic/doble Enter que el comentario del código describe.
    fireEvent.submit(getForm());
    fireEvent.submit(getForm());

    await act(async () => { diferido.resolve({ error: null }); await Promise.resolve(); await Promise.resolve(); });
    await screen.findByLabelText('Código de acceso');

    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('"¿Ya tienes un código?" exige un correo válido antes de saltar al paso de código', async () => {
    await montarAuthScreen();

    fireEvent.click(screen.getByRole('button', { name: '¿Ya tienes un código?' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).toBe('Escribe un correo válido.');
    expect(signInWithOtp).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@empresa.com' } });
    fireEvent.click(screen.getByRole('button', { name: '¿Ya tienes un código?' }));

    await screen.findByLabelText('Código de acceso');
    // Salta directo al paso de código SIN pedir un envío nuevo.
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});

describe('AuthScreen — verificación del código (paso code)', () => {
  async function llegarAPasoCode() {
    const utils = await montarAuthScreen();
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@empresa.com' } });
    fireEvent.submit(getForm());
    await screen.findByLabelText('Código de acceso');
    signInWithOtp.mockClear();
    return utils;
  }

  it('caso feliz: autoenvío al completar los 8 dígitos llama verifyOtp con type "email"', async () => {
    await llegarAPasoCode();

    fireEvent.change(screen.getByLabelText('Código de acceso'), { target: { value: '12345678'.slice(0, OTP_LENGTH) } });

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1));
    expect(verifyOtp).toHaveBeenCalledWith({ email: 'persona@empresa.com', token: '12345678'.slice(0, OTP_LENGTH), type: 'email' });
  });

  it('autoenvío + Enter: llama verifyOtp UNA sola vez aunque además se pulse Enter', async () => {
    const diferido = deferido();
    verifyOtp.mockReturnValue(diferido.promise);
    await llegarAPasoCode();

    fireEvent.change(screen.getByLabelText('Código de acceso'), { target: { value: '12345678'.slice(0, OTP_LENGTH) } });
    // El Enter llega mientras la primera verificación sigue pendiente.
    fireEvent.submit(getForm());

    await act(async () => { diferido.resolve({ error: null }); await Promise.resolve(); await Promise.resolve(); });
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('fallo esperado: verificación fallida limpia el campo, muestra error en español y devuelve el foco', async () => {
    verifyOtp.mockResolvedValue({
      error: { name: 'AuthApiError', status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' },
    });
    await llegarAPasoCode();

    const input = screen.getByLabelText('Código de acceso');
    fireEvent.change(input, { target: { value: '12345678'.slice(0, OTP_LENGTH) } });

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent).not.toContain('Token has expired or is invalid');
    await waitFor(() => expect(input.value).toBe(''));
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('"Usar otro correo" vuelve al paso 1 limpio (sin error ni aviso)', async () => {
    verifyOtp.mockResolvedValue({ error: { code: 'otp_expired', message: 'expired' } });
    await llegarAPasoCode();

    fireEvent.change(screen.getByLabelText('Código de acceso'), { target: { value: '12345678'.slice(0, OTP_LENGTH) } });
    await screen.findByRole('alert'); // deja un error pendiente en pantalla

    fireEvent.click(screen.getByRole('button', { name: 'Usar otro correo' }));

    await screen.findByLabelText('Correo electrónico');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cooldown de reenvío: deshabilitado y cuenta regresiva; se habilita al pasar 60s incluso si la pestaña estuvo en segundo plano', async () => {
    // shouldAdvanceTime: true evita que el polling interno de
    // findBy/waitFor de testing-library (que usa setTimeout real) se cuelgue
    // esperando un timer que los fake timers nunca disparan solos.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(0);
    await llegarAPasoCode();

    const getBotonReenviar = () => screen.getByRole('button', { name: /Reenviar|Verificando que eres una persona/ });
    expect(getBotonReenviar().textContent).toContain('Reenviar en 60 s');
    expect(getBotonReenviar().disabled).toBe(true);

    act(() => { vi.advanceTimersByTime(10_000); }); // t=10s
    expect(getBotonReenviar().textContent).toContain('Reenviar en 50 s');

    // La pestaña "se congela" en segundo plano: el reloj real salta 45s más
    // (t=55s) sin que el setInterval haya podido tickear ese tiempo. Al volver
    // a primer plano, visibilitychange debe recalcular de una vez.
    act(() => {
      vi.setSystemTime(55_000);
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(getBotonReenviar().textContent).toContain('Reenviar en 5 s');

    act(() => { vi.advanceTimersByTime(6_000); }); // t=61s > 60s: cooldown vencido
    expect(getBotonReenviar().textContent).toBe('Reenviar código');
    expect(getBotonReenviar().disabled).toBe(false);
  });
});

describe('AuthScreen — CAPTCHA de Turnstile (H-054)', () => {
  it('sin VITE_TURNSTILE_SITE_KEY: no monta el widget y signInWithOtp no recibe captchaToken', async () => {
    await montarAuthScreen({ turnstileKey: undefined });

    expect(turnstile.props).toBeNull();

    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@empresa.com' } });
    fireEvent.submit(getForm());

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
    const [args] = signInWithOtp.mock.calls[0];
    expect(args.options).not.toHaveProperty('captchaToken');
  });

  it('con clave: el botón espera el token, lo manda como captchaToken y resetea el widget tras enviar', async () => {
    await montarAuthScreen({ turnstileKey: 'sitekey-de-prueba' });

    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@empresa.com' } });
    const boton = getForm().querySelector('button[type="submit"]');
    expect(boton.disabled).toBe(true);
    expect(boton.textContent).toContain('Verificando que eres una persona…');

    expect(turnstile.props).not.toBeNull();
    act(() => { turnstile.props.onVerify('token-turnstile-123'); });

    expect(boton.disabled).toBe(false);
    fireEvent.submit(getForm());

    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
    const [args] = signInWithOtp.mock.calls[0];
    expect(args.options).toMatchObject({ shouldCreateUser: true, captchaToken: 'token-turnstile-123' });
    // El token es de un solo uso: se resetea tras CADA intento.
    await waitFor(() => expect(turnstile.reset).toHaveBeenCalledTimes(1));
  });

  it('CAPTCHA falla: muestra el aviso con "Reintentar verificación"; al segundo fallo agrega el contacto; "¿Ya tienes un código?" sigue funcionando', async () => {
    await montarAuthScreen({ turnstileKey: 'sitekey-de-prueba' });
    expect(turnstile.props).not.toBeNull();

    act(() => { turnstile.props.onError(new Error('timeout')); });

    const alerta = screen.getByRole('alert');
    expect(alerta.textContent.toLowerCase()).toContain('no pudimos confirmar');
    const botonReintentar = screen.getByRole('button', { name: 'Reintentar verificación' });
    // Al primer fallo todavía NO se ofrece el contacto (umbral: 2° fallo).
    expect(screen.queryByText('info@softatumedida.com')).toBeNull();

    // Reintentar limpia el aviso y remonta el widget (cambia `key`, no llama
    // a reset(): reintentarCaptcha en AuthScreen.jsx solo toca turnstileAttempt).
    fireEvent.click(botonReintentar);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(turnstile.props).not.toBeNull();

    // Segundo fallo del CAPTCHA: ahora sí aparece el contacto.
    act(() => { turnstile.props.onError(new Error('timeout otra vez')); });
    expect(screen.getByText('info@softatumedida.com')).toBeTruthy();

    // "¿Ya tienes un código?" no depende del estado del CAPTCHA.
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: 'persona@empresa.com' } });
    fireEvent.click(screen.getByRole('button', { name: '¿Ya tienes un código?' }));
    await screen.findByLabelText('Código de acceso');
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});

describe('AuthScreen — aviso de enlace viejo (H-065)', () => {
  it('muestra el aviso cuando initialAuthUrlError trae un error', async () => {
    await montarAuthScreen({ authUrlError: { code: 'otp_expired', description: 'Email link is invalid or has expired' } });

    const aviso = await screen.findByRole('status');
    expect(aviso.textContent).toContain('Ese enlace ya no sirve');
  });

  it('no muestra ningún aviso cuando no hay error en la URL (caso normal)', async () => {
    await montarAuthScreen({ authUrlError: null });

    expect(screen.queryByRole('status')).toBeNull();
  });
});
