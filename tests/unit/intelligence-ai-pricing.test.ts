import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_MODEL_PRICES,
  PROVIDER_KINDS,
  budgetKey,
  budgetUtilization,
  costMicrosFor,
  formatUsd,
  normaliseModelId,
  resolveModelPrice,
  usdToMicros,
  wouldExceed,
} from '@/lib/intelligence/ai/pricing';

describe('model price table', () => {
  it('normalises host-specific model ids to one family id', () => {
    expect(normaliseModelId('us.anthropic.claude-sonnet-4-20250514-v1:0')).toBe(
      'claude-sonnet-4-20250514-v1:0'
    );
    expect(normaliseModelId('global.anthropic.claude-opus-4-8')).toBe('claude-opus-4-8');
    expect(normaliseModelId('claude-3-5-sonnet@20240620')).toBe('claude-3-5-sonnet');
    expect(normaliseModelId('models/gemini-2.5-pro')).toBe('gemini-2.5-pro');
    expect(normaliseModelId('  GPT-4o-Mini ')).toBe('gpt-4o-mini');
    expect(normaliseModelId('mistral.mistral-large-2407-v1:0')).toBe('mistral-large-2407-v1:0');
  });

  it('picks the longest built-in family prefix for the provider kind', () => {
    expect(resolveModelPrice('OPENAI', 'gpt-4o-mini-2024-07-18')).toMatchObject({
      inputUsdPerMTok: 0.15,
      outputUsdPerMTok: 0.6,
      source: 'built-in',
    });
    expect(resolveModelPrice('OPENAI', 'gpt-4o')).toMatchObject({ inputUsdPerMTok: 2.5 });
    expect(resolveModelPrice('OPENAI', 'o3-mini')).toMatchObject({ inputUsdPerMTok: 1.1 });
    expect(resolveModelPrice('ANTHROPIC', 'claude-opus-4-1-20250805')).toMatchObject({
      inputUsdPerMTok: 15,
      outputUsdPerMTok: 75,
    });
    expect(resolveModelPrice('ANTHROPIC', 'claude-opus-4-8')).toMatchObject({
      inputUsdPerMTok: 5,
      outputUsdPerMTok: 25,
    });
    expect(
      resolveModelPrice('BEDROCK', 'us.anthropic.claude-haiku-4-5-20251001-v1:0')
    ).toMatchObject({ inputUsdPerMTok: 1, outputUsdPerMTok: 5 });
    expect(resolveModelPrice('VERTEX', 'gemini-2.5-flash-lite')).toMatchObject({
      inputUsdPerMTok: 0.1,
    });
    expect(resolveModelPrice('GROQ', 'llama-3.3-70b-versatile')).toMatchObject({
      inputUsdPerMTok: 0.59,
    });
    expect(resolveModelPrice('AZURE_OPENAI', 'gpt-4.1-mini')).toMatchObject({
      inputUsdPerMTok: 0.4,
    });
  });

  it('does not price a family on a host that does not serve it, or a self-hosted model', () => {
    expect(resolveModelPrice('GROQ', 'gpt-4o')).toBeNull();
    expect(resolveModelPrice('OPENAI', 'claude-sonnet-4')).toBeNull();
    expect(resolveModelPrice('OPENAI_COMPATIBLE', 'llama-3.3-70b')).toBeNull();
    expect(resolveModelPrice('OPENAI', 'my-private-deployment')).toBeNull();
  });

  it('lets an administrator override a built-in price or price an unknown model', () => {
    const overrides = [
      { providerKind: 'OPENAI' as const, model: 'GPT-4o', inputUsdPerMTok: 1, outputUsdPerMTok: 2 },
      {
        providerKind: 'OPENAI_COMPATIBLE' as const,
        model: 'llama-3.3-70b',
        inputUsdPerMTok: 0.2,
        outputUsdPerMTok: 0.2,
      },
    ];
    expect(resolveModelPrice('OPENAI', 'gpt-4o', overrides)).toEqual({
      inputUsdPerMTok: 1,
      outputUsdPerMTok: 2,
      source: 'override',
    });
    // Overrides are exact per provider kind: Azure keeps the built-in price.
    expect(resolveModelPrice('AZURE_OPENAI', 'gpt-4o', overrides)?.source).toBe('built-in');
    expect(resolveModelPrice('OPENAI_COMPATIBLE', 'llama-3.3-70b', overrides)?.source).toBe(
      'override'
    );
    // An invalid override is ignored rather than producing a nonsense cost.
    expect(
      resolveModelPrice('OPENAI', 'gpt-4o', [
        { providerKind: 'OPENAI', model: 'gpt-4o', inputUsdPerMTok: -1, outputUsdPerMTok: 1 },
      ])?.source
    ).toBe('built-in');
  });

  it('has a built-in price for every hosted provider kind and sane values', () => {
    const covered = new Set(BUILT_IN_MODEL_PRICES.flatMap(entry => entry.kinds));
    for (const kind of PROVIDER_KINDS.filter(kind => kind !== 'OPENAI_COMPATIBLE'))
      expect(covered.has(kind), kind).toBe(true);
    for (const entry of BUILT_IN_MODEL_PRICES) {
      expect(entry.inputUsdPerMTok).toBeGreaterThan(0);
      expect(entry.outputUsdPerMTok).toBeGreaterThanOrEqual(0);
      expect(entry.prefix).toBe(entry.prefix.toLowerCase());
    }
  });
});

describe('cost computation', () => {
  it('computes integer micro-dollars from tokens and per-million prices', () => {
    const price = { inputUsdPerMTok: 3, outputUsdPerMTok: 15 };
    expect(costMicrosFor({ inputTokens: 1_000_000, outputTokens: 0 }, price)).toBe(3_000_000);
    expect(costMicrosFor({ inputTokens: 1000, outputTokens: 500 }, price)).toBe(10_500);
    expect(
      costMicrosFor(
        { inputTokens: 1, outputTokens: 0 },
        { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0 }
      )
    ).toBe(0);
    expect(
      costMicrosFor(
        { inputTokens: 10, outputTokens: 0 },
        { inputUsdPerMTok: 0.15, outputUsdPerMTok: 0 }
      )
    ).toBe(2);
  });

  it('treats an unpriced model as unknown, and clamps bad token counts', () => {
    expect(costMicrosFor({ inputTokens: 100, outputTokens: 100 }, null)).toBeNull();
    expect(
      costMicrosFor(
        { inputTokens: -5, outputTokens: Number.NaN },
        { inputUsdPerMTok: 1, outputUsdPerMTok: 1 }
      )
    ).toBe(0);
  });

  it('formats dollars with extra precision below a cent', () => {
    expect(formatUsd(12_345_678)).toBe('$12.35');
    expect(formatUsd(1_234)).toBe('$0.0012');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(null)).toBe('$0.00');
    expect(formatUsd(BigInt(5_000_000))).toBe('$5.00');
    expect(usdToMicros(2.5)).toBe(2_500_000);
  });
});

describe('budget arithmetic', () => {
  const both = { dailyTokenLimit: 1000, dailyCostLimitMicros: 1_000_000 };

  it('blocks when either the token or the dollar limit would be exceeded', () => {
    expect(wouldExceed(both, { tokens: 900, costMicros: 0 }, { tokens: 100, costMicros: 0 })).toBe(
      false
    );
    expect(wouldExceed(both, { tokens: 901, costMicros: 0 }, { tokens: 100, costMicros: 0 })).toBe(
      true
    );
    expect(
      wouldExceed(both, { tokens: 0, costMicros: 999_999 }, { tokens: 1, costMicros: 2 })
    ).toBe(true);
  });

  it('never blocks on a missing limit, and lets unpriced calls through a dollar-only budget', () => {
    const dollars = { dailyTokenLimit: null, dailyCostLimitMicros: 100 };
    expect(
      wouldExceed(dollars, { tokens: 10 ** 9, costMicros: 100 }, { tokens: 1, costMicros: 0 })
    ).toBe(false);
    expect(wouldExceed(dollars, { tokens: 0, costMicros: 100 }, { tokens: 1, costMicros: 1 })).toBe(
      true
    );
    expect(
      wouldExceed(
        { dailyTokenLimit: null, dailyCostLimitMicros: null },
        { tokens: 10 ** 9, costMicros: 10 ** 9 },
        { tokens: 1, costMicros: 1 }
      )
    ).toBe(false);
  });

  it('reports the higher of the two utilisation ratios', () => {
    expect(budgetUtilization(both, { tokens: 800, costMicros: 100_000 })).toBe(0.8);
    expect(budgetUtilization(both, { tokens: 100, costMicros: 1_200_000 })).toBe(1.2);
    expect(
      budgetUtilization(
        { dailyTokenLimit: null, dailyCostLimitMicros: null },
        { tokens: 5, costMicros: 5 }
      )
    ).toBe(0);
    expect(
      budgetUtilization(
        { dailyTokenLimit: 0, dailyCostLimitMicros: null },
        { tokens: 0, costMicros: 0 }
      )
    ).toBe(1);
  });

  it('builds stable budget keys', () => {
    expect(budgetKey('TEAM', 't1')).toBe('team:t1');
    expect(budgetKey('CAPABILITY', 'SQUIRE_CHAT')).toBe('capability:SQUIRE_CHAT');
  });
});
