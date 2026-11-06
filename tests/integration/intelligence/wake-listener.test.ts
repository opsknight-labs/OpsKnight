import { expect, it } from 'vitest';
import { listenForIntelligenceWake } from '@/lib/intelligence/jobs/wake-listener';
import { signalIntelligenceIncident } from '@/lib/intelligence/jobs/wake-publisher';
import { testPrisma as db } from '../../helpers/test-db';

it('delivers a committed hint promptly, rejects malformed hints, and stops cleanly', async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  const seen: string[][] = [];
  const listener = listenForIntelligenceWake(ids => seen.push(ids));
  try {
    expect(await listener.ready).toBe(true);
    await db.$executeRaw`SELECT pg_notify('intelligence_new_incident', '["bad/identifier"]')`;
    signalIntelligenceIncident('new-incident');
    await expect.poll(() => seen, { timeout: 4000, interval: 20 }).toEqual([['new-incident']]);
    await listener.stop();
    await db.$executeRaw`SELECT pg_notify('intelligence_new_incident', '["after-stop"]')`;
    expect(seen).toHaveLength(1);
  } finally {
    await listener.stop();
  }
});

it('indexes and analyzes a newly ingested incident before the safety-lag polling path', async () => {
  const { resetDatabase, createTestService, createTestUser } =
    await import('../../helpers/test-db');
  const { INTELLIGENCE_SETTINGS_DEFAULTS, DEFAULT_POLICY_DEFINITION } =
    await import('@/lib/intelligence/contract');
  const { publishPolicyVersion } = await import('@/lib/intelligence/settings/service');
  const { startIntelligenceLane, stopIntelligenceLane } =
    await import('@/lib/intelligence/jobs/runner');
  const { processEvent } = await import('@/lib/events');
  await resetDatabase();
  const admin = await createTestUser({ role: 'ADMIN' });
  const service = await createTestService('First insight');
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, maxDbMs: 10000 },
  });
  await publishPolicyVersion(
    {},
    {
      mode: 'SUGGEST',
      expectedHeadVersion: 0,
      definition: { ...DEFAULT_POLICY_DEFINITION, response: { enabled: false } },
    },
    { actorId: admin.id, source: 'UI' }
  );
  // Start with a long poll delay. The notification, not the normal 30-second discovery lag,
  // must wake the worker. A separate listener proves PostgreSQL has accepted LISTEN first.
  const listener = listenForIntelligenceWake(() => {});
  try {
    expect(await listener.ready).toBe(true);
    startIntelligenceLane({ initialDelayMs: 60000 });
    const started = performance.now();
    const result = await processEvent(
      {
        event_action: 'trigger',
        dedup_key: 'first-insight',
        payload: { summary: 'Checkout pool exhausted', source: 'local-test', severity: 'warning' },
      },
      service.id,
      'intelligence-wake-test'
    );
    expect(result.action).toBe('triggered');
    if (!('incident' in result) || !result.incident) throw new Error('Incident was not created');
    const id = result.incident.id;
    await expect
      .poll(
        () =>
          db.intelligenceAnalysisSnapshot.findUnique({
            where: { incidentId_kind: { incidentId: id, kind: 'SIMILAR_INCIDENT' } },
          }),
        { timeout: 4500, interval: 20 }
      )
      .not.toBeNull();
    expect(performance.now() - started).toBeLessThan(5000);
    expect(await db.incidentFingerprint.findUnique({ where: { incidentId: id } })).not.toBeNull();
    expect(await db.alertFingerprint.count({ where: { incidentId: id } })).toBe(1);
  } finally {
    await stopIntelligenceLane();
    await listener.stop();
  }
});
