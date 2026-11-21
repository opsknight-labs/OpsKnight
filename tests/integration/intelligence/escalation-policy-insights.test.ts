import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { loadPolicyIntelligence } from '@/lib/intelligence/ops-insights/policy-intelligence';
import { runOpsInsights, resetOpsInsightsSchedule } from '@/lib/intelligence/ops-insights/handlers';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import { countOpenInsightsForScopes } from '@/lib/intelligence/ops-insights/view';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { generateOpsRollups } from '@/lib/metric-rollup';
import {
  createTestIncident,
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
  resetOpsInsightsSchedule();
});

const DAY = 86_400_000;
const MIN = 60_000;

async function switches(escalation: boolean) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const current = await getIntelligenceSettings();
  await updateOpsInsightSwitches(
    {
      opsInsightsEnabled: true,
      opsInsightsAutomationEnabled: false,
      opsInsightsEscalationEnabled: escalation,
      opsInsightsOnCallEnabled: false,
      opsInsightsPostmortemsEnabled: false,
      opsInsightsRunbooksEnabled: false,
      opsInsightsNotificationsEnabled: false,
      expectedRevision: current.revision,
    },
    { actorId: admin.id, source: 'UI' }
  );
  return admin;
}

/**
 * Known answers. Policy "Busy": step 1 (team Ada+Bob, immediately), step 2 (Bob, after 30 min), step 3
 * (Ada, after 10 min). Two days ago (the step-outcome rollup waits a day for a day to settle): 12
 * incidents acknowledged 3 min after step 1; 6 incidents that went through step 1 to
 * step 2 and were never acknowledged; 5 incidents where step 3 was skipped for want of a contact method.
 * Policy "Lonely": one step to Ada, no service, created 10 days ago.
 */
async function fixtures() {
  const ada = await createTestUser({ name: 'Ada', timeZone: 'UTC' });
  const bob = await createTestUser({ name: 'Bob', timeZone: 'UTC' });
  const pair = await createTestTeam('Pair');
  await db.teamMember.createMany({
    data: [
      { teamId: pair.id, userId: ada.id },
      { teamId: pair.id, userId: bob.id },
    ],
  });
  const busy = await db.escalationPolicy.create({
    data: {
      name: 'Busy',
      steps: {
        create: [
          { stepOrder: 0, delayMinutes: 0, targetType: 'TEAM', targetTeamId: pair.id },
          { stepOrder: 1, delayMinutes: 30, targetType: 'USER', targetUserId: bob.id },
          { stepOrder: 2, delayMinutes: 10, targetType: 'USER', targetUserId: ada.id },
        ],
      },
    },
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
  });
  const lonely = await db.escalationPolicy.create({
    data: {
      name: 'Lonely',
      createdAt: new Date(Date.now() - 10 * DAY),
      steps: {
        create: [{ stepOrder: 0, delayMinutes: 0, targetType: 'USER', targetUserId: ada.id }],
      },
    },
  });
  const service = await createTestService('Checkout', null, { escalationPolicyId: busy.id });

  const today = new Date();
  const base = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) -
      2 * DAY +
      13 * 60 * MIN
  );
  const attempts: Array<Record<string, unknown>> = [];
  const attempt = (
    incidentId: string,
    stepIndex: number,
    outcome: string,
    notifiedAt: Date | null,
    userId: string | null,
    skipReason?: string
  ) =>
    attempts.push({
      incidentId,
      generation: 0,
      stepIndex,
      policyId: busy.id,
      outcome,
      notifiedAt,
      skipReason: skipReason ?? null,
      resolvedUserIds: userId ? [userId] : [],
      createdAt: notifiedAt ?? base,
    });
  for (let i = 0; i < 12; i += 1) {
    const paged = new Date(base.getTime() + i * MIN);
    const incident = await createTestIncident(`Acked ${i}`, service.id, {
      acknowledgedAt: new Date(paged.getTime() + 3 * MIN),
    });
    attempt(incident.id, 0, 'NOTIFIED', paged, ada.id);
  }
  for (let i = 0; i < 6; i += 1) {
    const paged = new Date(base.getTime() + (20 + i) * MIN);
    const incident = await createTestIncident(`Unanswered ${i}`, service.id);
    attempt(incident.id, 0, 'NOTIFIED', paged, ada.id);
    attempt(incident.id, 1, 'NOTIFIED', new Date(paged.getTime() + 30 * MIN), bob.id);
  }
  for (let i = 0; i < 5; i += 1) {
    const incident = await createTestIncident(`Skipped ${i}`, service.id, {
      acknowledgedAt: new Date(base.getTime() + 2 * MIN),
    });
    attempt(incident.id, 0, 'NOTIFIED', base, ada.id);
    attempt(incident.id, 2, 'SKIPPED', null, null, 'NO_CONTACT_METHOD');
  }
  await db.escalationStepAttempt.createMany({ data: attempts as never });
  await generateOpsRollups(new Date(), { force: true, lookbackDays: 3 });
  return { busy, lonely, ada, bob };
}

async function produce(policyId: string) {
  const settings = await getIntelligenceSettings();
  return runOpsInsights(
    { subjectKey: `POLICY:${policyId}`, generation: 1, force: false },
    settings
  );
}

describe('escalation policy insights', () => {
  it('derives the known insights from the rollup and stores counts, not names', async () => {
    const admin = await switches(true);
    const { busy, lonely } = await fixtures();

    expect(await produce(busy.id)).toBe('computed');
    expect(await produce(lonely.id)).toBe('computed');

    const rows = await db.opsInsight.findMany({
      where: { scopeType: 'POLICY', status: 'OPEN' },
      orderBy: { key: 'asc' },
    });
    const keys = (scopeId: string) =>
      rows.filter(row => row.scopeId === scopeId).map(row => row.key);
    // Step 2 reaches only Bob: "never acknowledged" would be his own record, so it is not published.
    expect(keys(busy.id)).toEqual(['always-skipped:2', 'timeout:1']);
    expect(keys(lonely.id)).toEqual(['single-person', 'unused']);

    const timeout = rows.find(row => row.key === 'timeout:1');
    expect(timeout?.title).toBe('Wait 3 minutes before step 2, not 30');
    expect(timeout?.draftHref).toBe(
      `/policies/${busy.id}?tab=steps&suggestStep=${busy.steps[1].id}&suggestDelay=3`
    );
    // Evidence is counts and labels only: no person's name or id.
    for (const row of rows) {
      expect(JSON.stringify(row.evidence)).not.toMatch(/Ada|Bob/);
    }

    // Unchanged inputs: the second run writes nothing.
    expect(await produce(busy.id)).toBe('unchanged');

    const actor = await resolveUserActor(admin.id);
    const counts = await countOpenInsightsForScopes(actor!, 'POLICY', [busy.id, lonely.id]);
    expect(counts.get(busy.id)).toEqual({ open: 2, highest: 'WARNING' });

    const view = await loadPolicyIntelligence(actor!, busy);
    expect(view.insights).toHaveLength(2);
    expect(view.stepStats[busy.steps[0].id]).toEqual({
      paged: 23,
      ackRate: 17 / 23,
      medianAckMinutes: 3,
    });
    expect(view.stepStats[busy.steps[1].id]).toMatchObject({ paged: 6, ackRate: 0 });
    expect(view.stepStats[busy.steps[2].id]).toBeUndefined();
  });

  it("shows a one-person step only to readers of that person's load", async () => {
    await switches(true);
    const { busy, ada, bob } = await fixtures();
    for (const user of [ada, bob])
      await db.user.update({ where: { id: user.id }, data: { role: 'RESPONDER' } });
    const shown = async (userId: string) =>
      Object.keys(
        (await loadPolicyIntelligence((await resolveUserActor(userId))!, busy)).stepStats
      );
    // Step 1 reaches a team of two; step 2 only Bob. Ada does not see Bob's numbers; Bob does.
    expect(await shown(ada.id)).toEqual([busy.steps[0].id]);
    expect((await shown(bob.id)).sort()).toEqual([busy.steps[0].id, busy.steps[1].id].sort());
  });

  it('is empty while escalation insights are off', async () => {
    const admin = await switches(false);
    const { busy } = await fixtures();
    expect(await produce(busy.id)).toBe('computed');
    expect(await db.opsInsight.count()).toBe(0);
    const view = await loadPolicyIntelligence((await resolveUserActor(admin.id))!, busy);
    expect(view).toEqual({ insights: [], stepStats: {}, canDecide: false });
  });

  it('shows nothing to someone who may not read escalation policies', async () => {
    await switches(true);
    const { busy } = await fixtures();
    await produce(busy.id);
    const user = await createTestUser({ role: 'USER' });
    const actor = (await resolveUserActor(user.id))!;
    expect(await loadPolicyIntelligence(actor, busy)).toEqual({
      insights: [],
      stepStats: {},
      canDecide: false,
    });
    expect((await countOpenInsightsForScopes(actor, 'POLICY', [busy.id])).size).toBe(0);
  });
});
