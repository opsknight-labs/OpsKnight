import { beforeEach, describe, expect, it } from 'vitest';
import { createTestService, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('incident escalation lifecycle database invariant', { timeout: 30000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function createIncident(status: 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED') {
    const service = await createTestService(`Escalation lifecycle ${Math.random()}`);
    return testPrisma.incident.create({
      data: {
        title: `Escalation lifecycle ${status}`,
        serviceId: service.id,
        status,
        urgency: 'HIGH',
        escalationStatus: status === 'SNOOZED' || status === 'SUPPRESSED' ? 'PAUSED' : 'COMPLETED',
        currentEscalationStep: status === 'SNOOZED' || status === 'SUPPRESSED' ? 2 : null,
      },
    });
  }

  it.each(['ACKNOWLEDGED', 'RESOLVED'] as const)(
    'normalizes stale escalation writes after %s',
    async status => {
      const incident = await createIncident(status);
      const staleLease = new Date('2026-08-30T10:00:00.000Z');

      await testPrisma.incident.update({
        where: { id: incident.id },
        data: {
          escalationStatus: 'ESCALATING',
          currentEscalationStep: 3,
          nextEscalationAt: new Date('2026-08-30T11:00:00.000Z'),
          escalationProcessingAt: staleLease,
        },
      });

      const stored = await testPrisma.incident.findUnique({ where: { id: incident.id } });
      expect(stored).toMatchObject({
        status,
        escalationStatus: 'COMPLETED',
        currentEscalationStep: null,
        nextEscalationAt: null,
        escalationProcessingAt: null,
      });
    }
  );

  it.each(['SNOOZED', 'SUPPRESSED'] as const)(
    'keeps %s paused while preserving the resumable step',
    async status => {
      const incident = await createIncident(status);

      await testPrisma.incident.update({
        where: { id: incident.id },
        data: {
          escalationStatus: 'ESCALATING',
          currentEscalationStep: 2,
          nextEscalationAt: new Date('2026-08-30T11:00:00.000Z'),
          escalationProcessingAt: new Date('2026-08-30T10:00:00.000Z'),
        },
      });

      const stored = await testPrisma.incident.findUnique({ where: { id: incident.id } });
      expect(stored).toMatchObject({
        status,
        escalationStatus: 'PAUSED',
        currentEscalationStep: 2,
        nextEscalationAt: null,
        escalationProcessingAt: null,
      });
    }
  );
});