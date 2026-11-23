import { beforeEach, describe, expect, it, vi } from 'vitest';

const budget = vi.hoisted(() => ({ admit: vi.fn(), reserve: vi.fn(), record: vi.fn() }));
vi.mock('@/lib/intelligence/ai/budget', () => ({
  admitAiRequest: budget.admit,
  reserveAiTokens: budget.reserve,
  recordAiUsage: budget.record,
  estimateTokens: (text: string) => Math.ceil(text.length / 4),
  CACHE_READ_BUDGET_WEIGHT: 0.1,
}));
vi.mock('@/lib/intelligence/ai/cost', () => ({
  attributeTeam: async () => null,
  priceForModel: async () => null,
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => undefined) }));
const settings = vi.hoisted(() => ({
  enabled: true,
  allowExternalFallback: false,
  allowedDataRegions: [],
  requestTimeoutMs: 1_000,
  maxOutputTokens: 500,
  requestsPerMinutePerUser: 10,
  dailyTokenBudget: 1_000_000,
  spendControlsEnabled: false,
  capabilityRouting: {},
}));
vi.mock('@/lib/intelligence/ai/settings', () => ({
  getAiSettings: async () => settings,
  loadProvidersForGateway: async () => [
    {
      id: 'p1',
      kind: 'OPENAI',
      model: 'gpt-5',
      enabled: true,
      maxDataClass: 'PERSONAL',
      priority: 0,
      isExternal: true,
      credentials: { type: 'apiKey', apiKey: 'k' },
      options: {},
    },
  ],
}));

import { resolveGatewayPort } from '@/lib/intelligence/ai/gateway';
import type { AiStreamEvent } from '@/lib/intelligence/ai/port';

const request = {
  context: {
    actorId: 'u1',
    capability: 'SQUIRE_CHAT' as const,
    callSite: 'interactive' as const,
    dataClass: 'PERSONAL' as const,
  },
  messages: [{ role: 'user' as const, content: 'hi', dataClass: 'PERSONAL' as const }],
};

async function streamed() {
  const port = await resolveGatewayPort('PERSONAL');
  const events: AiStreamEvent[] = [];
  for await (const event of port!.stream(request)) events.push(event);
  return events;
}

beforeEach(() => {
  budget.admit.mockReset().mockResolvedValue({ allowed: true });
  budget.reserve.mockReset();
  budget.record.mockReset().mockResolvedValue(undefined);
});

describe('budget error mapping', () => {
  it('says the budget is reached only when the hold is refused', async () => {
    budget.reserve.mockResolvedValue(null);
    expect(await streamed()).toEqual([
      { type: 'error', message: 'Daily AI budget reached', retryable: false },
    ]);
  });

  it('reports a failing budget store as a temporary outage, not a spent budget', async () => {
    budget.reserve.mockRejectedValue(new Error('could not obtain lock'));
    expect(await streamed()).toEqual([
      { type: 'error', message: 'AI is temporarily unavailable', retryable: true },
    ]);
    budget.admit.mockRejectedValue(new Error('rate-limit table down'));
    expect(await streamed()).toEqual([
      { type: 'error', message: 'AI is temporarily unavailable', retryable: true },
    ]);
  });
});
