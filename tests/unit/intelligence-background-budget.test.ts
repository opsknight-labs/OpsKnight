import { describe, expect, it } from 'vitest';
import {
  AI_SETTINGS_DEFAULTS,
  aiSettingsInputSchema,
  backgroundEmbeddingTokenBudget,
} from '@/lib/intelligence/ai/contract';

describe('background embedding allocation controls', () => {
  it('defaults to a bounded share of the existing total and rounds down', () => {
    expect(backgroundEmbeddingTokenBudget({ dailyTokenBudget: 1001 })).toBe(200);
    expect(
      backgroundEmbeddingTokenBudget({
        dailyTokenBudget: 1001,
        backgroundEmbeddingBudgetPercent: 80,
      })
    ).toBe(800);
    expect(
      backgroundEmbeddingTokenBudget({
        dailyTokenBudget: 1000,
        backgroundEmbeddingBudgetPercent: 0,
      })
    ).toBe(0);
  });
  it('rejects settings that could give background embedding the full allowance', () => {
    const settings = { ...AI_SETTINGS_DEFAULTS, expectedRevision: 0 };
    expect(aiSettingsInputSchema.parse(settings).backgroundEmbeddingBudgetPercent).toBe(20);
    for (const value of [-1, 81, 100, 20.5, NaN, Infinity]) {
      expect(
        aiSettingsInputSchema.safeParse({ ...settings, backgroundEmbeddingBudgetPercent: value })
          .success
      ).toBe(false);
    }
    for (const value of [0, 20, 80]) {
      expect(
        aiSettingsInputSchema.safeParse({ ...settings, backgroundEmbeddingBudgetPercent: value })
          .success
      ).toBe(true);
    }
  });
  it('fails closed on corrupt numeric limits and caps direct callers too', () => {
    expect(backgroundEmbeddingTokenBudget({ dailyTokenBudget: NaN })).toBe(0);
    expect(backgroundEmbeddingTokenBudget({ dailyTokenBudget: -1 })).toBe(0);
    expect(
      backgroundEmbeddingTokenBudget({
        dailyTokenBudget: 1000,
        backgroundEmbeddingBudgetPercent: NaN,
      })
    ).toBe(0);
    expect(
      backgroundEmbeddingTokenBudget({
        dailyTokenBudget: 1000,
        backgroundEmbeddingBudgetPercent: 100,
      })
    ).toBe(800);
  });
});
