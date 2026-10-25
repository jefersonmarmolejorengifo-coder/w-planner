// El cron se llama a sí mismo (generate-report, open-retro) por HTTP. VERCEL_URL
// es la URL del despliegue, que la Protección de Despliegues de Vercel responde
// con 401: el dominio propio (APP_BASE_URL) tiene que ganar siempre.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppBaseUrl } from './_http.js';

afterEach(() => vi.unstubAllEnvs());

describe('getAppBaseUrl', () => {
  it('prefiere APP_BASE_URL a VERCEL_URL', () => {
    vi.stubEnv('APP_BASE_URL', 'https://productivityplus.softatumedida.com/,https://otro.example');
    vi.stubEnv('VERCEL_URL', 'w-planner-abc123.vercel.app');
    expect(getAppBaseUrl()).toBe('https://productivityplus.softatumedida.com');
  });

  it('usa VERCEL_URL solo si no hay APP_BASE_URL', () => {
    vi.stubEnv('APP_BASE_URL', '');
    vi.stubEnv('VERCEL_URL', 'w-planner-abc123.vercel.app');
    expect(getAppBaseUrl()).toBe('https://w-planner-abc123.vercel.app');
  });
});
