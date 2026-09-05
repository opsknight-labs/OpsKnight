import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performDataCleanup, getStorageStats } from '@/lib/data-cleanup';

const mockPrisma = {
  incident: {
    count: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    groupBy: vi.fn(),
    findFirst: vi.fn(),
  },
  alert: {
    count: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
    findFirst: vi.fn(),
  },
  logEntry: {
    count: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
  },
  incidentEvent: {
    count: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  auditLog: {
    count: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
  },
  incidentMetricRollup: {
    count: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
  },
  inAppNotification: {
    count: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  sLAPerformanceLog: {
    count: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  incidentNote: {
    deleteMany: vi.fn(),
  },
  customFieldValue: {
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(mockPrisma)),
};

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/retention-policy', () => ({
  getRetentionPolicy: vi.fn().mockResolvedValue({
    incidentRetentionDays: 365,
    alertRetentionDays: 180,
    logRetentionDays: 365,
    metricsRetentionDays: 180,
    realTimeWindowDays: 60,
  }),
}));

vi.mock('@/lib/metric-rollup', () => ({
  cleanupOldRollups: vi.fn().mockResolvedValue(50),
}));

describe('Data Cleanup Retention Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.incident.count.mockResolvedValue(7);
    mockPrisma.alert.count.mockResolvedValue(15);
    mockPrisma.logEntry.count.mockResolvedValue(3);
    mockPrisma.incidentEvent.count.mockResolvedValue(25);
    mockPrisma.auditLog.count.mockResolvedValue(40);
    mockPrisma.incidentMetricRollup.count.mockResolvedValue(19);
    mockPrisma.inAppNotification.count.mockResolvedValue(4);
    mockPrisma.sLAPerformanceLog.count.mockResolvedValue(2);
    mockPrisma.incident.groupBy.mockResolvedValue([]);
    mockPrisma.incident.findFirst.mockResolvedValue(null);
    mockPrisma.alert.findFirst.mockResolvedValue(null);
    mockPrisma.logEntry.findFirst.mockResolvedValue(null);
    mockPrisma.auditLog.findFirst.mockResolvedValue(null);
    mockPrisma.incidentMetricRollup.findFirst.mockResolvedValue(null);
  });

  it('accurately computes metrics and notifications in dry run rather than returning 0', async () => {
    const result = await performDataCleanup(true);

    expect(result.dryRun).toBe(true);
    expect(result.incidents).toBe(7);
    expect(result.alerts).toBe(15);
    expect(result.logs).toBe(3);
    expect(result.auditLogs).toBe(40);
    expect(result.metrics).toBe(19);
    expect(result.inAppNotifications).toBe(4);
    expect(result.slaPerformanceLogs).toBe(2);
    expect(result.events).toBe(50); // 25 + 25 (eventsToDelete + incidentEventsFromIncidents)

    expect(mockPrisma.incidentMetricRollup.count).toHaveBeenCalled();
    expect(mockPrisma.inAppNotification.count).toHaveBeenCalled();
    expect(mockPrisma.sLAPerformanceLog.count).toHaveBeenCalled();
  });

  it('supports policyOverride for previewing unsaved user retention settings', async () => {
    await performDataCleanup(true, {
      incidentRetentionDays: 30,
      alertRetentionDays: 7,
      logRetentionDays: 14,
      metricsRetentionDays: 30,
    });

    const incidentWhere = mockPrisma.incident.count.mock.calls[0][0].where;
    const now = Date.now();
    const cutoffTime = incidentWhere.createdAt.lt.getTime();
    const diffDays = Math.round((now - cutoffTime) / (24 * 60 * 60 * 1000));

    expect(diffDays).toBe(30);

    const alertWhere = mockPrisma.alert.count.mock.calls[0][0].where;
    const alertDiffDays = Math.round(
      (now - alertWhere.createdAt.lt.getTime()) / (24 * 60 * 60 * 1000)
    );
    expect(alertDiffDays).toBe(7);
  });

  it('uses incidentCutoff in incident event check so incidents are not blocked by logRetentionDays', async () => {
    await performDataCleanup(true, {
      incidentRetentionDays: 60,
      logRetentionDays: 365,
    });

    const incidentWhere = mockPrisma.incident.count.mock.calls[0][0].where;
    expect(incidentWhere.status).toBe('RESOLVED');
    expect(incidentWhere.events.none.createdAt.gte).toEqual(incidentWhere.createdAt.lt);
  });

  it('includes auditLogs in getStorageStats result', async () => {
    mockPrisma.incident.count.mockResolvedValue(50);
    mockPrisma.alert.count.mockResolvedValue(36);
    mockPrisma.logEntry.count.mockResolvedValue(10);
    mockPrisma.auditLog.count.mockResolvedValue(2500);
    mockPrisma.incidentMetricRollup.count.mockResolvedValue(1600);

    const stats = await getStorageStats();

    expect(stats.incidents.total).toBe(50);
    expect(stats.alerts.total).toBe(36);
    expect(stats.logs.total).toBe(10);
    expect(stats.auditLogs.total).toBe(2500);
    expect(stats.rollups.total).toBe(1600);
    expect(mockPrisma.auditLog.count).toHaveBeenCalled();
  });

  it('cascades deletion across all incident relations before deleting incidents', async () => {
    const { cleanupOldRollups } = await import('@/lib/metric-rollup');
    const mockTx: Record<
      string,
      { deleteMany?: ReturnType<typeof vi.fn>; updateMany?: ReturnType<typeof vi.fn> }
    > = {
      externalIssueLink: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      actionItem: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      postmortem: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      incidentWatcher: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      incidentTag: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
      incidentSlaPause: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      slackPinnedMessage: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      statusPageAnnouncement: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      externalOperation: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      notificationDeliveryAttempt: { deleteMany: vi.fn().mockResolvedValue({ count: 5 }) },
      notification: { deleteMany: vi.fn().mockResolvedValue({ count: 5 }) },
      incidentEvent: { deleteMany: vi.fn().mockResolvedValue({ count: 10 }) },
      incidentNote: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      customFieldValue: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      alert: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      incident: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    mockPrisma.$transaction.mockImplementationOnce(async (cb: (tx: unknown) => unknown) =>
      cb(mockTx)
    );
    mockPrisma.incident.findMany
      .mockResolvedValueOnce([{ id: 'inc-old-1' }])
      .mockResolvedValueOnce([]);
    mockPrisma.alert.findMany.mockResolvedValue([]);
    mockPrisma.incidentEvent.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.logEntry.findMany.mockResolvedValue([]);
    mockPrisma.inAppNotification.findMany.mockResolvedValue([]);
    mockPrisma.sLAPerformanceLog.findMany.mockResolvedValue([]);

    const result = await performDataCleanup(false, {
      metricsRetentionDays: 45,
    });

    expect(result.dryRun).toBe(false);
    expect(result.incidents).toBe(1);

    // Verify all child relations were deleted
    expect(mockTx.externalIssueLink.deleteMany).toHaveBeenCalled();
    expect(mockTx.actionItem.deleteMany).toHaveBeenCalled();
    expect(mockTx.postmortem.deleteMany).toHaveBeenCalled();
    expect(mockTx.incidentWatcher.deleteMany).toHaveBeenCalled();
    expect(mockTx.incidentTag.deleteMany).toHaveBeenCalled();
    expect(mockTx.incidentSlaPause.deleteMany).toHaveBeenCalled();
    expect(mockTx.slackPinnedMessage.deleteMany).toHaveBeenCalled();
    expect(mockTx.statusPageAnnouncement.updateMany).toHaveBeenCalled();
    expect(mockTx.externalOperation.deleteMany).toHaveBeenCalled();
    expect(mockTx.notificationDeliveryAttempt.deleteMany).toHaveBeenCalled();
    expect(mockTx.notification.deleteMany).toHaveBeenCalled();
    expect(mockTx.incidentEvent.deleteMany).toHaveBeenCalled();
    expect(mockTx.incidentNote.deleteMany).toHaveBeenCalled();
    expect(mockTx.customFieldValue.deleteMany).toHaveBeenCalled();
    expect(mockTx.alert.updateMany).toHaveBeenCalled();
    expect(mockTx.incident.deleteMany).toHaveBeenCalled();

    // Verify metricsCutoff was passed to cleanupOldRollups
    expect(cleanupOldRollups).toHaveBeenCalledWith(expect.any(Date));
  });
});
