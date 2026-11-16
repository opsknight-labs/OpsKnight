import { afterAll, beforeEach, expect, it } from 'vitest';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestIncident,
} from '../helpers/test-db';
import { backfillEscalationStepAttempts } from '@/lib/escalation/step-attempt-backfill';

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
