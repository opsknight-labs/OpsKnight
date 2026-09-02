import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { calculateSLAMetrics } from '@/lib/sla-server';
import { clearRetentionPolicyCache } from '@/lib/retention-policy';
import { resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('SLA aggregation threshold parity', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
    clearRetentionPolicyCache();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('returns identical pause-aware MTTA below and above the SQL threshold', async () => {
    const service = await testPrisma.service.create({
      data: { name: `SLA parity ${crypto.randomUUID()}` },
    });
    const createdAt = new Date(Date.now() - 60 * 60_000);
    const acknowledgedAt = new Date(createdAt.getTime() + 30 * 60_000);
    const pauseStartedAt = new Date(createdAt.getTime() + 5 * 60_000);
    const pauseEndedAt = new Date(createdAt.getTime() + 15 * 60_000);

    const insertIncidents = async (start: number, count: number) => {
      const ids = Array.from(
        { length: count },
        (_, offset) => `sla-parity-${start + offset}-${crypto.randomUUID()}`
      );
      await testPrisma.incident.createMany({
        data: ids.map(id => ({
          id,
          title: 'SLA aggregation parity',
          serviceId: service.id,
          status: 'ACKNOWLEDGED',
          priority: 'P2',
          createdAt,
          acknowledgedAt,
        })),
      });
      await testPrisma.incidentSlaPause.createMany({
        data: ids.map(incidentId => ({
          incidentId,
          startedAt: pauseStartedAt,
          endedAt: pauseEndedAt,
        })),
      });
    };

    await insertIncidents(0, 499);
    const filters = {
      serviceId: service.id,
      startDate: new Date(createdAt.getTime() - 1),
      endDate: new Date(),
      userTimeZone: 'UTC',
      _forceLive: true,
    } as const;
    const belowThreshold = await calculateSLAMetrics(filters);

    await insertIncidents(499, 2);
    const aboveThreshold = await calculateSLAMetrics(filters);

    expect(belowThreshold.totalIncidents).toBe(499);
    expect(aboveThreshold.totalIncidents).toBe(501);
    expect(belowThreshold.mttd).toBeCloseTo(20, 8);
    expect(aboveThreshold.mttd).toBeCloseTo(belowThreshold.mttd ?? 0, 8);
    expect(aboveThreshold.ackRate).toBe(belowThreshold.ackRate);
  });
});
