import { describe, it, expect } from 'vitest';
import { AI_MODELS, AI_PRICING, computeCostUsd, embedUsageComment, extractUsageMarker } from './aiModels';

describe('AI_MODELS (H-022)', () => {
  it('cada feature define id y label no vacíos', () => {
    for (const [key, m] of Object.entries(AI_MODELS)) {
      expect(m.id, `${key}.id`).toBeTruthy();
      expect(m.label, `${key}.label`).toBeTruthy();
    }
  });

  it('los reportes weekly y monthly usan el mismo modelo real (Sonnet 4.6)', () => {
    // Documenta la verdad: ambos llaman Sonnet, no Opus. Si alguien cambia el id
    // del call sin actualizar la constante, este test lo detecta.
    expect(AI_MODELS.weeklyReport.id).toBe('claude-sonnet-4-6');
    expect(AI_MODELS.monthlyReport.id).toBe('claude-sonnet-4-6');
  });

  it('el evolutivo se mantiene en Opus por profundidad de análisis', () => {
    // O-07: bump de Opus 4.7 (legacy) -> Opus 4.8.
    expect(AI_MODELS.evolution.id).toBe('claude-opus-4-8');
  });

  it('cada modelo usado por AI_MODELS tiene precio definido en AI_PRICING', () => {
    // Si un feature apunta a un id sin precio, computeCostUsd devolvería null
    // silenciosamente para SIEMPRE en ese feature. Este test lo detecta.
    for (const [key, m] of Object.entries(AI_MODELS)) {
      expect(AI_PRICING[m.id], `AI_PRICING["${m.id}"] (usado por ${key})`).toBeTruthy();
    }
  });
});

describe('computeCostUsd (H-cost)', () => {
  it('calcula el costo de Gemini Flash con el precio real jul-2026 ($0.30/$2.50)', () => {
    // Regresión directa del bug: antes se cobraba a $1.50/$9.00 (precio viejo).
    const cost = computeCostUsd('gemini-2.5-flash', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.30 + 2.50, 6);
  });

  it('calcula el costo de Sonnet 4.6 incluyendo cache write/read', () => {
    // cache write = 1.25x precio input, cache read = 0.1x precio input.
    const cost = computeCostUsd('claude-sonnet-4-6', {
      inputTokens: 1_000_000, outputTokens: 1_000_000,
      cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 + 15 + 3.75 + 0.3, 6);
  });

  it('devuelve null (no inventa un precio) para un modelo desconocido', () => {
    expect(computeCostUsd('modelo-que-no-existe', { inputTokens: 100, outputTokens: 100 })).toBeNull();
  });

  it('devuelve null si faltan tokens en vez de romper (best-effort)', () => {
    expect(computeCostUsd('claude-sonnet-4-6', { inputTokens: null, outputTokens: 100 })).toBeNull();
    expect(computeCostUsd('claude-sonnet-4-6', {})).toBeNull();
  });
});

describe('embedUsageComment / extractUsageMarker (H-cost)', () => {
  it('viaja ida y vuelta: lo que se embebe se puede extraer igual', () => {
    const usage = { model: 'claude-sonnet-4-6', tokensInput: 1234, tokensOutput: 567, costUsd: 0.012345 };
    const html = '<!DOCTYPE html><html><body>hola</body></html>';
    const stream = html + embedUsageComment(usage);

    const { usage: extracted, html: cleaned } = extractUsageMarker(stream);
    expect(extracted).toEqual({
      model: 'claude-sonnet-4-6', tokens_input: 1234, tokens_output: 567, cost_usd: 0.012345,
    });
    // El HTML queda exactamente como se generó, sin el comentario de metadata.
    expect(cleaned).toBe(html);
  });

  it('devuelve usage null y el texto intacto si no hay marcador (caso de fallo esperado)', () => {
    const html = '<!DOCTYPE html><html><body>sin marcador</body></html>';
    const { usage, html: cleaned } = extractUsageMarker(html);
    expect(usage).toBeNull();
    expect(cleaned).toBe(html);
  });

  it('best-effort: JSON corrupto en el marcador no rompe, usage queda null', () => {
    const broken = 'contenido<!-- WPLANNER_USAGE:{esto no es json} -->';
    const { usage, html } = extractUsageMarker(broken);
    expect(usage).toBeNull();
    expect(html).toBe('contenido');
  });

  it('tolera undefined/null como input sin lanzar', () => {
    expect(() => extractUsageMarker(undefined)).not.toThrow();
    expect(() => extractUsageMarker(null)).not.toThrow();
    expect(extractUsageMarker(null)).toEqual({ usage: null, html: '' });
  });
});
