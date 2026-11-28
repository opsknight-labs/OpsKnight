import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import {
  readEscalationStepOrder,
  remapOpenIncidentEscalationCursors,
} from '@/lib/escalation/step-cursor';

async function seed(cursor: number, status: 'OPEN' | 'RESOLVED' = 'OPEN') {
  const user = await createTestUser({ role: 'ADMIN' });
  const policy = await db.escalationPolicy.create({ data: { name: 'Cursor policy' } });
  const rules = [];
  for (let stepOrder = 0; stepOrder < 3; stepOrder += 1) {
    rules.push(
      await db.escalationRule.create({
        data: { policyId: policy.id, stepOrder, targetType: 'USER', targetUserId: user.id },
      })
    );
  }
  const service = await db.service.create({
    data: { name: 'Cursor service', escalationPolicyId: policy.id },
  });
  const incident = await db.incident.create({
    data: {
      title: 'Cursor incident',
      serviceId: service.id,
      status,
      escalationStatus: 'ESCALATING',
      currentEscalationStep: cursor,
    },
  });
  const job = await db.backgroundJob.create({
    data: {
      type: 'ESCALATION',
      status: 'PENDING',
      scheduledAt: new Date(Date.now() + 60_000),
      payload: {
        incidentId: incident.id,
        generation: 1,
        stepIndex: cursor,
        logicalKey: `ESCALATION:${incident.id}:1:${cursor}`,
      },
    },
  });
  return { policy, rules, incident, job };
}

describe('escalation step cursor re-index (real database)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('moves the cursor and the queued job when an earlier step is deleted', async () => {
    const { policy, rules, incident, job } = await seed(2);
    const before = await readEscalationStepOrder(db, policy.id);

    await db.$transaction(async tx => {
      await tx.escalationRule.delete({ where: { id: rules[0]!.id } });
      await tx.escalationRule.update({ where: { id: rules[1]!.id }, data: { stepOrder: 0 } });
      await tx.escalationRule.update({ where: { id: rules[2]!.id }, data: { stepOrder: 1 } });
      const after = await readEscalationStepOrder(tx, policy.id);
      const moved = await remapOpenIncidentEscalationCursors(tx, {
        policyId: policy.id,
        before,
        after,
      });
      expect(moved).toBe(1);
    });

    const refreshed = await db.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(refreshed.currentEscalationStep).toBe(1);
    const refreshedJob = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshedJob.payload).toMatchObject({
      incidentId: incident.id,
      stepIndex: 1,
      logicalKey: `ESCALATION:${incident.id}:1:1`,
    });
  });

  it('leaves the cursor alone when a later step is deleted', async () => {
    const { policy, rules, incident, job } = await seed(1);
    const before = await readEscalationStepOrder(db, policy.id);

    await db.$transaction(async tx => {
      await tx.escalationRule.delete({ where: { id: rules[2]!.id } });
      const after = await readEscalationStepOrder(tx, policy.id);
      const moved = await remapOpenIncidentEscalationCursors(tx, {
        policyId: policy.id,
        before,
        after,
      });
      expect(moved).toBe(0);
    });

    const refreshed = await db.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(refreshed.currentEscalationStep).toBe(1);
    const refreshedJob = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(refreshedJob.payload).toMatchObject({ stepIndex: 1 });
  });

  it('does not touch resolved incidents', async () => {
    const { policy, rules, incident } = await seed(2, 'RESOLVED');
    const before = await readEscalationStepOrder(db, policy.id);

    await db.$transaction(async tx => {
      await tx.escalationRule.delete({ where: { id: rules[0]!.id } });
      const after = await readEscalationStepOrder(tx, policy.id);
      const moved = await remapOpenIncidentEscalationCursors(tx, {
        policyId: policy.id,
        before,
        after,
      });
      expect(moved).toBe(0);
    });

    const refreshed = await db.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(refreshed.currentEscalationStep).toBe(2);
  });
});
