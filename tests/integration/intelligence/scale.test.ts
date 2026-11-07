import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_ENGINE_VERSION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { declareDependency, loadActiveEdges } from '@/lib/intelligence/dependencies/service';
import {
  claimWorkItems,
  enqueueWorkItems,
  getWorkBacklog,
  resetWorkBacklogCacheForTests,
  WORK_BACKLOG_CACHE_MS,
} from '@/lib/intelligence/jobs/work-queue';
import {
  publishPolicyVersion,
  withIntelligenceReadMemo,
} from '@/lib/intelligence/settings/service';
import {
  EMBED_BATCH_SIZE,
  EMBED_SCAN_PAGE,
  findIncidentsToEmbedPage,
} from '@/lib/intelligence/semantic/embedder';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  resetWorkBacklogCacheForTests();
});

describe('backlog aggregate caching', () => {
  it('serves scrapes from one recent aggregate per process while operators always read fresh', async () => {
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: 'a' }]);
    const t0 = Date.now();
    expect(
      await getWorkBacklog(undefined, undefined, { maxAgeMs: WORK_BACKLOG_CACHE_MS, now: t0 })
    ).toMatchObject({ ready: 1 });
    await enqueueWorkItems([{ kind: 'INDEX_INCIDENT', subjectKey: 'b' }]);
    // Within the window the scrape sees the cached answer; a fresh read sees both items.
    expect(
      await getWorkBacklog(undefined, undefined, {
        maxAgeMs: WORK_BACKLOG_CACHE_MS,
        now: t0 + 1000,
      })
    ).toMatchObject({ ready: 1 });
    expect(await getWorkBacklog()).toMatchObject({ ready: 2 });
    expect(
      await getWorkBacklog(undefined, undefined, {
        maxAgeMs: WORK_BACKLOG_CACHE_MS,
        now: t0 + WORK_BACKLOG_CACHE_MS + 1,
      })
    ).toMatchObject({ ready: 2 });
  });
});

describe('semantic backfill paging', () => {
  async function enableWithPolicy() {
    const admin = await createTestUser({ role: 'ADMIN' });
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    await publishPolicyVersion(
      {},
      { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      { actorId: admin.id, source: 'UI' }
    );
  }

  it('walks the lookback window in bounded pages behind a cursor and restarts once exhausted', async () => {
    await enableWithPolicy();
    const service = await createTestService('Paged');
    const total = EMBED_SCAN_PAGE + 40;
    const base = Date.now() - 3_600_000;
    await db.incident.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        id: `paged-${i.toString().padStart(5, '0')}`,
        title: `Paged incident ${i}`,
        serviceId: service.id,
        status: 'OPEN' as const,
        urgency: 'LOW' as const,
        createdAt: new Date(base + i),
        updatedAt: new Date(base + i),
      })),
    });
    await db.$executeRaw`
      INSERT INTO "IncidentFingerprint" ("incidentId", "serviceId", "template", "templateHash", "tokens", "labels",
        "engineVersion", "incidentCreatedAt", "sourceUpdatedAt", "updatedAt")
      SELECT i.id, i."serviceId", 'paged incident <num>', 'h' || i.id, ARRAY['paged', 'incident'], '{}'::jsonb,
        ${INTELLIGENCE_ENGINE_VERSION}, i."createdAt", i."updatedAt", now()
      FROM "Incident" i WHERE i.id LIKE 'paged-%'`;

    const first = await findIncidentsToEmbedPage('model-x');
    expect(first.more).toBe(true);
    expect(first.ids).toHaveLength(EMBED_BATCH_SIZE);
    // Newest first: the page covers the newest 5,000 and the cursor points at its oldest row.
    expect(first.ids[0]).toBe(`paged-${(total - 1).toString().padStart(5, '0')}`);
    const cursor = await db.intelligenceCursor.findUniqueOrThrow({
      where: { name: 'embed:model-x' },
    });
    expect(cursor.lastId).toBe(`paged-${(total - EMBED_SCAN_PAGE).toString().padStart(5, '0')}`);

    const second = await findIncidentsToEmbedPage('model-x');
    expect(second.more).toBe(false);
    expect(second.ids).toHaveLength(40);
    expect(await db.intelligenceCursor.findUnique({ where: { name: 'embed:model-x' } })).toBeNull();

    // Exhausted: the next pass starts again from the newest incident.
    const third = await findIncidentsToEmbedPage('model-x');
    expect(third.more).toBe(true);
    expect(third.ids[0]).toBe(first.ids[0]);
  }, 60_000);

  it('finds nothing and keeps no cursor for a service whose policy is OFF', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
    });
    await publishPolicyVersion(
      {},
      { mode: 'OFF', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
      { actorId: admin.id, source: 'UI' }
    );
    const service = await createTestService('Off');
    const incident = await db.incident.create({
      data: { title: 'Off incident', serviceId: service.id, urgency: 'LOW' },
    });
    await db.$executeRaw`
      INSERT INTO "IncidentFingerprint" ("incidentId", "serviceId", "template", "templateHash", "tokens", "labels",
        "engineVersion", "incidentCreatedAt", "sourceUpdatedAt", "updatedAt")
      VALUES (${incident.id}, ${service.id}, 'off incident', 'h-off', ARRAY['off'], '{}'::jsonb,
        ${INTELLIGENCE_ENGINE_VERSION}, ${incident.createdAt}, ${incident.updatedAt}, now())`;
    expect(await findIncidentsToEmbedPage('model-x')).toEqual({ ids: [], more: false });
    expect(await db.intelligenceCursor.count()).toBe(0);
  });
});

describe('topology reads at scale', () => {
  it('orders active edges by recency and keeps rejected edges outside the cap', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = { actorId: admin.id, source: 'UI' as const };
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(name => createTestService(name)));
    await declareDependency({ upstreamServiceId: a.id, downstreamServiceId: b.id }, actor);
    await declareDependency({ upstreamServiceId: b.id, downstreamServiceId: c.id }, actor);
    await db.serviceDependency.updateMany({
      where: { upstreamServiceId: a.id },
      data: { updatedAt: new Date(Date.now() - 86_400_000) },
    });
    await db.serviceDependency.create({
      data: {
        upstreamServiceId: c.id,
        downstreamServiceId: a.id,
        origin: 'OBSERVED',
        status: 'REJECTED',
        confidence: 0.5,
        evidence: {},
      },
    });
    const edges = await withIntelligenceReadMemo(() => loadActiveEdges());
    expect(edges.map(edge => edge.upstreamServiceId)).toEqual([b.id, a.id]);
    // A claim never hands out excluded kinds, whatever their priority.
    await enqueueWorkItems([
      { kind: 'ANALYZE_INCIDENT', subjectKey: 'x', priority: 0 },
      { kind: 'INDEX_INCIDENT', subjectKey: 'y' },
    ]);
    expect(
      (await claimWorkItems({ limit: 5, excludeKinds: ['ANALYZE_INCIDENT'] })).map(i => i.kind)
    ).toEqual(['INDEX_INCIDENT']);
  });
});
