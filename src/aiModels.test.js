import { describe, it, expect } from 'vitest';
import { AI_MODELS } from './aiModels';

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
    expect(AI_MODELS.evolution.id).toBe('claude-opus-4-7');
  });
});
