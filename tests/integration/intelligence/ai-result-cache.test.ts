import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { utcDay } from '@/lib/intelligence/ai/budget';
import { deterministicOnly } from '@/lib/intelligence/ai/call-site';
import {
  getSpendBreakdown,
  invalidatePriceCache,
  saveModelPrice,
} from '@/lib/intelligence/ai/cost';
import {
  breakers,
  invalidateGatewayCache,
  resolveGatewayPort,
} from '@/lib/intelligence/ai/gateway';
import type { AiGenerateRequest, LanguageModelPort } from '@/lib/intelligence/ai/port';
import {
  cachedGenerate,
  purgeExpiredAiResults,
  withResultCache,
} from '@/lib/intelligence/ai/result-cache';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { summarizeIncident } from '@/lib/intelligence/drafts/service';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import {
  CONTEXT_SUMMARY_PROMPT,
  summarizeOlderTurns,
} from '@/lib/intelligence/squire/context-summary';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

let model: FakeServer;
beforeAll(async () => {
  model = await startFakeModel();
});
afterAll(async () => {
  await model.close();
});
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  model.requests.length = 0;
  model.script.length = 0;
  invalidateGatewayCache();
  invalidatePriceCache();
});

const PROMPT = { id: 'test.prompt', version: 1 };

async function setup(options: { cache?: boolean } = {}) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const ctx = { actorId: admin.id, source: 'UI' as const };
  await updateAiSettings(
    {
      enabled: true,
      squireEnabled: true,
      squireName: 'Squire',
      allowExternalFallback: false,
      requestsPerMinutePerUser: 100,
      dailyTokenBudget: 500_000,
      maxOutputTokens: 1024,
      requestTimeoutMs: 10_000,
      ...(options.cache === false ? {} : { resultCacheEnabled: true }),
      expectedRevision: 0,
    },
    ctx
  );
  const provider = await saveAiProvider(
    null,
    {
      name: 'Local',
      kind: 'OPENAI_COMPATIBLE',
      model: 'm',
      baseUrl: model.url,
      apiKey: 'k',
      enabled: true,
      isExternal: false,
      maxDataClass: 'PERSONAL',
      allowPrivateNetwork: true,
      priority: 1,
    },
    ctx
  );
  await saveModelPrice(
    { providerKind: 'OPENAI_COMPATIBLE', model: 'm', inputUsdPerMTok: 1, outputUsdPerMTok: 2 },
    ctx
  );
  breakers.recordSuccess(provider.id);
  invalidateGatewayCache();
  const port = (await resolveGatewayPort('PERSONAL'))!;
  return { admin, ctx, port };
}

const request = (actorId: string, extra: Partial<AiGenerateRequest['context']> = {}) =>
  ({
    context: {
      actorId,
      capability: 'SUMMARIZE',
      callSite: 'interactive',
      dataClass: 'INTERNAL',
      ...extra,
    },
    messages: [
      { role: 'system', content: 'Summarise.' },
      { role: 'user', content: 'Disk is full on db-1.' },
    ],
  }) satisfies AiGenerateRequest;

/** A port that answers from a queue, for results the fake HTTP model cannot express. */
function stubPort(
  results: Array<Partial<Awaited<ReturnType<LanguageModelPort['generate']>>> | Error>
) {
  let calls = 0;
  const port: LanguageModelPort = {
    model: 'stub',
    generate: async () => {
      calls += 1;
      const next = results.shift();
      if (!next || next instanceof Error) throw next ?? new Error('no scripted result');
      return {
        text: 'answer',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
        served: { providerId: 'stub', model: 'stub', fallbackDepth: 0 },
        finishReason: 'stop',
        ...next,
      };
    },
    generateStructured: async () => {
      throw new Error('not used');
    },
    stream: async function* () {
      throw new Error('not used');
    },
  };
  return { port, calls: () => calls };
}

describe('result cache', () => {
  it('serves a repeat from the cache for zero tokens and records the hit in usage', async () => {
    const { admin, port } = await setup();
    model.script.push({ content: 'The disk filled up.', usage: [100, 20] });

    const first = await cachedGenerate(port, request(admin.id), { prompt: PROMPT });
    expect(first).toMatchObject({ text: 'The disk filled up.' });
    expect(first.cached).toBeUndefined();
    const second = await cachedGenerate(port, request(admin.id), { prompt: PROMPT });
    expect(second).toMatchObject({
      text: 'The disk filled up.',
      cached: true,
      usage: { inputTokens: 0, outputTokens: 0 },
      served: { providerId: 'result-cache', model: 'm' },
    });
    expect(model.requests).toHaveLength(1);

    // The day's usage holds only the one real call; the hit adds no request, tokens or dollars.
    const usage = await db.aiUsageDay.findUniqueOrThrow({ where: { day: utcDay() } });
    expect(usage).toMatchObject({ requests: 1, inputTokens: 100, outputTokens: 20 });
    expect(Number(usage.costMicros)).toBe(140);
    const [row] = await db.aiUsageBreakdownDay.findMany();
    expect(row).toMatchObject({
      requests: 1,
      inputTokens: 100,
      outputTokens: 20,
      resultCacheHits: 1,
      savedTokens: 120,
    });
    expect(Number(row.costMicros)).toBe(140);
    expect(Number(row.savedCostMicros)).toBe(140);

    const stored = await db.aiResultCache.findFirstOrThrow();
    expect(stored).toMatchObject({ hits: 1, inputTokens: 100, outputTokens: 20, model: 'm' });
    expect(stored.outputEncrypted).not.toContain('disk');

    const spend = await getSpendBreakdown(7);
    expect(spend.total).toMatchObject({
      requests: 1,
      cacheHits: 1,
      savedMicros: 140,
      savedTokens: 120,
    });
    expect(spend.byCapability[0]).toMatchObject({
      key: 'SUMMARIZE',
      cacheHits: 1,
      savedMicros: 140,
    });
  });

  it('misses when the input or the prompt version changes', async () => {
    const { admin, port } = await setup();
    model.script.push({ content: 'one' }, { content: 'two' }, { content: 'three' });
    await cachedGenerate(port, request(admin.id), { prompt: PROMPT });
    const changed = request(admin.id);
    changed.messages[1].content = 'Disk is full on db-2.';
    expect((await cachedGenerate(port, changed, { prompt: PROMPT })).text).toBe('two');
    const bumped = await cachedGenerate(port, request(admin.id), {
      prompt: { ...PROMPT, version: 2 },
    });
    expect(bumped).toMatchObject({ text: 'three' });
    expect(bumped.cached).toBeUndefined();
    expect(model.requests).toHaveLength(3);
    // The old version's answer is still there for old readers; the new version has its own.
    expect(await db.aiResultCache.count()).toBe(3);
  });

  it('never serves an answer across teams, data classes or caller scopes', async () => {
    const { admin, port } = await setup();
    const [teamA, teamB] = [await createTestTeam('A'), await createTestTeam('B')];
    const service = await createTestService('svc');
    const a = await createTestIncident('Same title', service.id, { teamId: teamA.id });
    const b = await createTestIncident('Same title', service.id, { teamId: teamB.id });
    model.script.push(
      { content: 'for A' },
      { content: 'for B' },
      { content: 'personal' },
      { content: 'for someone else' }
    );

    await cachedGenerate(port, request(admin.id, { incidentId: a.id }), { prompt: PROMPT });
    const otherTeam = await cachedGenerate(port, request(admin.id, { incidentId: b.id }), {
      prompt: PROMPT,
    });
    expect(otherTeam).toMatchObject({ text: 'for B' });
    const personal = request(admin.id, { incidentId: a.id, dataClass: 'PERSONAL' });
    expect((await cachedGenerate(port, personal, { prompt: PROMPT })).text).toBe('personal');
    const scoped = await cachedGenerate(port, request(admin.id, { incidentId: a.id }), {
      prompt: PROMPT,
      scope: 'user:someone-else',
    });
    expect(scoped.text).toBe('for someone else');
    expect(model.requests).toHaveLength(4);

    // Each scope hits only its own entry afterwards.
    const again = await cachedGenerate(port, request(admin.id, { incidentId: a.id }), {
      prompt: PROMPT,
    });
    expect(again).toMatchObject({ text: 'for A', cached: true });
    expect(model.requests).toHaveLength(4);
  });

  it('never stores a failed, refused, cut-off or empty result', async () => {
    const { admin, port } = await setup();
    // Two failures: the SDK retries once before the gateway gives up.
    model.script.push({ status: 500 }, { status: 500 });
    await expect(cachedGenerate(port, request(admin.id), { prompt: PROMPT })).rejects.toThrow();
    model.script.push({ content: 'I cannot help with that.', finishReason: 'content_filter' });
    const refused = await cachedGenerate(port, request(admin.id), { prompt: PROMPT });
    expect(refused.finishReason).toBe('content-filter');
    expect(await db.aiResultCache.count()).toBe(0);

    const stub = stubPort([
      new Error('provider down'),
      { finishReason: 'length' },
      { text: '   ' },
      { text: 'good' },
    ]);
    const ask = () => cachedGenerate(stub.port, request(admin.id), { prompt: PROMPT });
    await expect(ask()).rejects.toThrow('provider down');
    await ask();
    await ask();
    expect(await db.aiResultCache.count()).toBe(0);
    expect((await ask()).text).toBe('good');
    expect(await ask()).toMatchObject({ text: 'good', cached: true });
    expect(stub.calls()).toBe(4);
  });

  it('is off by default: every request reaches the model and nothing is stored', async () => {
    const { admin, port } = await setup({ cache: false });
    model.script.push({ content: 'one' }, { content: 'two' });
    await cachedGenerate(port, request(admin.id), { prompt: PROMPT });
    expect((await cachedGenerate(port, request(admin.id), { prompt: PROMPT })).text).toBe('two');
    expect(model.requests).toHaveLength(2);
    expect(await db.aiResultCache.count()).toBe(0);
  });

  it('does not serve an expired answer, and the retention sweep removes it in batches', async () => {
    const { admin, port } = await setup();
    model.script.push({ content: 'old' }, { content: 'fresh' });
    await cachedGenerate(port, request(admin.id), { prompt: PROMPT });
    await db.aiResultCache.updateMany({ data: { expiresAt: new Date(Date.now() - 1_000) } });
    const after = await cachedGenerate(port, request(admin.id), { prompt: PROMPT });
    expect(after).toMatchObject({ text: 'fresh' });
    expect(after.cached).toBeUndefined();
    // The live answer replaced the expired entry and is served again.
    expect(await cachedGenerate(port, request(admin.id), { prompt: PROMPT })).toMatchObject({
      text: 'fresh',
      cached: true,
    });

    await db.aiResultCache.createMany({
      data: [1, 2, 3].map(index => ({
        capability: 'SUMMARIZE',
        promptId: 'p',
        promptVersion: 1,
        model: 'm',
        scopeKey: 's',
        inputHash: `h${index}`,
        outputEncrypted: 'x',
        providerKind: 'OPENAI_COMPATIBLE',
        servedModel: 'm',
        expiresAt: new Date(Date.now() - index * 1_000),
      })),
    });
    expect(await purgeExpiredAiResults(db, { limit: 2 })).toBe(2);
    expect(await purgeExpiredAiResults(db, { limit: 2 })).toBe(1);
    expect(await db.aiResultCache.count()).toBe(1);
  });

  it('answers a repeated incident summary without a second model call', async () => {
    const { admin, ctx } = await setup();
    await publishPolicyVersion(
      {},
      { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      ctx
    );
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    const service = await createTestService('Checkout');
    const incident = await createTestIncident('Checkout 5xx spike', service.id);
    const actor = (await resolveUserActor(admin.id))!;
    const summary = {
      headline: 'Checkout errors',
      currentState: 'Open.',
      impact: 'Some checkouts fail.',
      keyEvents: ['Alert fired'],
      possibleCauses: ['Unknown'],
      nextSteps: ['Check the error rate'],
    };
    model.script.push({ content: JSON.stringify(summary), usage: [300, 80] });

    const first = await summarizeIncident(actor, incident.id);
    const second = await summarizeIncident(actor, incident.id);
    expect(first).toMatchObject({ ok: true, value: summary });
    expect(second).toMatchObject({ ok: true, value: summary, model: 'm' });
    expect(model.requests).toHaveLength(1);
    expect(await db.aiUsageDay.findUniqueOrThrow({ where: { day: utcDay() } })).toMatchObject({
      requests: 1,
      inputTokens: 300,
      outputTokens: 80,
    });

    // New facts are a new input: the summary is generated again.
    await db.incidentNote.create({
      data: { incidentId: incident.id, userId: admin.id, content: 'Rolled back the deploy.' },
    });
    model.script.push({ content: JSON.stringify(summary) });
    await summarizeIncident(actor, incident.id);
    expect(model.requests).toHaveLength(2);
  });

  it('caches the conversation summary when its resolver wraps the port', async () => {
    const { admin, port } = await setup();
    model.script.push({ content: '- asked about the disk' });
    const turns = [
      { role: 'user' as const, content: 'Why is the disk full?', dataClass: 'PERSONAL' as const },
      { role: 'assistant' as const, content: 'Logs grew.', dataClass: 'PERSONAL' as const },
    ];
    const resolve = async () =>
      withResultCache(port, { prompt: CONTEXT_SUMMARY_PROMPT, scope: `user:${admin.id}` });
    const first = await summarizeOlderTurns(turns, { actorId: admin.id, resolve });
    const second = await summarizeOlderTurns(turns, { actorId: admin.id, resolve });
    expect(first?.content).toContain('asked about the disk');
    expect(second?.content).toBe(first?.content);
    expect(model.requests).toHaveLength(1);
  });
});

describe('deterministic-first gate', () => {
  it('refuses an untagged call before admission, without reaching the model', async () => {
    const { admin, port } = await setup();
    const untagged = request(admin.id);
    delete (untagged.context as { callSite?: string }).callSite;
    await expect(port.generate(untagged)).rejects.toMatchObject({ code: 'CALL_SITE_REFUSED' });
    const events = [];
    for await (const event of port.stream(untagged)) events.push(event);
    expect(events).toEqual([expect.objectContaining({ type: 'error', retryable: false })]);
    expect(model.requests).toHaveLength(0);
    expect(await db.aiTokenReservation.count()).toBe(0);
  });

  it('refuses any call made while a list view or badge renders, even with a warm cache', async () => {
    const { admin, port } = await setup();
    model.script.push({ content: 'warm' });
    await cachedGenerate(port, request(admin.id), { prompt: PROMPT });
    await expect(
      deterministicOnly('incident list badges', () => port.generate(request(admin.id)))
    ).rejects.toMatchObject({ code: 'CALL_SITE_REFUSED' });
    await expect(
      deterministicOnly('incident list badges', () =>
        cachedGenerate(port, request(admin.id), { prompt: PROMPT })
      )
    ).rejects.toMatchObject({ code: 'CALL_SITE_REFUSED' });
    expect(model.requests).toHaveLength(1);
    // Outside the zone the same request is served normally.
    expect(await cachedGenerate(port, request(admin.id), { prompt: PROMPT })).toMatchObject({
      cached: true,
    });
  });
});

describe('provider prompt-cache accounting', () => {
  it('records cache-read tokens the provider reports', async () => {
    const { admin, port } = await setup();
    model.script.push({ content: 'ok', usage: [100, 20], cachedTokens: 80 });
    const result = await port.generate(request(admin.id));
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 80 });
    const [row] = await db.aiUsageBreakdownDay.findMany();
    expect(row).toMatchObject({ inputTokens: 100, cacheReadTokens: 80, cacheWriteTokens: 0 });
    // This family has no known cache discount, so cached tokens are charged at the full input rate.
    expect(Number(row.costMicros)).toBe(140);
    expect(Number(row.savedCostMicros)).toBe(0);
    expect((await getSpendBreakdown(7)).total).toMatchObject({
      cacheReadTokens: 80,
      savedMicros: 0,
    });
  });
});
