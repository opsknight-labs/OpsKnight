// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BRIEF_BUDGETS, fitLines, incidentBrief, renderBrief } from '@/lib/intelligence/ai/brief';
import { callSiteRefusal, deterministicOnly } from '@/lib/intelligence/ai/call-site';
import { AI_OUTPUT_TOKENS, outputTokensFor } from '@/lib/intelligence/ai/output-limits';
import {
  costMicrosFor,
  providerCacheSavedMicros,
  resolveModelPrice,
} from '@/lib/intelligence/ai/pricing';

describe('shared incident brief', () => {
  it('keeps whole lines inside a section budget and says how many it left out', () => {
    const lines = Array.from({ length: 10 }, (_, index) => `- line ${index}`);
    const head = fitLines({ lines, budget: 30 });
    expect(head).toEqual(['- line 0', '- line 1', '- line 2', '- (7 more not shown)']);
    const tail = fitLines({ lines, budget: 30, keep: 'tail' });
    expect(tail).toEqual(['- (7 earlier not shown)', '- line 7', '- line 8', '- line 9']);
    expect(fitLines({ lines: ['x'.repeat(50)], budget: 20 })).toEqual([`${'x'.repeat(19)}…`]);
  });

  it('omits empty sections and their headings', () => {
    expect(
      renderBrief([
        { lines: ['a'], budget: 10 },
        { heading: 'Empty:', lines: [], budget: 10 },
        { heading: 'Full:', lines: ['b'], budget: 10 },
      ])
    ).toBe('a\nFull:\nb');
  });

  it('bounds a noisy incident: every section stays inside its budget and the latest events survive', () => {
    const at = new Date('2026-11-01T00:00:00Z');
    const brief = incidentBrief({
      title: 'Checkout down',
      serviceName: 'Checkout',
      status: 'OPEN',
      urgency: 'HIGH',
      createdAt: at,
      description: 'd'.repeat(5_000),
      timeline: Array.from({ length: 500 }, (_, index) => ({
        at: new Date(at.getTime() + index * 1_000),
        text: `event ${index} ${'e'.repeat(400)}`,
      })),
      notes: Array.from({ length: 500 }, (_, index) => ({
        at,
        author: 'Ada',
        text: `note ${index} ${'n'.repeat(900)}`,
      })),
      changes: Array.from({ length: 100 }, (_, index) => ({
        label: `deploy ${index}`,
        minutesBefore: index,
      })),
    });
    const ceiling = Object.values(BRIEF_BUDGETS).reduce((sum, budget) => sum + budget, 0) + 1_000; // headings, notes
    expect(brief.length).toBeLessThan(ceiling);
    expect(brief).toContain('event 499');
    expect(brief).not.toContain('event 0 ');
    expect(brief).toMatch(/\(\d+ earlier not shown\)/);
    expect(brief).toContain('Status: open; urgency high');
    expect(brief).toContain('Acknowledged: not yet');
    expect(brief).toContain('correlation only, not confirmed causes');
    // Unchanged facts give a byte-identical brief, which is what makes the result cache hit.
    expect(
      incidentBrief({ title: 'a', serviceName: 'b', status: 'OPEN', urgency: 'LOW', createdAt: at })
    ).toBe(
      incidentBrief({ title: 'a', serviceName: 'b', status: 'OPEN', urgency: 'LOW', createdAt: at })
    );
  });
});

describe('output token table', () => {
  it('is the single source for per-feature answer length', () => {
    expect(outputTokensFor('postmortem.draft')).toBe(4_096);
    expect(outputTokensFor('incident.summary')).toBe(1_024);
    expect(outputTokensFor('handoff.narrative')).toBe(200);
    for (const value of Object.values(AI_OUTPUT_TOKENS)) expect(value).toBeGreaterThan(0);
  });
});

describe('call-site gate', () => {
  it('requires a known tag and refuses everything inside a deterministic surface', async () => {
    expect(callSiteRefusal({})).toMatch(/without a call-site tag/);
    expect(callSiteRefusal({ callSite: 'list' })).toMatch(/without a call-site tag/);
    for (const callSite of ['interactive', 'proactive', 'background'])
      expect(callSiteRefusal({ callSite })).toBeNull();
    const inside = await deterministicOnly('incident list badges', async () => {
      await Promise.resolve();
      return callSiteRefusal({ callSite: 'interactive' });
    });
    expect(inside).toBe('AI calls are not allowed while rendering incident list badges');
    expect(callSiteRefusal({ callSite: 'interactive' })).toBeNull();
  });
});

describe('prompt-cache pricing', () => {
  const sonnet = resolveModelPrice('ANTHROPIC', 'claude-sonnet-4-5');

  it('prices Claude cache reads at 0.1x and 5-minute cache writes at 1.25x of input, on every host', () => {
    expect(sonnet).toMatchObject({ inputUsdPerMTok: 3, outputUsdPerMTok: 15 });
    expect(sonnet?.cacheReadUsdPerMTok).toBeCloseTo(0.3);
    expect(sonnet?.cacheWriteUsdPerMTok).toBeCloseTo(3.75);
    const bedrock = resolveModelPrice('BEDROCK', 'us.anthropic.claude-sonnet-4-20250514-v1:0');
    expect(bedrock?.cacheReadUsdPerMTok).toBeCloseTo(0.3);
    // An administrator's override keeps the family's cache ratios.
    const override = resolveModelPrice('ANTHROPIC', 'claude-sonnet-4-5', [
      {
        providerKind: 'ANTHROPIC',
        model: 'claude-sonnet-4-5',
        inputUsdPerMTok: 2,
        outputUsdPerMTok: 10,
      },
    ]);
    expect(override).toMatchObject({ source: 'override' });
    expect(override?.cacheReadUsdPerMTok).toBeCloseTo(0.2);
  });

  it('leaves other families at the full input rate rather than guessing a discount', () => {
    const gpt = resolveModelPrice('OPENAI', 'gpt-4o');
    expect(gpt).not.toBeNull();
    expect(gpt?.cacheReadUsdPerMTok).toBeUndefined();
    const usage = { inputTokens: 1_000, outputTokens: 0, cacheReadTokens: 800 };
    expect(costMicrosFor(usage, gpt)).toBe(
      costMicrosFor({ inputTokens: 1_000, outputTokens: 0 }, gpt)
    );
    expect(providerCacheSavedMicros(usage, gpt)).toBe(0);
  });

  it('charges the three kinds of prompt token separately; the total includes the cached ones', () => {
    // 1,000 prompt tokens = 100 uncached + 700 read + 200 written, plus 50 output.
    const usage = {
      inputTokens: 1_000,
      outputTokens: 50,
      cacheReadTokens: 700,
      cacheWriteTokens: 200,
    };
    // 100*3 + 700*0.3 + 200*3.75 + 50*15 = 300 + 210 + 750 + 750
    expect(costMicrosFor(usage, sonnet)).toBe(2_010);
    // Against paying full input for all 1,000: read saves 700*2.7 = 1,890; write costs 200*0.75 = 150 more.
    expect(providerCacheSavedMicros(usage, sonnet)).toBe(1_740);
    expect(costMicrosFor(usage, sonnet)! + providerCacheSavedMicros(usage, sonnet)).toBe(
      costMicrosFor({ inputTokens: 1_000, outputTokens: 50 }, sonnet)
    );
  });

  it('is negative for a write-only call and never lets cache counts exceed the prompt', () => {
    expect(
      providerCacheSavedMicros(
        { inputTokens: 1_000, outputTokens: 0, cacheWriteTokens: 1_000 },
        sonnet
      )
    ).toBe(-750);
    expect(
      costMicrosFor({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 5_000 }, sonnet)
    ).toBe(30);
    expect(
      costMicrosFor({ inputTokens: 100, outputTokens: 0, cacheReadTokens: 50 }, null)
    ).toBeNull();
    expect(providerCacheSavedMicros({ inputTokens: 100, outputTokens: 0 }, null)).toBe(0);
  });
});
