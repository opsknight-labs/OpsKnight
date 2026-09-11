import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestStatusPage,
  createTestService,
  linkServiceToStatusPage,
  createTestIncident,
} from '../helpers/test-db';
import {
  getStatusPageSnapshot,
  publishStatusPageSnapshot,
  rebuildStatusPageSnapshot,
  readStatusPageSnapshot,
} from '@/lib/status-pages/snapshot';

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

describe('durable status page projections', () => {
  beforeEach(async () => {
    await resetDatabase();
    // mockClear does not drop mockRejectedValueOnce. A leftover once-impl would make the next
    // history-loading rebuild return false with no Prisma error.
    const { loadHistoryIncidentsByService } = await import('@/lib/status-pages/history-query');
    vi.mocked(loadHistoryIncidentsByService).mockReset();
  });

  it('creates a dirty projection with the page and publishes no unmapped service', async () => {
    const page = await createTestStatusPage({ enabled: true });
    await createTestService('Internal');
    expect(await rebuildStatusPageSnapshot(page.id)).toBe(true);
    expect((await readStatusPageSnapshot(page.id))?.services).toEqual([]);
  });

  it('invalidates on source mutations and excludes internal incidents', async () => {
    const page = await createTestStatusPage({ enabled: true, showMetrics: false });
    const service = await createTestService('API');
    await linkServiceToStatusPage(page.id, service.id);
    await rebuildStatusPageSnapshot(page.id);
    const before = await readStatusPageSnapshot(page.id);
    await createTestIncident('Internal-only failure', service.id, { visibility: 'PRIVATE' });
    const rows = await testPrisma.$queryRaw<
      Array<{ revision: bigint; publishedRevision: bigint }>
    >`SELECT "revision", "publishedRevision" FROM "StatusPageSnapshot" WHERE "statusPageId" = ${page.id}`;
    expect(rows[0].revision).toBeGreaterThan(rows[0].publishedRevision);
    await rebuildStatusPageSnapshot(page.id);
    const after = await readStatusPageSnapshot(page.id);
    expect(after?.revision).not.toBe(before?.revision);
    expect(JSON.stringify(after)).not.toContain('Internal-only failure');
  });

  it('fails closed when a privacy-tightening rebuild is lock-contended', async () => {
    const page = await createTestStatusPage({ enabled: true });
    const service = await createTestService('API');
    await linkServiceToStatusPage(page.id, service.id);
    const incident = await createTestIncident('Public failure', service.id, {
      visibility: 'PUBLIC',
    });
    await rebuildStatusPageSnapshot(page.id);
    expect(JSON.stringify(await readStatusPageSnapshot(page.id))).toContain('Public failure');

    await testPrisma.incident.update({
      where: { id: incident.id },
      data: { visibility: 'PRIVATE' },
    });

    await testPrisma.$transaction(async tx => {
      const lock = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`status-snapshot:${page.id}`}, 0)) AS acquired
      `;
      expect(lock[0]?.acquired).toBe(true);
      const projected = await getStatusPageSnapshot(page.id);
      expect(projected).toEqual({ snapshot: null, stale: true, servingState: 'FAIL_CLOSED' });
    });

    expect(JSON.stringify(await readStatusPageSnapshot(page.id))).toContain('Public failure');
  });

  it('fails closed when a privacy-tightening invalidation has not been rebuilt', async () => {
    const page = await createTestStatusPage({
      enabled: true,
      showMetrics: true,
      showServiceMetrics: true,
      showUptimeHistory: true,
    });
    const service = await createTestService('API');
    await linkServiceToStatusPage(page.id, service.id);
    const incident = await createTestIncident('Sensitive failure', service.id, {
      visibility: 'PUBLIC',
    });
    await rebuildStatusPageSnapshot(page.id);
    await testPrisma.incident.update({
      where: { id: incident.id },
      data: { visibility: 'PRIVATE' },
    });

    // Dirty + still-LIVE is fail-closed. getStatusPageSnapshot does not rebuild, so a history
    // mock here would never run and would leak into later tests via mockRejectedValueOnce.
    expect(await getStatusPageSnapshot(page.id)).toEqual({
      snapshot: null,
      stale: true,
      servingState: 'FAIL_CLOSED',
    });
    expect(JSON.stringify(await readStatusPageSnapshot(page.id))).toContain('Sensitive failure');
  });

  it('does not scan historical incidents when uptime history is hidden', async () => {
    const page = await createTestStatusPage({
      enabled: true,
      showMetrics: true,
      showServiceMetrics: true,
      showUptimeHistory: false,
    });
    const service = await createTestService('API');
    await linkServiceToStatusPage(page.id, service.id);
    const { loadHistoryIncidentsByService } = await import('@/lib/status-pages/history-query');
    vi.mocked(loadHistoryIncidentsByService).mockClear();
    await rebuildStatusPageSnapshot(page.id);
    expect(loadHistoryIncidentsByService).not.toHaveBeenCalled();
  });

  it('ignores deactivated maintenance when computing current service health', async () => {
    const page = await createTestStatusPage({ enabled: true });
    const service = await createTestService('API');
    await linkServiceToStatusPage(page.id, service.id);
    await testPrisma.statusPageAnnouncement.create({
      data: {
        statusPageId: page.id,
        title: 'Withdrawn window',
        message: 'Should not affect current status',
        type: 'MAINTENANCE',
        isActive: false,
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 60_000),
        affectedServiceIds: [service.id],
      },
    });
    const outcome = await publishStatusPageSnapshot(page.id);
    expect(outcome.kind, outcome.kind === 'failed' ? String(outcome.error) : outcome.kind).toBe(
      'published'
    );
    const snapshot = await readStatusPageSnapshot(page.id);
    expect(snapshot?.services[0]?.status).toBe('OPERATIONAL');
    expect(snapshot?.status).toBe(snapshot?.overall.status);
  });
});
