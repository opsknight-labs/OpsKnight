import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { withAbortableDbWork, withDbBudget } from '@/lib/intelligence/jobs/db-budget';
import { DISCOVERY_SAFETY_LAG_MS, reconcileUpdatedIncidents } from '@/lib/intelligence/jobs/discovery';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { purgeExpiredIntelligenceData } from '@/lib/intelligence/jobs/retention';
import {
  DEFAULT_HANDLERS,
  createLaneState,
  runIntelligenceCycle,
  type WorkHandler,
} from '@/lib/intelligence/jobs/runner';
import {
  DEAD_LETTER_REVIVE_MS,
  MAX_WORK_ATTEMPTS,
  QUARANTINE_WINDOW_MS,
  claimWorkItems,
  completeWorkItem,
  enqueueWorkItems,
  failWorkItem,
  getWorkBacklog,
  listDeadLetters,
  purgeDeadLetters,
  replayDeadLetter,
} from '@/lib/intelligence/jobs/work-queue';
import {
  publishPolicyVersion,
  type IntelligenceSettingsView,
} from '@/lib/intelligence/settings/service';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const noLag = async () => 0;
const index = (subjectKey: string) => ({ kind: 'INDEX_INCIDENT' as const, subjectKey });

async function enable(overrides: Partial<IntelligenceSettingsView> = {}) {
  await db.intelligenceSettings.create({
    data: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      maxJobMs: 60_000,
      maxDbMs: 30_000,
      enabled: true,
      ...overrides,
    },
  });
}

/** Fails `subjectKey` until it is a dead letter. */
async function killUntilDead(subjectKey: string) {
  await enqueueWorkItems([index(subjectKey)]);
  for (let attempt = 1; attempt <= MAX_WORK_ATTEMPTS; attempt += 1) {
    await db.intelligenceWorkItem.updateMany({
      where: { subjectKey },
      data: { scheduledAt: new Date(Date.now() - 1000) },
    });
    const [claimed] = await claimWorkItems({ limit: 1 });
    expect(claimed?.subjectKey).toBe(subjectKey);
    await failWorkItem(claimed, new Error('always fails'));
  }
  return db.intelligenceWorkItem.findFirstOrThrow({ where: { subjectKey } });
}

describe('poison work quarantine', () => {
  it('quarantines work that dies twice within a day, never revives it on its own, and lets an operator replay it', async () => {
    const first = await killUntilDead('poison');
    expect(first.failedAt).not.toBeNull();
    expect(first.quarantinedAt).toBeNull();

    // The cool-down passes and the subject is signalled again: one more round of attempts.
    await db.intelligenceWorkItem.updateMany({
      data: { failedAt: new Date(Date.now() - DEAD_LETTER_REVIVE_MS - 1000) },
    });
    await enqueueWorkItems([index('poison')]);
    const second = await killUntilDead('poison');
    expect(second.quarantinedAt).not.toBeNull();
    expect(await getWorkBacklog()).toMatchObject({ deadLetters: 1, quarantined: 1, ready: 0 });
    expect((await listDeadLetters())[0]).toMatchObject({ subjectKey: 'poison', quarantined: true });

    // Neither another signal after the cool-down nor retention touches it.
    await db.intelligenceWorkItem.updateMany({
      data: { failedAt: new Date(Date.now() - DEAD_LETTER_REVIVE_MS - 1000) },
    });
    await enqueueWorkItems([index('poison')]);
    expect(await claimWorkItems({ limit: 1 })).toHaveLength(0);
    expect(await purgeDeadLetters(0, 100)).toBe(0);
    expect(await db.intelligenceWorkItem.count()).toBe(1);

    const [dead] = await listDeadLetters();
    expect(await replayDeadLetter(dead.id)).toBe(true);
    expect(await db.intelligenceWorkItem.findFirstOrThrow()).toMatchObject({
      attempts: 0,
      failedAt: null,
      quarantinedAt: null,
    });
    expect(await claimWorkItems({ limit: 1 })).toHaveLength(1);
  });

  it('treats a second death more than a day after the first as a new outage, not poison', async () => {
    await killUntilDead('flaky');
    await db.intelligenceWorkItem.updateMany({
      data: { failedAt: new Date(Date.now() - QUARANTINE_WINDOW_MS - 60_000) },
    });
    await enqueueWorkItems([index('flaky')]);
    const again = await killUntilDead('flaky');
    expect(again.quarantinedAt).toBeNull();
  });
});

describe('claiming by kind', () => {
  it('leaves excluded kinds in the queue', async () => {
    await enqueueWorkItems([index('a'), { kind: 'ANALYZE_INCIDENT', subjectKey: 'b' }]);
    const claimed = await claimWorkItems({ limit: 5, excludeKinds: ['INDEX_INCIDENT'] });
    expect(claimed.map(item => item.subjectKey)).toEqual(['b']);
    expect((await claimWorkItems({ limit: 5 })).map(item => item.subjectKey)).toEqual(['a']);
  });

  it('keeps a deliberately future schedule when a signal arrives mid-run', async () => {
    await enqueueWorkItems([index('wait')]);
    const [claimed] = await claimWorkItems({ limit: 1 });
    await enqueueWorkItems([index('wait')]);
    const due = new Date(Date.now() + 60_000);
    await db.intelligenceWorkItem.updateMany({ data: { scheduledAt: due } });
    expect(await completeWorkItem(claimed)).toBe('requeued');
    expect((await db.intelligenceWorkItem.findFirstOrThrow()).scheduledAt.getTime()).toBe(
      due.getTime()
    );
    expect(await claimWorkItems({ limit: 1 })).toHaveLength(0);
  });
});

describe('budgeted work is really cancelled', () => {
  it('cancels the statement running inside a budgeted transaction when the handler is aborted', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const work = withAbortableDbWork(controller.signal, () =>
      withDbBudget({ maxDbMs: 20_000 }, async tx => {
        await tx.$executeRaw`SELECT pg_sleep(15)`;
      })
    );
    setTimeout(() => controller.abort(), 200);
    await expect(work).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('refuses to start budgeted work for a handler that was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withAbortableDbWork(controller.signal, () =>
        withDbBudget({ maxDbMs: 1000 }, async () => 'ran')
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('lane concurrency under timeouts and failing handlers', () => {
  it('keeps a timed-out handler counted against concurrency and defers new work until it lets go', async () => {
    await enable({ maxConcurrency: 1, maxJobMs: 100, maxDbMs: 100, batchSize: 10 });
    await enqueueWorkItems([index('slow')]);
    let release: (() => void) | undefined;
    const handlers: Record<string, WorkHandler> = {
      INDEX_INCIDENT: async item => {
        if (item.subjectKey === 'slow')
          await new Promise<void>(resolve => {
            release = resolve;
          });
      },
    };
    const state = createLaneState();
    const first = await runIntelligenceCycle(state, { getCriticalLagMs: noLag, handlers });
    expect(first).toMatchObject({ failed: 1, timedOut: 1, saturated: false });

    await enqueueWorkItems([index('next')]);
    const saturated = await runIntelligenceCycle(state, { getCriticalLagMs: noLag, handlers });
    expect(saturated).toMatchObject({ status: 'idle', claimed: 0, saturated: true, timedOut: 1 });

    release?.();
    await new Promise(resolve => setTimeout(resolve, 10));
    const resumed = await runIntelligenceCycle(state, { getCriticalLagMs: noLag, handlers });
    expect(resumed).toMatchObject({ saturated: false, timedOut: 0, completed: 1 });
  });

  it('pauses a kind whose handler keeps failing while other kinds keep flowing, then retries it later', async () => {
    await enable({ maxConcurrency: 2, batchSize: 20 });
    await enqueueWorkItems([
      ...Array.from({ length: 6 }, (_, i) => index(`bad-${i}`)),
      { kind: 'ANALYZE_INCIDENT', subjectKey: 'good' },
    ]);
    let clock = Date.now();
    const handlers: Record<string, WorkHandler> = {
      INDEX_INCIDENT: async () => {
        throw new Error('bad deploy');
      },
      ANALYZE_INCIDENT: async () => {},
    };
    const state = createLaneState();
    const deps = { getCriticalLagMs: noLag, handlers, now: () => clock };
    const tripped = await runIntelligenceCycle(state, deps);
    expect(tripped).toMatchObject({ failed: 6, completed: 1 });
    expect(tripped.pausedKinds).toEqual(['INDEX_INCIDENT']);

    await db.intelligenceWorkItem.updateMany({ data: { scheduledAt: new Date(Date.now() - 1000) } });
    await enqueueWorkItems([{ kind: 'ANALYZE_INCIDENT', subjectKey: 'still-good' }]);
    const skipping = await runIntelligenceCycle(state, deps);
    expect(skipping).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
    expect(skipping.pausedKinds).toEqual(['INDEX_INCIDENT']);

    clock += 6 * 60_000;
    await db.intelligenceWorkItem.updateMany({ data: { scheduledAt: new Date(Date.now() - 1000) } });
    const retried = await runIntelligenceCycle(state, deps);
    expect(retried.claimed).toBe(6);
    expect(retried.failed).toBe(6);
  });
});

describe('retention that always makes progress', () => {
  const retention = {
    ...INTELLIGENCE_SETTINGS_DEFAULTS,
    maxDbMs: 5000,
  };

  it('drains the alert fingerprints of expired incidents in bounded bites before removing the parent', async () => {
    const service = await createTestService('Expired');
    const incident = await createTestIncident('Old storm', service.id, {
      createdAt: new Date(Date.now() - 800 * 86_400_000),
    });
    await db.alert.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        incidentId: incident.id,
        serviceId: service.id,
        payload: { summary: 'Old storm', custom_details: { shard: String(i) } },
      })),
    });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    expect(await db.alertFingerprint.count()).toBe(30);

    const first = await purgeExpiredIntelligenceData(retention, { batchSize: 1 });
    expect(first).toMatchObject({ alertFingerprints: 10, fingerprints: 0, more: true, failedTables: [] });
    expect(await db.incidentFingerprint.count()).toBe(1);
    const second = await purgeExpiredIntelligenceData(retention, { batchSize: 1 });
    expect(second).toMatchObject({ alertFingerprints: 10, fingerprints: 0 });
    // The sweep that drains the last alert rows also removes the parent, with nothing left to cascade.
    const third = await purgeExpiredIntelligenceData(retention, { batchSize: 1 });
    expect(third).toMatchObject({ alertFingerprints: 10, fingerprints: 1 });
    expect(await db.alertFingerprint.count()).toBe(0);
    expect(await db.incidentFingerprint.count()).toBe(0);
  });

  it('lets one sweeper at a time hold the lease, through the database rather than a long transaction', async () => {
    await db.intelligenceCursor.create({
      data: {
        name: 'intelligence-retention-lease',
        watermarkAt: new Date(Date.now() + 60_000),
        lastId: 'another-replica',
      },
    });
    const skipped = await purgeExpiredIntelligenceData(retention, { batchSize: 10 });
    expect(skipped).toMatchObject({ fingerprints: 0, more: false, failedTables: [] });
    await db.intelligenceCursor.update({
      where: { name: 'intelligence-retention-lease' },
      data: { watermarkAt: new Date(Date.now() - 1000) },
    });
    await purgeExpiredIntelligenceData(retention, { batchSize: 10 });
    // The lease is released as soon as the sweep ends.
    const lease = await db.intelligenceCursor.findUniqueOrThrow({
      where: { name: 'intelligence-retention-lease' },
    });
    expect(lease.watermarkAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(lease.lastId).not.toBe('another-replica');
  });
});

describe('lost-signal repair in O(changes)', () => {
  it('re-indexes an incident whose update was never signalled, however old the incident is', async () => {
    const service = await createTestService('Ancient');
    const incident = await createTestIncident('Ancient outage', service.id, {
      createdAt: new Date(Date.now() - 400 * 86_400_000),
    });
    await db.$transaction(tx => indexIncident(incident.id, tx));
    expect(await reconcileUpdatedIncidents({ limit: 10 })).toMatchObject({ scanned: 0 });

    await db.incident.update({ where: { id: incident.id }, data: { title: 'Ancient outage, edited' } });
    const later = new Date(Date.now() + DISCOVERY_SAFETY_LAG_MS + 1000);
    expect(await reconcileUpdatedIncidents({ limit: 10, now: later })).toMatchObject({
      scanned: 1,
      staleSource: 1,
    });
    expect(await db.intelligenceWorkItem.findMany()).toMatchObject([
      { kind: 'INDEX_INCIDENT', subjectKey: incident.id },
    ]);
    // The watermark advanced: nothing is scanned twice.
    expect(await reconcileUpdatedIncidents({ limit: 10, now: later })).toMatchObject({ scanned: 0 });
  });
});

describe('policy publication', () => {
  it('re-indexes the open incidents of the scope so the new policy applies without waiting for a change', async () => {
    await enable();
    const admin = await createTestUser({ role: 'ADMIN' });
    const service = await createTestService('Scoped');
    const open = await createTestIncident('Open one', service.id);
    const acked = await createTestIncident('Acked one', service.id, { status: 'ACKNOWLEDGED' });
    await createTestIncident('Resolved one', service.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
    });
    await publishPolicyVersion(
      {},
      { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      { actorId: admin.id, source: 'UI' }
    );
    const queued = await db.intelligenceWorkItem.findMany({ orderBy: { subjectKey: 'asc' } });
    expect(queued.map(item => [item.kind, item.subjectKey])).toEqual(
      [open.id, acked.id].sort().map(id => ['INDEX_INCIDENT', id])
    );
  });
});

describe('very large incidents', () => {
  it('bootstraps a 12k-alert incident over bounded passes that re-signal themselves, then analyses once complete', async () => {
    await enable();
    const admin = await createTestUser({ role: 'ADMIN' });
    await publishPolicyVersion(
      {},
      { mode: 'SHADOW', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      { actorId: admin.id, source: 'UI' }
    );
    const service = await createTestService('Huge');
    const incident = await createTestIncident('Huge storm', service.id);
    const at = Date.now() - 600_000;
    for (let chunk = 0; chunk < 12; chunk += 1) {
      await db.alert.createMany({
        data: Array.from({ length: 1000 }, (_, i) => ({
          id: `huge-${chunk}-${i.toString().padStart(4, '0')}`,
          incidentId: incident.id,
          serviceId: service.id,
          createdAt: new Date(at + chunk * 1000 + i),
          payload: { summary: 'Huge storm', custom_details: { shard: String(chunk) } },
        })),
      });
    }
    await enqueueWorkItems([index(incident.id)]);
    const settings = { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1, enabled: true, maxDbMs: 30_000 };
    const run = async () => {
      const [claimed] = await claimWorkItems({ limit: 1, leaseMs: 60_000 });
      expect(claimed?.subjectKey).toBe(incident.id);
      await DEFAULT_HANDLERS.INDEX_INCIDENT!(claimed, {
        settings,
        signal: new AbortController().signal,
      });
      return completeWorkItem(claimed);
    };
    // Two bounded passes save progress and re-signal the same item; the third completes and chains work.
    expect(await run()).toBe('requeued');
    expect(
      await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: incident.id } })
    ).toMatchObject({ alertIndexPartial: true, analysisInputHash: null, indexedAlertCount: 5000 });
    expect(await db.intelligenceWorkItem.count()).toBe(1);
    expect(await run()).toBe('requeued');
    expect(await run()).toBe('completed');
    const done = await db.incidentFingerprint.findUniqueOrThrow({
      where: { incidentId: incident.id },
    });
    expect(done.alertIndexPartial).toBe(false);
    expect(done.analysisInputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(done.indexedAlertCount).toBe(12_000);
    expect(await db.alertFingerprint.count({ where: { incidentId: incident.id } })).toBe(12_000);
    expect(Object.keys(done.labels as Record<string, string>)).toEqual(['shard']);
    expect(
      (await db.intelligenceWorkItem.findMany({ orderBy: { priority: 'asc' } })).map(i => i.kind)
    ).toEqual(['ANALYZE_INCIDENT', 'ANALYZE_RESPONSE']);
  }, 120_000);
});
