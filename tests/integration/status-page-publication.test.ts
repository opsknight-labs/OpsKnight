import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestStatusPage,
  createTestService,
  linkServiceToStatusPage,
} from '../helpers/test-db';
import {
  getStatusPageSnapshot,
  publishStatusPageSnapshot,
  rebuildStatusPageSnapshot,
  reconcileStatusPageSnapshots,
} from '@/lib/status-pages/snapshot';
import { applyStatusPageConfigurationChange } from '@/lib/status-pages/publish-configuration';
import * as servingStore from '@/lib/status-pages/serving-store';
import { reconcileStatusPageRouteOperations } from '@/lib/status-pages/route-operations';

vi.mock('@/lib/sla-server', () => ({ calculateMultiServiceUptime: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/status-pages/history-query', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/status-pages/history-query')>();
  return {
    ...actual,
    loadHistoryIncidentsByService: vi.fn(
      (...args: Parameters<typeof actual.loadHistoryIncidentsByService>) =>
        actual.loadHistoryIncidentsByService(...args)
    ),
  };
});
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn().mockResolvedValue(undefined) }));

const actor = { id: 'user-1', email: 'admin@example.com', name: 'Admin' };

async function livePage(overrides: Parameters<typeof createTestStatusPage>[0] = {}) {
  const page = await createTestStatusPage({ enabled: true, ...overrides });
  const service = await createTestService('Checkout API');
  await linkServiceToStatusPage(page.id, service.id);
  expect(await rebuildStatusPageSnapshot(page.id)).toBe(true);
  const projected = await getStatusPageSnapshot(page.id);
  expect(projected.snapshot).not.toBeNull();
  return { page: await testPrisma.statusPage.findUniqueOrThrow({ where: { id: page.id } }) };
}

/**
 * Records store calls made by production code.
 *
 * The factory constructs a new instance on every call, so spying on an instance obtained in a
 * test observes nothing; the factory itself has to be intercepted.
 */
function trackStoreCalls() {
  const real = servingStore.getStatusPageServingStore();
  const revoke = vi.fn((pageId: string, reason: Parameters<typeof real.revoke>[1]) =>
    real.revoke(pageId, reason)
  );
  const removeRoute = vi.fn((routeKey: string, expectedPageId: string) =>
    real.removeRoute(routeKey, expectedPageId)
  );
  vi.spyOn(servingStore, 'getStatusPageServingStore').mockImplementation(
    () => ({ ...bindStore(real), revoke, removeRoute }) as typeof real
  );
  return { revoke, removeRoute };
}

function bindStore(real: servingStore.StatusPageServingStore) {
  return {
    publishRoute: real.publishRoute.bind(real),
    removeRoute: real.removeRoute.bind(real),
    resolveRoute: real.resolveRoute.bind(real),
    publishManifest: real.publishManifest.bind(real),
    publishSnapshot: real.publishSnapshot.bind(real),
    readManifest: real.readManifest.bind(real),
    readSnapshot: real.readSnapshot.bind(real),
    readLastGoodSnapshot: real.readLastGoodSnapshot.bind(real),
    revoke: real.revoke.bind(real),
  };
}

const servingState = async (pageId: string) =>
  (
    await testPrisma.$queryRaw<Array<{ servingState: string }>>`
      SELECT "servingState" FROM "StatusPageSnapshot" WHERE "statusPageId" = ${pageId}
    `
  )[0]?.servingState;

describe('status page publication lifecycle', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDatabase();
  });

  it('keeps a branding-only save live throughout and never revokes', async () => {
    // The regression this commit exists for: a colour change used to take /status dark until the
    // background projector caught up.
    const { page } = await livePage();
    const { revoke } = trackStoreCalls();

    const result = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { branding: { primaryColor: '#ff0000' } },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });

    expect(result.classification.dominant).toBe('PRESENTATION');
    expect(result.classification.failClosed).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    expect(result.publication.status).toBe('LIVE');
    const after = await getStatusPageSnapshot(page.id);
    expect(after.snapshot).not.toBeNull();
    expect(after.stale).toBe(false);
  });

  it('does not touch a working page when the patch changes nothing', async () => {
    const { page } = await livePage();
    const before = await servingState(page.id);

    const result = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { organizationName: page.organizationName },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });

    expect(result.classification.classes).toEqual([]);
    expect(result.updatedAt).toBe(page.updatedAt.toISOString());
    expect(await servingState(page.id)).toBe(before);
    expect((await getStatusPageSnapshot(page.id)).snapshot).not.toBeNull();
  });

  it('does not hold a long transaction while another bounded snapshot build owns the lease', async () => {
    const { page } = await livePage();
    await testPrisma.statusPageSnapshot.update({
      where: { statusPageId: page.id },
      data: {
        buildLeaseToken: 'another-projector',
        buildLeaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    // A busy build is contention, not a failed publication; the caller must leave the current
    // immutable snapshot alone and let the lease owner finish its bounded read phase.
    await expect(rebuildStatusPageSnapshot(page.id)).resolves.toBe(false);
    await expect(
      testPrisma.statusPageSnapshot.findUniqueOrThrow({ where: { statusPageId: page.id } })
    ).resolves.toMatchObject({ buildLeaseToken: 'another-projector' });
  });

  it('records a serving-store failure so reconciliation retries it immediately', async () => {
    const { page } = await livePage();
    const real = servingStore.getStatusPageServingStore();
    vi.spyOn(servingStore, 'getStatusPageServingStore').mockImplementation(
      () =>
        ({
          ...bindStore(real),
          publishSnapshot: vi.fn().mockRejectedValue(new Error('serving store unavailable')),
        }) as typeof real
    );

    await expect(publishStatusPageSnapshot(page.id)).resolves.toMatchObject({ kind: 'failed' });
    await expect(
      testPrisma.statusPageSnapshot.findUniqueOrThrow({ where: { statusPageId: page.id } })
    ).resolves.toMatchObject({ lastError: 'serving store unavailable' });

    vi.restoreAllMocks();
    await expect(reconcileStatusPageSnapshots(1)).resolves.toEqual({ attempted: 1, rebuilt: 1 });
  });

  it('withdraws the projection before writing a privacy tightening, then republishes', async () => {
    const { page } = await livePage();
    const { revoke } = trackStoreCalls();

    const result = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { requireAuth: true },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });

    expect(result.classification.dominant).toBe('PRIVACY_TIGHTENING');
    expect(revoke).toHaveBeenCalledWith(page.id, 'PRIVACY');
    expect(result.publication.status).toBe('LIVE');
    const after = await getStatusPageSnapshot(page.id);
    expect(after.snapshot?.page.requireAuth).toBe(true);
  });

  it('restores serving when a tightening save loses the concurrency race', async () => {
    // The page was already withdrawn when the write failed, so without compensation it would stay
    // dark despite nothing having changed.
    const { page } = await livePage();

    await expect(
      applyStatusPageConfigurationChange({
        pageId: page.id,
        actor,
        patch: { requireAuth: true },
        expectedUpdatedAt: new Date(page.updatedAt.getTime() - 60_000).toISOString(),
      })
    ).rejects.toThrow();

    const reloaded = await testPrisma.statusPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(reloaded.requireAuth).toBe(false);
    expect((await getStatusPageSnapshot(page.id)).snapshot).not.toBeNull();
  });

  it('reports a failed publication and keeps serving the previous projection', async () => {
    const { page } = await livePage();
    const { loadHistoryIncidentsByService } = await import('@/lib/status-pages/history-query');
    vi.mocked(loadHistoryIncidentsByService).mockRejectedValueOnce(
      new Error('uptime backend down')
    );

    const result = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { branding: { primaryColor: '#00ff00' } },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });

    expect(result.publication.status).toBe('FAILED');
    expect(result.publication.lastError).toBeTruthy();
    // Nothing was retracted, so the previous body stays servable and the visitor still sees
    // status rather than an error page.
    expect(await servingState(page.id)).toBe('STALE_OK');
    const after = await getStatusPageSnapshot(page.id);
    expect(after.snapshot).not.toBeNull();
    expect(after.stale).toBe(true);
  });

  it('keeps a failed privacy tightening dark', async () => {
    const { page } = await livePage();
    const { loadHistoryIncidentsByService } = await import('@/lib/status-pages/history-query');
    vi.mocked(loadHistoryIncidentsByService).mockRejectedValueOnce(
      new Error('uptime backend down')
    );

    const result = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { showIncidentTitles: false },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });

    expect(result.classification.dominant).toBe('PRIVACY_TIGHTENING');
    expect(result.publication.status).toBe('FAILED');
    expect(await servingState(page.id)).toBe('FAIL_CLOSED');
    expect((await getStatusPageSnapshot(page.id)).snapshot).toBeNull();
  });

  it('disables and re-enables a page', async () => {
    const { page } = await livePage();

    const disabled = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { enabled: false },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });
    expect(disabled.classification.dominant).toBe('DISABLE');
    expect(disabled.publication.status).toBe('DISABLED');
    expect((await getStatusPageSnapshot(page.id)).snapshot).toBeNull();

    const reloaded = await testPrisma.statusPage.findUniqueOrThrow({ where: { id: page.id } });
    const enabled = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { enabled: true },
      expectedUpdatedAt: reloaded.updatedAt.toISOString(),
    });

    expect(enabled.classification.dominant).toBe('ENABLE');
    // An administrator clicking Enable must not be told "saved" while /status is unusable.
    expect(enabled.publication.status).toBe('LIVE');
    expect((await getStatusPageSnapshot(page.id)).snapshot).not.toBeNull();
  });

  it('publishes the new route before removing the old one on a slug rename', async () => {
    const { page } = await livePage();
    const store = servingStore.getStatusPageServingStore();
    const { removeRoute } = trackStoreCalls();

    const result = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { slug: 'renamed-status' },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });

    expect(result.classification.dominant).toBe('ROUTING');
    expect(result.publication.status).toBe('LIVE');
    expect(await store.resolveRoute('renamed-status')).toMatchObject({ pageId: page.id });
    if (removeRoute.mock.calls.length > 0) {
      expect(removeRoute).toHaveBeenCalledWith(page.slug, page.id);
    }
  });

  it('leaves both routes live when the new one cannot be verified', async () => {
    const { page } = await livePage();
    const real = servingStore.getStatusPageServingStore();
    const removeRoute = vi.fn();
    vi.spyOn(servingStore, 'getStatusPageServingStore').mockImplementation(
      () =>
        ({
          ...bindStore(real),
          resolveRoute: vi.fn().mockResolvedValue(null),
          removeRoute,
        }) as typeof real
    );

    const result = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { slug: 'unverifiable' },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });

    expect(result.publication.status).toBe('FAILED');
    expect(result.publication.lastError).toContain('does not resolve');
    // Nothing removed: two working addresses beats none.
    expect(removeRoute).not.toHaveBeenCalled();
  });

  it('durably retries an old-route removal after the serving store fails', async () => {
    const { page } = await livePage({ slug: 'original-route' });
    const real = servingStore.getStatusPageServingStore();
    const removeRoute = vi.fn().mockRejectedValue(new Error('route store unavailable'));
    vi.spyOn(servingStore, 'getStatusPageServingStore').mockImplementation(
      () => ({ ...bindStore(real), removeRoute }) as typeof real
    );

    const result = await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { slug: 'durable-route' },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });

    expect(result.publication.status).toBe('FAILED');
    const pending = await testPrisma.statusPageRouteOperation.findFirstOrThrow({
      where: { statusPageId: page.id, operation: 'REMOVE' },
    });
    expect(pending).toMatchObject({ state: 'FAILED', attempts: 1 });

    await testPrisma.statusPageRouteOperation.update({
      where: { id: pending.id },
      data: { nextAttemptAt: new Date(0) },
    });
    removeRoute.mockImplementation((routeKey: string, expectedPageId: string) =>
      real.removeRoute(routeKey, expectedPageId)
    );
    await expect(reconcileStatusPageRouteOperations(10, page.id)).resolves.toMatchObject({
      completed: 1,
    });
    await expect(
      testPrisma.statusPageRouteOperation.findUniqueOrThrow({ where: { id: pending.id } })
    ).resolves.toMatchObject({ state: 'COMPLETE', attempts: 2, lastError: null });
  });

  it('withholds the previous body when a disclosure was narrowed, though it is still stored', async () => {
    // Fail-closed is decided by the marker, not by whether a body exists: it does exist here.
    const { page } = await livePage();
    const { loadHistoryIncidentsByService } = await import('@/lib/status-pages/history-query');
    vi.mocked(loadHistoryIncidentsByService).mockRejectedValueOnce(
      new Error('uptime backend down')
    );

    await applyStatusPageConfigurationChange({
      pageId: page.id,
      actor,
      patch: { showServiceDescriptions: false },
      expectedUpdatedAt: page.updatedAt.toISOString(),
    });

    expect(await servingState(page.id)).toBe('FAIL_CLOSED');
    const stored = await testPrisma.$queryRaw<Array<{ kept: boolean }>>`
      SELECT "payload" IS NOT NULL AS "kept" FROM "StatusPageSnapshot"
       WHERE "statusPageId" = ${page.id}
    `;
    expect(stored[0].kept).toBe(true);
    expect((await getStatusPageSnapshot(page.id)).snapshot).toBeNull();
  });
});
