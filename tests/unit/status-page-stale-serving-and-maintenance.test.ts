import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStatusPageSnapshot } from '@/lib/status-pages/snapshot';
import { notifyStatusPageSubscribers } from '@/lib/status-page-notifications';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: {
    statusPage: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    statusPageSnapshot: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    statusPageAnnouncement: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    statusPageSubscription: {
      findMany: vi.fn(),
    },
    incident: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/notification-fanout', () => ({
  beginNotificationFanout: vi.fn().mockResolvedValue({ id: 'fanout-1', cursor: null }),
  bulkQueueHasCapacity: vi.fn().mockResolvedValue(true),
  recordFanoutPage: vi.fn().mockResolvedValue(undefined),
  BulkQueueBackpressureError: class BulkQueueBackpressureError extends Error {
    constructor() {
      super('Bulk queue backpressure');
      this.name = 'BulkQueueBackpressureError';
    }
  },
}));

vi.mock('@/lib/notification-providers', () => ({
  getStatusPageEmailConfig: vi.fn().mockResolvedValue({
    enabled: true,
    provider: 'smtp',
  }),
}));

vi.mock('@/lib/notification-control-plane', () => ({
  createCentralNotificationIntentsBatch: vi.fn().mockResolvedValue({ created: 1 }),
}));

vi.mock('@/lib/status-pages/subscription-tokens', () => ({
  issueUnsubscribeTokensBatch: vi.fn().mockResolvedValue(new Map([['sub-1', 'unsub-token']])),
}));

describe('Status Page Rebuild Serving & Maintenance Suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Serving Last Good Snapshot during Rebuilds', () => {
    it('serves the last good snapshot with stale=true when a rebuild is in progress (revision mismatch)', async () => {
      const pageId = 'cmkk2vriy0005nxa3bzkz05cx';
      const mockPayload = {
        schemaVersion: 3,
        pageId,
        revision: '10',
        generatedAt: '2026-10-01T10:00:00.000Z',
        status: 'OPERATIONAL',
        historyDays: 90,
        overall: {
          status: 'OPERATIONAL',
          knownServiceCount: 1,
          unknownServiceCount: 0,
          confidence: 'complete',
          headline: 'All systems operational',
          note: null,
        },
        regions: [],
        services: [],
        incidents: [],
        announcements: [],
        maintenance: [],
        changelog: [],
        freshness: {
          generatedAt: '2026-10-01T10:00:00.000Z',
          revision: '10',
        },
        page: {
          id: pageId,
          name: 'OpsKnight',
          organizationName: 'OpsKnight',
          enabled: true,
          isDefault: true,
          requireAuth: false,
          showSubscribe: true,
          showServicesByRegion: true,
          showRegionHeatmap: true,
          showPostIncidentReview: true,
          showChangelog: true,
          enableUptimeExports: true,
          statusApiRequireToken: false,
          statusApiRateLimitEnabled: false,
          statusApiRateLimitMax: 120,
          statusApiRateLimitWindowSec: 60,
        },
      };

      // In the database: publishedRevision is 10, but revision has bumped to 11 (rebuild in flight).
      // servingState in DB is LIVE.
      vi.mocked(prisma.statusPageSnapshot.findUnique).mockResolvedValue({
        statusPageId: pageId,
        revision: BigInt(11),
        publishedRevision: BigInt(10),
        servingState: 'LIVE',
        payload: mockPayload,
        generatedAt: new Date('2026-10-01T10:00:00.000Z'),
        lastError: null,
      } as unknown as Awaited<ReturnType<typeof prisma.statusPageSnapshot.findUnique>>);

      const result = await getStatusPageSnapshot(pageId);

      // The status page must NOT be null / blank screen!
      expect(result.snapshot).not.toBeNull();
      expect(result.snapshot?.page.name).toBe('OpsKnight');
      expect(result.stale).toBe(true);
      expect(result.servingState).toBe('STALE_OK');
    });

    it('returns fail-closed only when the page servingState is explicitly FAIL_CLOSED', async () => {
      const pageId = 'page-fail-closed';
      vi.mocked(prisma.statusPageSnapshot.findUnique).mockResolvedValue({
        statusPageId: pageId,
        revision: BigInt(10),
        publishedRevision: BigInt(10),
        servingState: 'FAIL_CLOSED',
        payload: null,
        generatedAt: new Date('2026-10-01T10:00:00.000Z'),
        lastError: null,
      } as unknown as Awaited<ReturnType<typeof prisma.statusPageSnapshot.findUnique>>);

      const result = await getStatusPageSnapshot(pageId);

      expect(result.snapshot).toBeNull();
      expect(result.servingState).toBe('FAIL_CLOSED');
    });
  });

  describe('Active Maintenance Window Suppression for Incidents', () => {
    it('suppresses incident subscriber notifications when the affected service is under active maintenance', async () => {
      const incidentId = 'inc-123';
      const serviceId = 'srv-payment';
      const pageId = 'page-123';
      const now = new Date();

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        title: 'Payment Gateway Timeout',
        serviceId,
        visibility: 'PUBLIC',
        status: 'OPEN',
        createdAt: now,
        updatedAt: now,
        service: { id: serviceId, name: 'Payment' },
      } as unknown as Awaited<ReturnType<typeof prisma.incident.findUnique>>);

      vi.mocked(prisma.statusPage.findMany).mockResolvedValue([
        {
          id: pageId,
          name: 'Acme Status',
          enabled: true,
          showIncidents: true,
          organizationName: 'Acme Corp',
          services: [{ serviceId, showOnPage: true }],
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.statusPage.findMany>>);

      // Mock an active maintenance announcement that affects the payment service
      vi.mocked(prisma.statusPageAnnouncement.findFirst).mockResolvedValue({
        id: 'maint-1',
        title: 'Scheduled Payment Gateway Upgrade',
        affectedServiceIds: [serviceId],
      } as unknown as Awaited<ReturnType<typeof prisma.statusPageAnnouncement.findFirst>>);

      const result = await notifyStatusPageSubscribers(incidentId, 'investigating');

      // The notification should succeed without sending emails (skipped due to active maintenance)
      expect(result.success).toBe(true);
      expect(result.sent).toBe(0);
    });

    it('delivers incident subscriber notifications when no active maintenance window applies', async () => {
      const incidentId = 'inc-456';
      const serviceId = 'srv-database';
      const pageId = 'page-123';
      const now = new Date();

      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        title: 'Database Spike',
        serviceId,
        visibility: 'PUBLIC',
        status: 'OPEN',
        createdAt: now,
        updatedAt: now,
        service: { id: serviceId, name: 'Database' },
      } as unknown as Awaited<ReturnType<typeof prisma.incident.findUnique>>);

      vi.mocked(prisma.statusPage.findMany).mockResolvedValue([
        {
          id: pageId,
          name: 'Acme Status',
          enabled: true,
          showIncidents: true,
          organizationName: 'Acme Corp',
          services: [{ serviceId, showOnPage: true }],
        },
      ] as unknown as Awaited<ReturnType<typeof prisma.statusPage.findMany>>);

      // No active maintenance window
      vi.mocked(prisma.statusPageAnnouncement.findFirst).mockResolvedValue(null);

      // Subscriptions
      vi.mocked(prisma.statusPageSubscription.findMany)
        .mockResolvedValueOnce([
          { id: 'sub-1', email: 'user@example.com', token: 'token-1' },
        ] as unknown as Awaited<ReturnType<typeof prisma.statusPageSubscription.findMany>>)
        .mockResolvedValueOnce([]);

      const result = await notifyStatusPageSubscribers(incidentId, 'investigating');

      expect(result.success).toBe(true);
      expect(result.sent).toBe(1);
    });
  });
});
