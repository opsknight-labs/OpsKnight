import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';

const ai = vi.hoisted(() => ({ enabled: false, calls: [] as unknown[] }));
vi.mock('@/lib/intelligence/ai/settings', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/intelligence/ai/settings')>();
  return {
    ...actual,
    getAiSettings: async () => ({ ...(await actual.getAiSettings()), enabled: ai.enabled }),
  };
});
vi.mock('@/lib/intelligence/ai/port', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/intelligence/ai/port')>()),
  resolveLanguageModel: async () => ({ model: 'fake' }),
}));
vi.mock('@/lib/intelligence/ai/result-cache', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/intelligence/ai/result-cache')>()),
  cachedGenerate: async (_port: unknown, request: unknown) => {
    ai.calls.push(request);
    return { text: 'A busier week with one critical policy finding.' };
  },
}));
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { buildTeamBriefs } from '@/lib/intelligence/digest/team-brief';
import type { OpsInsightArea } from '@/lib/intelligence/ops-insights/contract';
import { upsertInsights } from '@/lib/intelligence/ops-insights/store';
import {
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const NOW = new Date('2026-11-10T12:00:00Z');
const day = (offset: number) => new Date(Date.UTC(2026, 10, 10 + offset));
const APP = 'https://ops.example.com';

async function actorFor(userId: string) {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
}

const settings = (opsHelpersEnabled: boolean) =>
  db.intelligenceSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      enabled: true,
      opsHelpersEnabled,
      opsInsightsEnabled: true,
      opsInsightsAutomationEnabled: true,
      opsInsightsEscalationEnabled: true,
    },
    update: { opsHelpersEnabled },
  });

const insight = (
  scope: { type: 'SERVICE' | 'POLICY'; id: string },
  title: string,
  severity: 'WARNING' | 'CRITICAL',
  area: OpsInsightArea
) =>
  upsertInsights(
    scope,
    `test.${title}`,
    [{ key: 'k', severity, title, summary: 'x', evidence: { facts: [] } }],
    { area }
  );

describe('weekly reliability brief per team', () => {
  it('summarises each of my teams from what I may read, and is off by default', async () => {
    const payments = await createTestTeam('Payments');
    const search = await createTestTeam('Search');
    const quiet = await createTestTeam('Quiet');
    const member = await createTestUser({ role: 'RESPONDER' });
    const reader = await createTestUser({ role: 'USER' });
    for (const team of [payments, quiet])
      await db.teamMember.create({ data: { userId: member.id, teamId: team.id, role: 'MEMBER' } });
    await db.teamMember.create({
      data: { userId: reader.id, teamId: payments.id, role: 'MEMBER' },
    });

    const policy = await db.escalationPolicy.create({ data: { name: 'Payments on-call' } });
    const api = await createTestService('Payments API', payments.id);
    await db.service.update({ where: { id: api.id }, data: { escalationPolicyId: policy.id } });
    const other = await createTestService('Search API', search.id);
    for (const [serviceId, date, totalIncidents] of [
      [api.id, day(-2), 3],
      [api.id, day(-10), 1],
      [other.id, day(-2), 9],
    ] as const)
      await db.incidentMetricRollup.create({
        data: { serviceId, date, granularity: 'daily', totalIncidents },
      });
    await insight({ type: 'SERVICE', id: api.id }, 'No alerts for 3 days', 'WARNING', 'automation');
    await insight(
      { type: 'POLICY', id: policy.id },
      'Step 1 is never acknowledged',
      'CRITICAL',
      'escalation'
    );
    await insight({ type: 'SERVICE', id: other.id }, 'Not my team', 'CRITICAL', 'automation');

    const actor = await actorFor(member.id);
    await settings(false);
    expect(await buildTeamBriefs(actor, APP, NOW)).toEqual([]);

    await settings(true);
    const briefs = await buildTeamBriefs(actor, APP, NOW);
    // The quiet team (no incidents, no insights) and the team I am not in are left out.
    expect(briefs).toEqual([
      {
        teamName: payments.name,
        url: `${APP}/teams/${payments.id}`,
        line: '3 incidents in the last 7 days (1 the week before); 2 open insights (1 critical, 1 warning).',
        phrasing: null,
        insights: [
          {
            scopeName: 'Payments on-call',
            title: 'Step 1 is never acknowledged',
            severity: 'CRITICAL',
            url: `${APP}/policies/${policy.id}`,
          },
          {
            scopeName: api.name,
            title: 'No alerts for 3 days',
            severity: 'WARNING',
            url: `${APP}/services/${api.id}`,
          },
        ],
      },
    ]);

    // Someone who may not read escalation policies does not see the policy's insight in the brief.
    const [scoped] = await buildTeamBriefs(await actorFor(reader.id), APP, NOW);
    expect(scoped.insights.map(row => row.title)).toEqual(['No alerts for 3 days']);
    expect(scoped.line).toContain('1 open insight (1 warning)');

    // An area switched off drops its insights from the brief.
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { opsInsightsEscalationEnabled: false },
    });
    const [only] = await buildTeamBriefs(actor, APP, NOW);
    expect(only.insights.map(row => row.title)).toEqual(['No alerts for 3 days']);

    // With AI on: one background, cached call per team carrying the deterministic facts.
    ai.enabled = true;
    try {
      const [phrased] = await buildTeamBriefs(actor, APP, NOW);
      expect(phrased.phrasing).toBe('A busier week with one critical policy finding.');
      expect(ai.calls).toHaveLength(1);
      const request = ai.calls[0] as {
        context: { callSite: string };
        messages: Array<{ content: string }>;
      };
      expect(request.context.callSite).toBe('background');
      expect(request.messages[1].content).toContain(phrased.line);
    } finally {
      ai.enabled = false;
    }
  });
});
