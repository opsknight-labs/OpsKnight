import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { getEscalationExecutionHealth } from '@/lib/escalation/execution-health';

async function job(
  incidentId: string,
  stepIndex: number,
  status: 'COMPLETED' | 'FAILED',
  generation = 0
) {
  return db.backgroundJob.create({
    data: {
      type: 'ESCALATION',
      status,
      attempts: status === 'FAILED' ? 3 : 1,
      maxAttempts: 3,
      scheduledAt: new Date(),
      error:
        status === 'FAILED'
          ? 'Job timed out in PROCESSING state after exceeding maxAttempts'
          : null,
      failedAt: status === 'FAILED' ? new Date() : null,
      completedAt: status === 'COMPLETED' ? new Date() : null,
      payload: {
        incidentId,
        generation,
        stepIndex,
        logicalKey: `ESCALATION:${incidentId}:${generation}:${stepIndex}`,
      },
    },
  });
}

describe('escalation execution health (PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 30_000);
  afterAll(async () => {
    await db.$disconnect();
  });

  it('shows the failed step-1 job after step 2 completed, with its policy target', async () => {
    const user = await createTestUser({ name: 'Secondary Responder' });
    const policy = await db.escalationPolicy.create({
      data: {
        name: 'Two step',
        steps: {
          create: [
            {
              stepOrder: 0,
              delayMinutes: 0,
              targetType: 'USER',
              targetUserId: user.id,
              notificationChannels: ['EMAIL'],
            },
            {
              stepOrder: 1,
              delayMinutes: 1,
              targetType: 'USER',
              targetUserId: user.id,
              notificationChannels: ['EMAIL'],
            },
          ],
        },
      },
    });
    const service = await db.service.create({
      data: { name: 'Health service', escalationPolicyId: policy.id },
    });
    const incident = await db.incident.create({
      data: { serviceId: service.id, title: 'Step failure', escalationStatus: 'COMPLETED' },
    });
    await job(incident.id, 0, 'COMPLETED');
    await job(incident.id, 1, 'FAILED');
    await db.incidentEvent.create({
      data: { incidentId: incident.id, type: 'ESCALATED', message: 'Escalated to user (Level 1)' },
    });

    const health = await getEscalationExecutionHealth(incident.id);

    expect(health?.needsAttention).toBe(true);
    const failed = health!.steps.find(step => step.stepNumber === 2)!;
    expect(failed).toMatchObject({
      outcome: 'FAILED',
      targetLabel: 'Secondary Responder',
      attempts: 3,
      maxAttempts: 3,
    });
    expect(health!.steps.find(step => step.stepNumber === 1)?.outcome).toBe('COMPLETED');
  });

  it('does not read jobs belonging to another incident or generation', async () => {
    const service = await db.service.create({ data: { name: 'Isolated' } });
    const [mine, other] = await Promise.all([
      db.incident.create({ data: { serviceId: service.id, title: 'mine' } }),
      db.incident.create({ data: { serviceId: service.id, title: 'other' } }),
    ]);
    await job(other.id, 0, 'FAILED');
    await job(mine.id, 0, 'FAILED', 3);

    const health = await getEscalationExecutionHealth(mine.id);

    expect(health?.steps).toEqual([]);
    expect(health?.needsAttention).toBe(false);
  });
});
