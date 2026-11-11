import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordAiUsage, reserveAiTokens } from '@/lib/intelligence/ai/budget';
import {
  attributeTeam,
  deleteBudget,
  deleteModelPrice,
  getBudgetStatuses,
  getSpendBreakdown,
  invalidatePriceCache,
  listBudgets,
  priceForModel,
  saveBudget,
  saveModelPrice,
} from '@/lib/intelligence/ai/cost';
import { collectCostMetrics } from '@/lib/intelligence/ai/cost-metrics';
import {
  breakers,
  invalidateGatewayCache,
  resolveGatewayPort,
} from '@/lib/intelligence/ai/gateway';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import {
  clearRuntimeOperationalMetrics,
  runtimeOperationalMetrics,
} from '@/lib/metrics/operational/registry';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const now = new Date('2026-11-05T12:00:00Z');
const day = '2026-11-05';
const big = { dailyTokenBudget: 10_000_000 };
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
  invalidateGatewayCache();
  invalidatePriceCache();
  clearRuntimeOperationalMetrics();
  model.requests.length = 0;
  model.script.length = 0;
  breakers.recordSuccess('p');
});

async function admin() {
  const user = await createTestUser({ role: 'ADMIN' });
  return { user, actor: { actorId: user.id, source: 'UI' as const } };
}

const rejections = (scope: string) =>
  runtimeOperationalMetrics()
    .get('opsknight_intelligence_ai_budget_rejections_total')
    ?.find(row => row.labels.scope === scope)?.value ?? 0;

describe('team and capability budgets in reservations', () => {
  it('enforces a team token budget per team and counts the rejection', async () => {
    const { actor } = await admin();
    const [red, blue] = [await createTestTeam('red'), await createTestTeam('blue')];
    await saveBudget(
      {
        scope: 'TEAM',
        teamId: red.id,
        dailyTokenLimit: 1000,
        dailyCostLimitUsd: null,
        enabled: true,
        expectedRevision: 0,
      },
      actor
    );
    const person = await createTestUser();
    const hold = (teamId: string, tokens: number) =>
      reserveAiTokens(person.id, big, tokens, 120_000, now, { teamId, capability: 'SQUIRE_CHAT' });
    expect(await hold(red.id, 600)).not.toBeNull();
    expect(await hold(red.id, 500)).toBeNull();
    expect(rejections('team')).toBe(1);
    expect(await hold(blue.id, 500)).not.toBeNull();
    expect(await hold(red.id, 400)).not.toBeNull();
    // A call without attribution is not charged to any team.
    expect(await reserveAiTokens(person.id, big, 5000, 120_000, now)).not.toBeNull();
  });

  it('serialises concurrent holds against a capability budget', async () => {
    const { actor } = await admin();
    await saveBudget(
      {
        scope: 'CAPABILITY',
        capability: 'DIAGNOSE',
        dailyTokenLimit: 1000,
        dailyCostLimitUsd: null,
        enabled: true,
        expectedRevision: 0,
      },
      actor
    );
    const person = await createTestUser();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        reserveAiTokens(person.id, big, 200, 120_000, now, { capability: 'DIAGNOSE' })
      )
    );
    expect(attempts.filter(Boolean)).toHaveLength(5);
    expect(rejections('capability')).toBe(3);
    // Other capabilities are unaffected.
    expect(
      await reserveAiTokens(person.id, big, 900, 120_000, now, { capability: 'SQUIRE_CHAT' })
    ).not.toBeNull();
  });

  it('enforces a dollar limit on priced calls, lets unpriced ones through, and counts settled spend', async () => {
    const { actor } = await admin();
    const team = await createTestTeam('cost');
    await saveBudget(
      {
        scope: 'TEAM',
        teamId: team.id,
        dailyTokenLimit: null,
        dailyCostLimitUsd: 0.001, // 1000 micros
        enabled: true,
        expectedRevision: 0,
      },
      actor
    );
    const person = await createTestUser();
    const scope = (costMicros: number | null) => ({
      teamId: team.id,
      capability: 'SQUIRE_CHAT',
      costMicros,
    });
    const first = await reserveAiTokens(person.id, big, 10, 120_000, now, scope(600));
    expect(first).not.toBeNull();
    expect(await reserveAiTokens(person.id, big, 10, 120_000, now, scope(500))).toBeNull();
    expect(await reserveAiTokens(person.id, big, 10, 120_000, now, scope(null))).not.toBeNull();
    // Settle the first hold at its real (higher) cost: the settled breakdown now carries the spend.
    await recordAiUsage({ inputTokens: 10, outputTokens: 0 }, now, person.id, first!, {
      providerKind: 'OPENAI',
      model: 'gpt-4o',
      capability: 'SQUIRE_CHAT',
      teamId: team.id,
      costMicros: 950,
    });
    expect(await reserveAiTokens(person.id, big, 10, 120_000, now, scope(100))).toBeNull();
    expect(await reserveAiTokens(person.id, big, 10, 120_000, now, scope(40))).not.toBeNull();
  });

  it('ignores disabled budgets and fails closed when the budget read fails', async () => {
    const { actor } = await admin();
    await saveBudget(
      {
        scope: 'CAPABILITY',
        capability: 'SUMMARIZE',
        dailyTokenLimit: 1,
        dailyCostLimitUsd: null,
        enabled: false,
        expectedRevision: 0,
      },
      actor
    );
    const person = await createTestUser();
    expect(
      await reserveAiTokens(person.id, big, 500, 120_000, now, { capability: 'SUMMARIZE' })
    ).not.toBeNull();
    await db.$executeRawUnsafe('ALTER TABLE "AiBudget" RENAME TO "AiBudgetMoved"');
    try {
      await expect(
        reserveAiTokens(person.id, big, 1, 120_000, now, { capability: 'SUMMARIZE' })
      ).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "AiBudgetMoved" RENAME TO "AiBudget"');
    }
  });
});

describe('dollar accounting', () => {
  it('records cost alongside tokens on the day, the person and the breakdown, once', async () => {
    const person = await createTestUser();
    const team = await createTestTeam('acct');
    const hold = await reserveAiTokens(person.id, big, 100, 120_000, now, {
      teamId: team.id,
      capability: 'DIAGNOSE',
      costMicros: 300,
    });
    const attribution = {
      providerKind: 'ANTHROPIC',
      model: 'claude-sonnet-4-6',
      capability: 'SQUIRE_CHAT',
      teamId: null,
      costMicros: 345,
    };
    await recordAiUsage({ inputTokens: 40, outputTokens: 20 }, now, person.id, hold!, attribution);
    await recordAiUsage({ inputTokens: 40, outputTokens: 20 }, now, person.id, hold!, attribution);
    await recordAiUsage({ inputTokens: 5, outputTokens: 0 }, now, person.id, undefined, {
      ...attribution,
      costMicros: null,
    });
    const usage = await db.aiUsageDay.findUniqueOrThrow({ where: { day } });
    expect(Number(usage.costMicros)).toBe(345);
    const personal = await db.aiUsageUserDay.findUniqueOrThrow({
      where: { day_userId: { day, userId: person.id } },
    });
    expect(Number(personal.costMicros)).toBe(345);
    const rows = await db.aiUsageBreakdownDay.findMany({ orderBy: { teamId: 'asc' } });
    // The hold's attribution (team, DIAGNOSE) wins over the settlement's.
    expect(
      rows.map(row => [
        row.teamId,
        row.capability,
        row.requests,
        Number(row.costMicros),
        row.unpricedRequests,
      ])
    ).toEqual([
      ['', 'SQUIRE_CHAT', 1, 0, 1],
      [team.id, 'DIAGNOSE', 1, 345, 0],
    ]);
  });

  it('leaves cost columns empty for usage recorded without attribution', async () => {
    await recordAiUsage({ inputTokens: 10, outputTokens: 5 }, now);
    const usage = await db.aiUsageDay.findUniqueOrThrow({ where: { day } });
    expect(usage.costMicros).toBeNull();
    expect(await db.aiUsageBreakdownDay.count()).toBe(0);
  });
});

describe('gateway attribution', () => {
  async function configure() {
    const { user, actor } = await admin();
    await updateAiSettings(
      {
        enabled: true,
        squireEnabled: true,
        squireName: 'Squire',
        allowExternalFallback: false,
        requestsPerMinutePerUser: 50,
        dailyTokenBudget: 500_000,
        maxOutputTokens: 256,
        requestTimeoutMs: 10_000,
        expectedRevision: 0,
      },
      actor
    );
    await saveAiProvider(
      null,
      {
        name: 'Local',
        kind: 'OPENAI_COMPATIBLE',
        model: 'test-model',
        baseUrl: model.url,
        apiKey: 'sk-test-secret-key-value-1234567890',
        enabled: true,
        isExternal: false,
        maxDataClass: 'INTERNAL',
        allowPrivateNetwork: true,
        priority: 10,
      },
      actor
    );
    invalidateGatewayCache();
    return { user, actor };
  }

  it('prices a call with an override and charges the incident team and capability', async () => {
    const { user, actor } = await configure();
    expect(await priceForModel('OPENAI_COMPATIBLE', 'test-model')).toBeNull();
    await saveModelPrice(
      {
        providerKind: 'OPENAI_COMPATIBLE',
        model: 'test-model',
        inputUsdPerMTok: 1,
        outputUsdPerMTok: 2,
      },
      actor
    );
    expect(await priceForModel('OPENAI_COMPATIBLE', 'test-model')).toMatchObject({
      source: 'override',
    });
    const team = await createTestTeam('owners');
    const service = await createTestService('svc', team.id);
    const incident = await createTestIncident('Disk full', service.id, { teamId: team.id });
    expect(await attributeTeam(user.id, incident.id)).toBe(team.id);
    const port = await resolveGatewayPort('INTERNAL');
    model.script.push({ content: 'ok', usage: [11, 7] });
    await port!.generate({
      context: {
        actorId: user.id,
        capability: 'DIAGNOSE',
        callSite: 'interactive',
        dataClass: 'INTERNAL',
        incidentId: incident.id,
      },
      messages: [{ role: 'user', content: 'why?' }],
    });
    const [row] = await db.aiUsageBreakdownDay.findMany();
    expect(row).toMatchObject({
      teamId: team.id,
      capability: 'DIAGNOSE',
      providerKind: 'OPENAI_COMPATIBLE',
      model: 'test-model',
      requests: 1,
      inputTokens: 11,
      outputTokens: 7,
      unpricedRequests: 0,
    });
    expect(Number(row.costMicros)).toBe(11 * 1 + 7 * 2);
    const audit = JSON.stringify(await db.auditLog.findMany());
    expect(audit).toContain('intelligence.ai.price.updated');
    expect(await deleteModelPrice('OPENAI_COMPATIBLE', 'test-model', actor)).toBe(true);
    expect(await priceForModel('OPENAI_COMPATIBLE', 'test-model')).toBeNull();
  });

  it('refuses a request over a capability budget before calling the provider', async () => {
    const { user, actor } = await configure();
    await saveBudget(
      {
        scope: 'CAPABILITY',
        capability: 'SUMMARIZE',
        dailyTokenLimit: 5,
        dailyCostLimitUsd: null,
        enabled: true,
        expectedRevision: 0,
      },
      actor
    );
    const port = await resolveGatewayPort('INTERNAL');
    await expect(
      port!.generate({
        context: {
          actorId: user.id,
          capability: 'SUMMARIZE',
          callSite: 'interactive',
          dataClass: 'INTERNAL',
        },
        messages: [{ role: 'user', content: 'summarise this incident please' }],
      })
    ).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(model.requests).toHaveLength(0);
    // Chat is a different capability and still works.
    model.script.push({ content: 'hi' });
    await expect(
      port!.generate({
        context: {
          actorId: user.id,
          capability: 'SQUIRE_CHAT',
          callSite: 'interactive',
          dataClass: 'INTERNAL',
        },
        messages: [{ role: 'user', content: 'hello' }],
      })
    ).resolves.toMatchObject({ text: 'hi' });
  });
});

describe('budget administration, read models and metrics', () => {
  it('uses a revision compare-and-set, validates input and audits changes', async () => {
    const { actor } = await admin();
    const team = await createTestTeam('admin');
    const input = {
      scope: 'TEAM',
      teamId: team.id,
      dailyTokenLimit: 100,
      dailyCostLimitUsd: 2.5,
      enabled: true,
      expectedRevision: 0,
    };
    const saved = await saveBudget(input, actor);
    expect(saved).toMatchObject({ revision: 1, dailyCostLimitMicros: 2_500_000 });
    await expect(saveBudget(input, actor)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await saveBudget({ ...input, dailyTokenLimit: 200, expectedRevision: 1 }, actor);
    await expect(
      saveBudget(
        { ...input, dailyTokenLimit: null, dailyCostLimitUsd: null, expectedRevision: 2 },
        actor
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      saveBudget({ ...input, teamId: 'missing-team', expectedRevision: 0 }, actor)
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      saveBudget({ ...input, scope: 'CAPABILITY', teamId: undefined, capability: 'NOPE' }, actor)
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const [listed] = await listBudgets();
    expect(listed).toMatchObject({ label: team.name, dailyTokenLimit: 200, revision: 2 });
    await expect(deleteBudget(listed.id, 1, actor)).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    expect(await deleteBudget(listed.id, 2, actor)).toBe(true);
    const actions = (await db.auditLog.findMany()).map(entry => entry.action);
    expect(actions.filter(action => action === 'intelligence.ai.budget.updated')).toHaveLength(2);
    expect(actions).toContain('intelligence.ai.budget.deleted');
  });

  it('reports spend by team, capability and model, and budget utilisation as bounded metrics', async () => {
    const { actor } = await admin();
    const [red, blue] = [await createTestTeam('red'), await createTestTeam('blue')];
    const person = await createTestUser();
    const settle = async (
      teamId: string | null,
      capability: string,
      modelName: string,
      tokens: number,
      costMicros: number | null,
      at = now
    ) =>
      recordAiUsage({ inputTokens: tokens, outputTokens: 0 }, at, person.id, undefined, {
        providerKind: 'OPENAI',
        model: modelName,
        capability,
        teamId,
        costMicros,
      });
    await settle(red.id, 'SQUIRE_CHAT', 'gpt-4o', 800, 2_000_000);
    await settle(blue.id, 'DIAGNOSE', 'gpt-4o-mini', 100, 100_000);
    await settle(null, 'EMBED', 'text-embedding-3-small', 50, null);
    await settle(red.id, 'SQUIRE_CHAT', 'gpt-4o', 999, 9_000_000, new Date('2026-10-01T00:00:00Z'));
    await saveBudget(
      {
        scope: 'TEAM',
        teamId: red.id,
        dailyTokenLimit: 1000,
        dailyCostLimitUsd: null,
        enabled: true,
        expectedRevision: 0,
      },
      actor
    );
    await saveBudget(
      {
        scope: 'TEAM',
        teamId: blue.id,
        dailyTokenLimit: null,
        dailyCostLimitUsd: 0.1,
        enabled: true,
        expectedRevision: 0,
      },
      actor
    );
    await saveBudget(
      {
        scope: 'CAPABILITY',
        capability: 'DIAGNOSE',
        dailyTokenLimit: 1000,
        dailyCostLimitUsd: null,
        enabled: true,
        expectedRevision: 0,
      },
      actor
    );

    const week = await getSpendBreakdown(7, now);
    expect(week.daily).toHaveLength(7);
    expect(week.to).toBe(day);
    expect(week.total).toEqual({
      requests: 3,
      tokens: 950,
      costMicros: 2_100_000,
      unpricedRequests: 1,
      cacheHits: 0,
      savedMicros: 0,
      cacheReadTokens: 0,
      savedTokens: 0,
    });
    expect(week.byTeam.map(slice => [slice.label, slice.costMicros])).toEqual([
      [red.name, 2_000_000],
      [blue.name, 100_000],
      ['No team', 0],
    ]);
    expect(week.byCapability[0]).toMatchObject({ key: 'SQUIRE_CHAT', tokens: 800 });
    expect(week.byModel.map(slice => slice.label)).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
      'text-embedding-3-small',
    ]);
    expect((await getSpendBreakdown(30, now)).total.requests).toBe(3);
    expect((await getSpendBreakdown(30, new Date('2026-10-20T00:00:00Z'))).total.costMicros).toBe(
      9_000_000
    );

    const statuses = await getBudgetStatuses(10_000, now);
    const byKey = Object.fromEntries(statuses.map(status => [status.key, status.utilization]));
    expect(byKey[`team:${red.id}`]).toBeCloseTo(0.8);
    expect(byKey[`team:${blue.id}`]).toBeCloseTo(1);
    expect(byKey['capability:DIAGNOSE']).toBeCloseTo(0.1);
    expect(byKey.global).toBeCloseTo(950 / 10_000);

    const samples = await collectCostMetrics(now);
    const value = (name: string, labels: Record<string, string> = {}) =>
      samples.find(
        sample =>
          sample.name === name &&
          Object.entries(labels).every(
            ([key, wanted]) => sample.labels?.[key as 'scope'] === wanted
          )
      )?.value;
    expect(value('opsknight_intelligence_ai_spend_today_usd')).toBeCloseTo(2.1);
    expect(
      value('opsknight_intelligence_ai_budget_utilization_max_ratio', { scope: 'team' })
    ).toBeCloseTo(1);
    expect(
      value('opsknight_intelligence_ai_budgets_over_threshold', { scope: 'team', threshold: '0.8' })
    ).toBe(2);
    expect(
      value('opsknight_intelligence_ai_budgets_over_threshold', { scope: 'team', threshold: '1' })
    ).toBe(1);
    expect(
      value('opsknight_intelligence_ai_budgets_over_threshold', {
        scope: 'capability',
        threshold: '0.8',
      })
    ).toBe(0);
    // Labels are bounded: no team id or budget key ever appears.
    expect(JSON.stringify(samples)).not.toContain(red.id);
  });
});
