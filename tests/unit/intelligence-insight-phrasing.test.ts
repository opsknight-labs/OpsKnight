import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpsInsightView } from '@/lib/intelligence/ops-insights/contract';

const resolveLanguageModel = vi.fn();
vi.mock('@/lib/intelligence/ai/port', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/intelligence/ai/port')>()),
  resolveLanguageModel: (...args: unknown[]) => resolveLanguageModel(...args),
}));
vi.mock('@/lib/intelligence/ai/gateway', () => {
  class AiGatewayError extends Error {
    constructor(
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  }
  return { AiGatewayError, registerAiGateway: vi.fn() };
});
// The cache is exercised elsewhere; here it passes straight through to the port.
const cacheOptions = vi.fn();
vi.mock('@/lib/intelligence/ai/result-cache', () => ({
  cachedGenerateStructured: (
    port: { generateStructured: (r: unknown) => unknown },
    request: unknown,
    options: unknown
  ) => {
    cacheOptions(options);
    return port.generateStructured(request);
  },
}));
vi.mock('@/lib/intelligence/ops-insights/view', () => ({ listInsightsForScope: vi.fn() }));

import { AiGatewayError } from '@/lib/intelligence/ai/gateway';
import { AI_LEAN_NOTICE } from '@/lib/intelligence/ai/contract';
import { outputTokensFor } from '@/lib/intelligence/ai/output-limits';
import {
  INSIGHT_PHRASING_MAX,
  PHRASING_BUDGET_SPENT,
  PHRASING_UNAVAILABLE,
  insightPhrasingBrief,
  phraseInsights,
} from '@/lib/intelligence/ops-insights/phrasing';

const insight = (id: string, overrides: Partial<OpsInsightView> = {}): OpsInsightView => ({
  id,
  scopeType: 'SERVICE',
  scopeId: 'svc-1',
  kind: 'integration.health',
  key: id,
  area: 'automation',
  severity: 'WARNING',
  status: 'OPEN',
  title: `Title ${id}`,
  summary: `Summary ${id}`,
  evidence: { window: 'last 7 days', facts: [{ label: 'Alerts per day', value: '4' }] },
  draftHref: null,
  firstSeenAt: new Date('2026-11-01T00:00:00Z'),
  lastSeenAt: new Date('2026-11-02T00:00:00Z'),
  ...overrides,
});

const actor = { id: 'user-1' };
const service = { type: 'SERVICE', id: 'svc-1' } as const;
const generateStructured = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resolveLanguageModel.mockResolvedValue({ generateStructured });
});

describe('phraseInsights', () => {
  it('phrases every insight of a scope in one structured call', async () => {
    generateStructured.mockResolvedValue({
      object: {
        items: [
          { id: 'a', text: 'Plain a.' },
          { id: 'b', text: 'Plain b.' },
        ],
      },
    });
    const result = await phraseInsights(actor, service, [insight('a'), insight('b')]);

    expect(result).toEqual({ phrases: { a: 'Plain a.', b: 'Plain b.' } });
    expect(generateStructured).toHaveBeenCalledTimes(1);
    const request = generateStructured.mock.calls[0][0];
    expect(request.context).toMatchObject({
      actorId: 'user-1',
      capability: 'SUMMARIZE',
      callSite: 'interactive',
      dataClass: 'INTERNAL',
    });
    expect(request.maxOutputTokens).toBe(outputTokensFor('insights.phrasing'));
    expect(request.messages[1].content).toContain('id: a');
    expect(request.messages[1].content).toContain('id: b');
    expect(cacheOptions).toHaveBeenCalledWith({
      prompt: { id: 'insights.phrasing', version: 1 },
      scope: 'SERVICE:svc-1',
    });
  });

  it('makes no call for an empty list', async () => {
    expect(await phraseInsights(actor, service, [])).toEqual({ phrases: {} });
    expect(resolveLanguageModel).not.toHaveBeenCalled();
  });

  it('keeps only phrases for insights that were sent', async () => {
    generateStructured.mockResolvedValue({
      object: {
        items: [
          { id: 'a', text: 'Plain a.' },
          { id: 'other', text: 'Not ours.' },
        ],
      },
    });
    expect((await phraseInsights(actor, service, [insight('a')])).phrases).toEqual({
      a: 'Plain a.',
    });
  });

  it('caps the number of insights sent', async () => {
    generateStructured.mockResolvedValue({ object: { items: [{ id: 'i0', text: 'x' }] } });
    const many = Array.from({ length: INSIGHT_PHRASING_MAX + 5 }, (_, i) => insight(`i${i}`));
    await phraseInsights(actor, service, many);
    const content: string = generateStructured.mock.calls[0][0].messages[1].content;
    expect(content.match(/^id: /gm)).toHaveLength(INSIGHT_PHRASING_MAX);
  });

  it('phrases a person’s insights as personal data, cached for that viewer only', async () => {
    generateStructured.mockResolvedValue({ object: { items: [{ id: 'a', text: 'x' }] } });
    await phraseInsights(actor, { type: 'USER', id: 'user-9' }, [insight('a')]);
    expect(resolveLanguageModel).toHaveBeenCalledWith('SUMMARIZE', 'PERSONAL');
    expect(cacheOptions).toHaveBeenCalledWith(expect.objectContaining({ scope: 'user:user-1' }));
  });

  it('says so when a smaller model wrote the phrasing', async () => {
    generateStructured.mockResolvedValue({
      object: { items: [{ id: 'a', text: 'x' }] },
      degraded: true,
    });
    expect(await phraseInsights(actor, service, [insight('a')])).toEqual({
      phrases: { a: 'x' },
      notice: AI_LEAN_NOTICE,
    });
  });

  it('falls back to the deterministic text with a notice', async () => {
    resolveLanguageModel.mockResolvedValueOnce(null);
    expect(await phraseInsights(actor, service, [insight('a')])).toEqual({
      phrases: {},
      notice: PHRASING_UNAVAILABLE,
    });

    generateStructured.mockRejectedValueOnce(new AiGatewayError('BUDGET_EXHAUSTED', 'spent'));
    expect(await phraseInsights(actor, service, [insight('a')])).toEqual({
      phrases: {},
      notice: PHRASING_BUDGET_SPENT,
    });

    generateStructured.mockRejectedValueOnce(new Error('boom'));
    expect((await phraseInsights(actor, service, [insight('a')])).notice).toBe(
      PHRASING_UNAVAILABLE
    );
  });
});

describe('insightPhrasingBrief', () => {
  it('carries ids, severity, text and facts', () => {
    expect(insightPhrasingBrief([insight('a')])).toBe(
      [
        'id: a',
        'severity: WARNING',
        'title: Title a',
        'summary: Summary a',
        'window: last 7 days',
        'fact: Alerts per day = 4',
      ].join('\n')
    );
  });
});
