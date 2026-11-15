import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { AI_LEAN_NOTICE } from '@/lib/intelligence/ai/contract';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import {
  admitAiRequest,
  getAiSpendLevel,
  getTodayUsage,
  recordAiUsage,
  reserveAiTokens,
} from '@/lib/intelligence/ai/budget';
import {
  breakers,
  invalidateGatewayCache,
  resolveGatewayPort,
} from '@/lib/intelligence/ai/gateway';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { cachedGenerate } from '@/lib/intelligence/ai/result-cache';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import { createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const now = new Date('2026-11-05T12:00:00Z');
const limits = {
  dailyTokenBudget: 1000,
  userDailyTokenBudget: 1000,
  requestsPerMinutePerUser: 1000,
  backgroundEmbeddingBudgetPercent: 20,
  spendControlsEnabled: true,
  backgroundAiBudgetPercent: 30,
};
const hold = (actorId: string, tokens: number, callSite: 'interactive' | 'proactive') =>
  reserveAiTokens(actorId, limits, tokens, 120_000, now, { callSite });

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

describe('background AI allowance', () => {
  it('admits concurrent background holds only up to its share and leaves the rest to people', async () => {
    const person = await createTestUser();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => hold('system:proactive', 100, 'proactive'))
    );
    expect(attempts.filter(Boolean)).toHaveLength(3);
    expect(await hold(person.id, 700, 'interactive')).not.toBeNull();
  });

  it('never lets background work push the day past the degradation point', async () => {
    const person = await createTestUser();
    expect(await hold(person.id, 750, 'interactive')).not.toBeNull();
    expect(await hold('system:proactive', 100, 'proactive')).toBeNull();
    expect(await hold('system:proactive', 50, 'proactive')).not.toBeNull();
  });

  it('keeps the global budget and both shares under a mixed concurrent race', async () => {
    const people = await Promise.all(Array.from({ length: 4 }, () => createTestUser()));
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        index % 2
          ? hold('system:proactive', 200, 'proactive').then(row => (row ? 'bg' : null))
          : hold(people[index % 4].id, 200, 'interactive').then(row => (row ? 'fg' : null))
      )
    );
    const background = results.filter(result => result === 'bg').length;
    const granted = results.filter(Boolean).length;
    expect(granted * 200).toBeLessThanOrEqual(1000);
    expect(background * 200).toBeLessThanOrEqual(300);
    const held = await db.aiTokenReservation.aggregate({ _sum: { tokens: true } });
    expect(held._sum.tokens).toBe(granted * 200);
  });

  it('settles background tokens from the hold and refuses background admission once the share is used', async () => {
    const reservation = await hold('system:proactive', 300, 'proactive');
    expect(reservation).not.toBeNull();
    await recordAiUsage({ inputTokens: 250, outputTokens: 50 }, now, undefined, reservation!);
    expect(await db.aiUsageDay.findUnique({ where: { day: '2026-11-05' } })).toMatchObject({
      backgroundAiTokens: 300,
    });
    expect(await admitAiRequest('system:proactive', limits, now, 'proactive')).toEqual({
      allowed: false,
      reason: 'BUDGET_EXHAUSTED',
    });
    expect(await admitAiRequest('system:proactive', limits, now, 'interactive')).toEqual({
      allowed: true,
    });
  });

  it('applies nothing new while spend controls are off', async () => {
    const off = { ...limits, spendControlsEnabled: false };
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveAiTokens('system:proactive', off, 100, 120_000, now, { callSite: 'proactive' })
      )
    );
    expect(attempts.filter(Boolean)).toHaveLength(8);
  });
});

describe('degradation at 80%', () => {
  it('degrades people, pauses background AI, and goes deterministic at the budget', async () => {
    const person = await createTestUser();
    await recordAiUsage({ inputTokens: 800, outputTokens: 0 }, now, person.id);
    expect(await admitAiRequest(person.id, limits, now, 'interactive')).toEqual({
      allowed: true,
      degraded: true,
    });
    expect(await admitAiRequest('system:proactive', limits, now, 'background')).toEqual({
      allowed: false,
      reason: 'BUDGET_EXHAUSTED',
    });
    expect(await getAiSpendLevel(limits, now)).toBe('lean');
    expect(
      await admitAiRequest(person.id, { ...limits, spendControlsEnabled: false }, now)
    ).toEqual({ allowed: true });
    await recordAiUsage({ inputTokens: 200, outputTokens: 0 }, now, person.id);
    expect(await admitAiRequest(person.id, limits, now, 'interactive')).toEqual({
      allowed: false,
      reason: 'BUDGET_EXHAUSTED',
    });
    expect(await getAiSpendLevel(limits, now)).toBe('exhausted');
    expect((await getTodayUsage(now)).inputTokens).toBe(1000);
  });

  it('degrades one person at 80% of their own share while others stay normal', async () => {
    const [heavy, light] = [await createTestUser(), await createTestUser()];
    const personal = { ...limits, dailyTokenBudget: 10_000 };
    await recordAiUsage({ inputTokens: 850, outputTokens: 0 }, now, heavy.id);
    expect(await admitAiRequest(heavy.id, personal, now, 'interactive')).toMatchObject({
      degraded: true,
    });
    expect(await admitAiRequest(light.id, personal, now, 'interactive')).toEqual({
      allowed: true,
    });
  });
});

describe('gateway routing and degradation', () => {
  let server: FakeServer;
  beforeAll(async () => {
    server = await startFakeModel();
  });
  afterAll(() => server.close());

  async function configure(budget: number, maxDataClass: 'INTERNAL' | 'PERSONAL' = 'INTERNAL') {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = { actorId: admin.id, source: 'UI' as const };
    await updateAiSettings(
      {
        enabled: true,
        squireEnabled: true,
        squireName: 'Squire',
        allowExternalFallback: false,
        requestsPerMinutePerUser: 100,
        dailyTokenBudget: budget,
        maxOutputTokens: 512,
        requestTimeoutMs: 10_000,
        spendControlsEnabled: true,
        resultCacheEnabled: true,
        expectedRevision: 0,
      },
      actor
    );
    const saved = await saveAiProvider(
      null,
      {
        name: 'OpenAI',
        kind: 'OPENAI',
        model: 'gpt-5',
        baseUrl: server.url,
        apiKey: 'sk-test-secret-key-value-1234567890',
        enabled: true,
        isExternal: false,
        maxDataClass,
        allowPrivateNetwork: true,
        priority: 10,
      },
      actor
    );
    invalidateGatewayCache();
    breakers.recordSuccess(saved.id);
    return admin;
  }

  const ask = (actorId: string, capability: 'CLASSIFY' | 'DIAGNOSE') => ({
    context: {
      actorId,
      capability,
      callSite: 'interactive' as const,
      dataClass: 'INTERNAL' as const,
      prompt: { id: 'test.prompt', version: 1, hash: 'h', guidanceRevision: 0 },
    },
    messages: [{ role: 'user' as const, content: 'hello' }],
    maxOutputTokens: 400,
  });

  it('routes cheap capabilities to the small model and conclusions to the strong one', async () => {
    const admin = await configure(1_000_000);
    const classify = await resolveGatewayPort('INTERNAL', 'CLASSIFY');
    const diagnose = await resolveGatewayPort('INTERNAL', 'DIAGNOSE');
    expect(classify?.model).toBe('gpt-5-mini');
    expect(diagnose?.model).toBe('gpt-5');
    server.script.push({ content: 'ok' });
    const result = await classify!.generate(ask(admin.id, 'CLASSIFY'));
    expect(result.served.model).toBe('gpt-5-mini');
    expect(server.requests.at(-1)?.body.model).toBe('gpt-5-mini');
  });

  it('switches to the small model with a shorter answer from 80% and does not cache it', async () => {
    const admin = await configure(10_000);
    await recordAiUsage({ inputTokens: 8_500, outputTokens: 0 }, new Date(), admin.id);
    const port = await resolveGatewayPort('INTERNAL', 'DIAGNOSE');
    expect(port?.model).toBe('gpt-5');
    server.script.push({ content: 'short answer' });
    const result = await cachedGenerate(port!, ask(admin.id, 'DIAGNOSE'));
    expect(result).toMatchObject({ degraded: true, served: { model: 'gpt-5-mini' } });
    const body = server.requests.at(-1)?.body ?? {};
    expect(body.model).toBe('gpt-5-mini');
    expect(Number(body.max_completion_tokens ?? body.max_tokens)).toBe(200);
    expect(await db.aiResultCache.count()).toBe(0);
  });

  async function squire(userId: string) {
    const actor = await resolveUserActor(userId);
    const events: SquireEvent[] = [];
    for await (const event of streamSquire(actor!, { message: 'what is going on?', history: [] }))
      events.push(event);
    return events;
  }

  it('tells the person in Squire when an answer was degraded, and goes basic at the budget', async () => {
    const admin = await configure(1_000_000, 'PERSONAL');
    const ctx = { actorId: admin.id, source: 'UI' as const };
    await publishPolicyVersion(
      {},
      { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      ctx
    );
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    // Spent by others, so only the shared day (not this person's share) is near the budget.
    const day = new Date().toISOString().slice(0, 10);
    await db.aiUsageDay.create({ data: { day, inputTokens: 850_000 } });
    server.script.push({ content: 'All quiet.' });
    const lean = await squire(admin.id);
    expect(lean).toContainEqual({ type: 'notice', text: AI_LEAN_NOTICE });
    expect(lean.find(event => event.type === 'meta')).toMatchObject({ mode: 'ai' });

    await db.aiUsageDay.update({ where: { day }, data: { inputTokens: 1_000_000 } });
    const spent = await squire(admin.id);
    // The basic answer's own header follows the AI attempt's.
    expect(spent.filter(event => event.type === 'meta').at(-1)).toMatchObject({
      mode: 'basic',
      availability: 'quota',
      limit: 'budget',
    });
    expect(spent).not.toContainEqual({ type: 'notice', text: AI_LEAN_NOTICE });
  });
});
