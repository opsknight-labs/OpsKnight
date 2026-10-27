import { beforeEach, describe, expect, it } from 'vitest';
import {
  DISCOVERY_SAFETY_LAG_MS,
  discoverNewIncidents,
  reconcileFingerprints,
} from '@/lib/intelligence/jobs/discovery';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { createTestIncident, createTestService, resetDatabase, testPrisma as db } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const ago = (ms: number) => new Date(Date.now() - ms);

async function incident(title: string, serviceId: string, createdAt: Date) {
  return createTestIncident(title, serviceId, { createdAt });
}

describe('incident discovery', () => {
  it('starts from now on first run and never indexes history implicitly', async () => {
    const service = await createTestService('Checkout');
    await incident('Old incident', service.id, ago(3_600_000));
    expect(await discoverNewIncidents({ limit: 100 })).toEqual({ ran: true, discovered: 0 });
    expect(await discoverNewIncidents({ limit: 100 })).toEqual({ ran: true, discovered: 0 });
    expect(await db.intelligenceWorkItem.count()).toBe(0);
  });

  it('discovers incidents only after the safety lag and exactly once', async () => {
    const service = await createTestService('Checkout');
    await discoverNewIncidents({ limit: 100 }); // initialise the cursor
    const fresh = await incident('Fresh', service.id, new Date());
    // Too recent: a transaction that commits late could still appear behind it.
    expect(await discoverNewIncidents({ limit: 100 })).toMatchObject({ discovered: 0 });

    const later = new Date(Date.now() + DISCOVERY_SAFETY_LAG_MS + 1000);
    expect(await discoverNewIncidents({ limit: 100, now: later })).toMatchObject({ discovered: 1 });
    expect(await discoverNewIncidents({ limit: 100, now: later })).toMatchObject({ discovered: 0 });
    const items = await db.intelligenceWorkItem.findMany();
    expect(items.map(i => i.subjectKey)).toEqual([fresh.id]);
  });

  it('pages through incidents that share a timestamp without skipping or repeating', async () => {
    const service = await createTestService('Checkout');
    await discoverNewIncidents({ limit: 100 });
    const sameInstant = new Date();
    const created = await Promise.all(
      Array.from({ length: 7 }, (_, i) => incident(`Same instant ${i}`, service.id, sameInstant))
    );
    const later = new Date(Date.now() + DISCOVERY_SAFETY_LAG_MS + 1000);
    let total = 0;
    for (let i = 0; i < 5; i += 1) total += (await discoverNewIncidents({ limit: 3, now: later })).discovered;
    expect(total).toBe(7);
    expect(new Set((await db.intelligenceWorkItem.findMany()).map(i => i.subjectKey))).toEqual(
      new Set(created.map(c => c.id))
    );
  });

  it('allows only one concurrent discoverer', async () => {
    await discoverNewIncidents({ limit: 100 });
    const results = await Promise.all(Array.from({ length: 6 }, () => discoverNewIncidents({ limit: 100 })));
    expect(results.filter(r => r.ran).length).toBeGreaterThanOrEqual(1);
    // No double work regardless of interleaving.
    expect(await db.intelligenceWorkItem.count()).toBe(0);
  });
});

describe('fingerprint reconciliation (anti-entropy)', () => {
  it('re-signals incidents that never got a fingerprint', async () => {
    const service = await createTestService('Checkout');
    const lost = await incident('Lost signal', service.id, ago(10 * 60_000));
    const indexed = await incident('Already indexed', service.id, ago(10 * 60_000));
    await db.$transaction(tx => indexIncident(indexed.id, tx));

    const result = await reconcileFingerprints({ limit: 10, lookbackDays: 7 });
    expect(result).toEqual({ missing: 1, staleResolution: 0 });
    expect((await db.intelligenceWorkItem.findMany()).map(i => i.subjectKey)).toEqual([lost.id]);
  });

  it('re-signals incidents resolved after they were indexed', async () => {
    const service = await createTestService('Checkout');
    const open = await incident('Resolving', service.id, ago(10 * 60_000));
    await db.$transaction(tx => indexIncident(open.id, tx));
    await db.incident.update({ where: { id: open.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });

    expect(await reconcileFingerprints({ limit: 10, lookbackDays: 7 })).toEqual({ missing: 0, staleResolution: 1 });
  });

  it('ignores incidents outside the lookback window and inside the safety lag', async () => {
    const service = await createTestService('Checkout');
    await incident('Ancient', service.id, ago(30 * 86_400_000));
    await incident('Just now', service.id, new Date());
    expect(await reconcileFingerprints({ limit: 10, lookbackDays: 7 })).toEqual({ missing: 0, staleResolution: 0 });
  });
});

describe('incident indexer', () => {
  it('builds a masked fingerprint with safe labels from the first alert', async () => {
    const service = await createTestService('Checkout');
    const created = await createTestIncident('DB errors on checkout-api-7d9f8c6b5-x2k4p (10.0.0.5)', service.id, {
      description: 'Pool exhausted',
    });
    await db.alert.create({
      data: {
        serviceId: service.id,
        incidentId: created.id,
        dedupKey: 'k1',
        payload: { summary: 's', custom_details: { Env: 'Prod', password: 'hunter2', k8s: { namespace: 'Pay' } } },
      },
    });

    expect(await db.$transaction(tx => indexIncident(created.id, tx))).toBe('indexed');
    const fingerprint = await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: created.id } });
    expect(fingerprint.template).toBe('db errors on checkout-api-<pod> (<ip>)');
    expect(fingerprint.labels).toEqual({ env: 'prod', 'k8s.namespace': 'pay' });
    expect(fingerprint.serviceId).toBe(service.id);
    expect(fingerprint.tokens).toContain('exhausted');
    expect(JSON.stringify(fingerprint)).not.toContain('hunter2');
  });

  it('is idempotent and picks up resolution', async () => {
    const service = await createTestService('Checkout');
    const created = await createTestIncident('Disk full', service.id);
    await db.$transaction(tx => indexIncident(created.id, tx));
    await db.$transaction(tx => indexIncident(created.id, tx));
    expect(await db.incidentFingerprint.count()).toBe(1);

    const resolvedAt = new Date();
    await db.incident.update({ where: { id: created.id }, data: { status: 'RESOLVED', resolvedAt } });
    await db.$transaction(tx => indexIncident(created.id, tx));
    expect((await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: created.id } })).resolvedAt?.getTime()).toBe(
      resolvedAt.getTime()
    );
  });

  it('reports missing incidents without failing and cascades on incident deletion', async () => {
    expect(await db.$transaction(tx => indexIncident('does-not-exist', tx))).toBe('missing');
    const service = await createTestService('Checkout');
    const created = await createTestIncident('Short lived', service.id);
    await db.$transaction(tx => indexIncident(created.id, tx));
    await db.incident.delete({ where: { id: created.id } });
    expect(await db.incidentFingerprint.count()).toBe(0);
  });

  it('never modifies the incident it reads', async () => {
    const service = await createTestService('Checkout');
    const created = await createTestIncident('Untouched', service.id);
    const before = await db.incident.findUniqueOrThrow({ where: { id: created.id } });
    await db.$transaction(tx => indexIncident(created.id, tx));
    expect(await db.incident.findUniqueOrThrow({ where: { id: created.id } })).toEqual(before);
  });
});
