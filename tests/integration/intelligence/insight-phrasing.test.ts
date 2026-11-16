import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateStructured = vi.fn();
const resolveLanguageModel = vi.fn();
vi.mock('@/lib/intelligence/ai/port', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/intelligence/ai/port')>()),
  resolveLanguageModel: (...args: unknown[]) => resolveLanguageModel(...args),
}));

import { resolveUserActor } from '@/lib/authorization-actors';
import type { OpsInsightItem, OpsInsightScope } from '@/lib/intelligence/ops-insights/contract';
import { phraseInsightsForScope } from '@/lib/intelligence/ops-insights/phrasing';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import { upsertInsights } from '@/lib/intelligence/ops-insights/store';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import {
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  vi.clearAllMocks();
  resolveLanguageModel.mockResolvedValue({ generateStructured });
  // Echo a phrase for every id the model was sent, so the test sees exactly what was sent.
  generateStructured.mockImplementation(async (request: { messages: { content: string }[] }) => ({
    object: {
      items: [...request.messages[1].content.matchAll(/^id: (\S+)$/gm)].map(match => ({
        id: match[1],
        text: `Plain ${match[1]}`,
      })),
    },
  }));
});

const item = (key: string, overrides: Partial<OpsInsightItem> = {}): OpsInsightItem => ({
  key,
  severity: 'WARNING',
  title: `Insight ${key}`,
  summary: 'Something to look at.',
  evidence: { facts: [{ label: 'Count', value: '3' }] },
  ...overrides,
});
const serviceScope = (id: string): OpsInsightScope => ({ type: 'SERVICE', id });

async function world() {
  const admin = await createTestUser({ role: 'ADMIN' });
  await updateOpsInsightSwitches(
    {
      opsInsightsEnabled: true,
      opsInsightsAutomationEnabled: true,
      opsInsightsEscalationEnabled: true,
      opsInsightsOnCallEnabled: true,
      opsInsightsPostmortemsEnabled: true,
      opsInsightsRunbooksEnabled: true,
      opsInsightsNotificationsEnabled: true,
      expectedRevision: (await getIntelligenceSettings()).revision,
    },
    { actorId: admin.id, source: 'UI' }
  );
  const teamA = await createTestTeam('Team A');
  const teamB = await createTestTeam('Team B');
  const serviceA = await createTestService('A', teamA.id);
  const serviceB = await createTestService('B', teamB.id);
  await upsertInsights(serviceScope(serviceA.id), 'test.kind', [item('one'), item('two')], {
    area: 'automation',
  });
  await upsertInsights(serviceScope(serviceB.id), 'test.kind', [item('secret')], {
    area: 'automation',
  });
  const reader = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: reader.id, teamId: teamA.id, role: 'MEMBER' } });
  const actor = await resolveUserActor(reader.id);
  if (!actor) throw new Error('actor');
  return { actor, serviceA, serviceB };
}

describe('phraseInsightsForScope', () => {
  it('phrases all of a readable scope’s open insights in one call', async () => {
    const { actor, serviceA } = await world();
    const ids = (await db.opsInsight.findMany({ where: { scopeId: serviceA.id } })).map(r => r.id);

    const result = await phraseInsightsForScope(actor, serviceScope(serviceA.id));

    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.phrases).sort()).toEqual([...ids].sort());
    expect(generateStructured.mock.calls[0][0].messages[1].content).not.toContain('secret');
  });

  it('sends nothing for a scope the viewer cannot read', async () => {
    const { actor, serviceB } = await world();
    expect(await phraseInsightsForScope(actor, serviceScope(serviceB.id))).toEqual({
      phrases: {},
    });
    expect(resolveLanguageModel).not.toHaveBeenCalled();
  });

  it('leaves dismissed insights out', async () => {
    const { actor, serviceA } = await world();
    await db.opsInsight.updateMany({
      where: { scopeId: serviceA.id, key: 'two' },
      data: { status: 'DISMISSED' },
    });
    const result = await phraseInsightsForScope(actor, serviceScope(serviceA.id));
    expect(Object.values(result.phrases)).toHaveLength(1);
  });
});
