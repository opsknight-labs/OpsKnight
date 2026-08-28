import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { executeIncidentCreation } from '@/lib/incidents/creation';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('incident creation concurrency', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('serializes simultaneous requests for the same service/dedup key into one incident', async () => {
    const [service, actor] = await Promise.all([
      testPrisma.service.create({ data: { name: 'Concurrent Creation Service' } }),
      createTestUser({ email: 'creation-concurrency@example.com', name: 'Concurrency Tester' }),
    ]);

    const input = {
      title: 'Database latency',
      description: 'Write latency above threshold',
      serviceId: service.id,
      urgency: 'HIGH' as const,
      dedupKey: 'db-latency-concurrent',
      source: 'REST_API' as const,
      actor: { id: actor.id, name: actor.name },
      now: new Date('2026-08-28T10:00:00.000Z'),
    };

    const results = await Promise.all([
      executeIncidentCreation(input),
      executeIncidentCreation(input),
    ]);

    const incidents = await testPrisma.incident.findMany({
      where: { serviceId: service.id, dedupKey: input.dedupKey },
      select: { id: true },
    });

    expect(incidents).toHaveLength(1);
    expect(results.map(result => result.id)).toEqual([incidents[0].id, incidents[0].id]);
    expect(results.map(result => result.outcome).sort()).toEqual(['CREATED', 'MERGED']);
  });
});
