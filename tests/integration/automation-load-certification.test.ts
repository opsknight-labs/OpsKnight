import { afterAll, beforeAll, expect, it } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { processIntegrationEvent } from '@/lib/events';
import { configureAutomationLoadProfile } from '../load/helpers/automation';
import { AUTOMATION_LOAD_PROFILES } from '../load/fixtures/automation';

beforeAll(async () => {
  await resetDatabase();
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
});
afterAll(async () => {
  await db.$disconnect();
});
it('certifies independent global-off, service-disabled, Shadow and LIVE profiles against real PostgreSQL ingestion with concurrent fresh and duplicate events', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const [before] = await db.$queryRaw<
    Array<{ deadlocks: bigint }>
  >`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`;
  const results = [];
  for (const profile of AUTOMATION_LOAD_PROFILES.filter(profile => profile !== 'disabled')) {
    await db.systemSettings.update({
      where: { id: 'default' },
      data: { automationEnabled: profile !== 'global-off' },
    });
    const service = await db.service.create({ data: { name: `Load ${profile}` } });
    await configureAutomationLoadProfile(db, [service.id], actor.id, profile);
    const durations: number[] = [];
    const started = performance.now();
    for (let batch = 0; batch < 12; batch++) {
      await Promise.all(
        Array.from({ length: 8 }, async (_, slot) => {
          const event = {
            event_action: 'trigger' as const,
            dedup_key: `${profile}-${batch}-${slot}`,
            payload: {
              summary: 'Automation load',
              source: 'certification',
              severity: 'error' as const,
              custom_details: { value: 1 },
            },
          };
          const start = performance.now();
          await processIntegrationEvent({
            serviceId: service.id,
            integrationId: 'load',
            integrationType: 'EVENTS_API',
            event,
            providerPayload: event,
            receivedAt: new Date(),
          });
          durations.push(performance.now() - start);
          if (batch === 0)
            await processIntegrationEvent({
              serviceId: service.id,
              integrationId: 'load',
              integrationType: 'EVENTS_API',
              event,
              providerPayload: event,
              receivedAt: new Date(),
            });
        })
      );
    }
    const incidents = await db.incident.findMany({ where: { serviceId: service.id } });
    expect(incidents).toHaveLength(96);
    expect(await db.automationTrace.count({ where: { serviceId: service.id } })).toBe(
      ['global-off', 'service-disabled'].includes(profile) ? 0 : 96
    );
    expect(await db.incidentAutomationDecision.count({ where: { serviceId: service.id } })).toBe(
      profile.startsWith('live') ? 96 : 0
    );
    const sorted = durations.sort((a, b) => a - b);
    results.push({
      profile,
      events: durations.length,
      concurrency: 8,
      elapsedMs: performance.now() - started,
      p50Ms: sorted[Math.floor(sorted.length * 0.5)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      p99Ms: sorted[Math.floor(sorted.length * 0.99)],
    });
  }
  const postgres =
    await db.$queryRaw`SELECT numbackends, xact_commit, xact_rollback, deadlocks, temp_bytes FROM pg_stat_database WHERE datname = current_database()`;
  await mkdir('docs/automation', { recursive: true });
  await writeFile(
    'docs/automation/load-results.json',
    JSON.stringify(
      {
        kind: 'Local PostgreSQL full transaction ingestion; 8 concurrent clients; not HTTP capacity certification',
        generatedAt: new Date().toISOString(),
        results,
        postgres,
        deadlocksDelta:
          Number((postgres as Array<{ deadlocks: bigint }>)[0].deadlocks) -
          Number(before.deadlocks),
      },
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    ) + '\n'
  );
}, 180000);
