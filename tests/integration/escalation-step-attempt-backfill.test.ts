import { OPS_ROLLUPS } from '@/lib/metric-rollup';
import { afterAll, beforeEach, expect, it } from 'vitest';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestIncident,
} from '../helpers/test-db';
import {
  ATTEMPT_BACKFILL_UNTIL_CURSOR,
  backfillEscalationStepAttempts,
} from '@/lib/escalation/step-attempt-backfill';
import {
  ATTEMPT_BACKFILL_CURSOR,
  OPS_INSIGHT_HANDLERS,
  resetOpsInsightsSchedule,
  runEscalationAttemptBackfill,
  scheduleOpsInsightsWork,
} from '@/lib/intelligence/ops-insights/handlers';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';

beforeEach(() => resetDatabase());
afterAll(() => db.$disconnect());

const NOW = new Date('2026-11-14T12:00:00Z');
const ago = (days: number, minutes = 0) =>
  new Date(NOW.getTime() - days * 86_400_000 + minutes * 60_000);

it('rebuilds approximate attempts from timeline text, in resumable batches, without touching live rows', async () => {
  const policy = await db.escalationPolicy.create({ data: { name: 'Backfill policy' } });
  const service = await createTestService('Backfill');
  await db.service.update({ where: { id: service.id }, data: { escalationPolicyId: policy.id } });

  const incident = async (title: string, createdAt: Date, messages: Array<[string, number]>) => {
    const row = await createTestIncident(title, service.id, { createdAt });
    await db.incidentEvent.createMany({
      data: messages.map(([message, minutes]) => ({
        incidentId: row.id,
        message,
        createdAt: new Date(createdAt.getTime() + minutes * 60_000),
      })),
    });
    return row;
  };
  const old = await incident('Too old', ago(91), [['Escalated to A (Level 1)', 0]]);
  const first = await incident('First', ago(10), [
    ['Escalated to A (Level 1)', 0],
    ['Escalation step 2 (SCHEDULE: Primary) resolved to no users. Skipping to next step.', 5],
    ['Escalated to TEAM: Ops (2 users) (Level 3, after 5 minute delay)', 10],
  ]);
  const second = await incident('Second', ago(5), [['Escalated to B (Level 1)', 0]]);
  // Live capture started here: nothing at or after it is reconstructed.
  const live = await incident('Live', ago(1), [['Escalated to C (Level 1)', 0]]);
  await db.escalationStepAttempt.create({
    data: {
      incidentId: live.id,
      generation: 0,
      stepIndex: 0,
      policyId: policy.id,
      outcome: 'NOTIFIED',
      notifiedAt: ago(1),
      createdAt: ago(1),
    },
  });

  const batch1 = await backfillEscalationStepAttempts(db, { now: NOW, batchSize: 1 });
  expect(batch1).toMatchObject({ incidents: 1, inserted: 3 });
  expect(batch1.cursor).not.toBeNull();
  const batch2 = await backfillEscalationStepAttempts(db, {
    now: NOW,
    batchSize: 1,
    cursor: batch1.cursor,
  });
  expect(batch2).toMatchObject({ incidents: 1, inserted: 1 });
  const batch3 = await backfillEscalationStepAttempts(db, {
    now: NOW,
    batchSize: 1,
    cursor: batch2.cursor,
  });
  expect(batch3).toEqual({ incidents: 0, inserted: 0, cursor: null });

  const rows = await db.escalationStepAttempt.findMany({
    orderBy: [{ createdAt: 'asc' }],
    select: {
      incidentId: true,
      stepIndex: true,
      outcome: true,
      skipReason: true,
      approximate: true,
      policyId: true,
    },
  });
  expect(rows).toEqual([
    {
      incidentId: first.id,
      stepIndex: 0,
      outcome: 'NOTIFIED',
      skipReason: null,
      approximate: true,
      policyId: policy.id,
    },
    {
      incidentId: first.id,
      stepIndex: 1,
      outcome: 'SKIPPED',
      skipReason: 'NO_ONE_ON_CALL',
      approximate: true,
      policyId: policy.id,
    },
    {
      incidentId: first.id,
      stepIndex: 2,
      outcome: 'NOTIFIED',
      skipReason: null,
      approximate: true,
      policyId: policy.id,
    },
    {
      incidentId: second.id,
      stepIndex: 0,
      outcome: 'NOTIFIED',
      skipReason: null,
      approximate: true,
      policyId: policy.id,
    },
    {
      incidentId: live.id,
      stepIndex: 0,
      outcome: 'NOTIFIED',
      skipReason: null,
      approximate: false,
      policyId: policy.id,
    },
  ]);
  expect(rows.some(row => row.incidentId === old.id)).toBe(false);

  // Running again from the start inserts nothing.
  expect((await backfillEscalationStepAttempts(db, { now: NOW, batchSize: 10 })).inserted).toBe(0);
});

it('runs as a resumable lane job only while escalation insights are on, and stops once done', async () => {
  const service = await createTestService('Lane backfill');
  for (const days of [3, 2, 1]) {
    const row = await createTestIncident(`Lane ${days}`, service.id, { createdAt: ago(days) });
    await db.incidentEvent.create({
      data: { incidentId: row.id, message: 'Escalated to A (Level 1)', createdAt: ago(days) },
    });
  }
  const off = await getIntelligenceSettings();
  expect(await runEscalationAttemptBackfill(off, { now: NOW })).toBe(false);
  expect(await db.escalationStepAttempt.count()).toBe(0);
  expect(await db.intelligenceCursor.count()).toBe(0);

  const switches = { opsInsightsEnabled: true, opsInsightsEscalationEnabled: true };
  await db.intelligenceSettings.upsert({
    where: { id: 'default' },
    create: switches,
    update: switches,
  });
  const on = await getIntelligenceSettings();
  resetOpsInsightsSchedule();
  await scheduleOpsInsightsWork(Date.now(), OPS_INSIGHT_HANDLERS);
  expect(
    await db.intelligenceWorkItem.count({ where: { kind: 'BACKFILL_ESCALATION_ATTEMPTS' } })
  ).toBe(1);

  // The step-outcome rollup already sealed these days before the backfill wrote them.
  const sealed = `${OPS_ROLLUPS.escalationStepOutcome}.watermark`;
  await db.metricRollup.create({ data: { name: sealed, bucket: ago(1), count: 0, sum: 0 } });

  // One batch per call; the cursor survives between calls (a restart resumes where it stopped).
  let batches = 0;
  while (await runEscalationAttemptBackfill(on, { now: NOW })) batches += 1;
  expect(batches).toBe(0); // 3 incidents fit in one 250-row batch
  expect(await db.escalationStepAttempt.count({ where: { approximate: true } })).toBe(3);
  const cursor = await db.intelligenceCursor.findUniqueOrThrow({
    where: { name: ATTEMPT_BACKFILL_CURSOR },
  });
  expect(cursor.lastId).toBe('');
  // The window's end (no live attempts yet, so now) is read once and kept for every later batch.
  const until = await db.intelligenceCursor.findUniqueOrThrow({
    where: { name: ATTEMPT_BACKFILL_UNTIL_CURSOR },
  });
  expect(until.watermarkAt).toEqual(NOW);
  // Finishing restarts the rollup, so the next pass rolls the whole window up again.
  expect(await db.metricRollup.count({ where: { name: sealed } })).toBe(0);

  // Done: further runs read nothing new, and the scan no longer queues it.
  expect(await runEscalationAttemptBackfill(on, { now: NOW })).toBe(false);
  await db.intelligenceWorkItem.deleteMany();
  resetOpsInsightsSchedule();
  await scheduleOpsInsightsWork(Date.now(), OPS_INSIGHT_HANDLERS);
  expect(
    await db.intelligenceWorkItem.count({ where: { kind: 'BACKFILL_ESCALATION_ATTEMPTS' } })
  ).toBe(0);
});
