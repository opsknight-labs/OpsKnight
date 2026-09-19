import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performDataCleanup } from '@/lib/data-cleanup';

// Mock dependencies
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    incident: {
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    alert: {
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    logEntry: {
      count: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
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
    },
    incidentNote: {
      deleteMany: vi.fn(),
    },
    customFieldValue: {
      deleteMany: vi.fn(),
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
    incidentMetricRollup: {
      count: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 5 }),
    },
    dataRetentionHold: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    privacyRequest: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    privacyExportArtifact: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    statusPageSubscription: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    $transaction: vi.fn(async (callback: (tx: any) => unknown) => callback(mockPrisma)),
  };
  return { mockPrisma };
});

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/retention-policy', () => ({
  getRetentionPolicy: vi.fn().mockResolvedValue({
    incidentRetentionDays: 30,
    alertRetentionDays: 7,
    logRetentionDays: 90,
    metricsRetentionDays: 365,
    realTimeWindowDays: 90,
    completedPrivacyRequestRetentionDays: 730,
    expiredPrivacyArtifactRetentionDays: 30,
    unsubscribedSubscriberRetentionDays: 30,
  }),
}));

vi.mock('@/lib/metric-rollup', () => ({
  cleanupOldRollups: vi.fn().mockResolvedValue(100),
}));

describe('Data Cleanup Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default counts
    mockPrisma.incident.findMany.mockResolvedValue([
      { id: 'inc-1' },
      { id: 'inc-2' },
      { id: 'inc-3' },
      { id: 'inc-4' },
      { id: 'inc-5' },
    ]);
    mockPrisma.alert.count.mockResolvedValue(10);
    mockPrisma.logEntry.count.mockResolvedValue(20);
    mockPrisma.incidentEvent.count.mockResolvedValue(0);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    mockPrisma.dataRetentionHold.findMany.mockResolvedValue([]);
    mockPrisma.privacyRequest.findMany.mockResolvedValue([]);
    mockPrisma.privacyExportArtifact.findMany.mockResolvedValue([]);
    mockPrisma.statusPageSubscription.findMany.mockResolvedValue([]);
  });

  it('should respect dryRun flag and NOT delete data', async () => {
    const result = await performDataCleanup(true);

    expect(result.dryRun).toBe(true);
    expect(result.incidents).toBe(5);
    expect(result.alerts).toBe(10);
    expect(result.logs).toBe(20);
    expect(result.events).toBe(0);
    expect(result.auditLogs).toBe(0);
    expect(result.held).toEqual({ incidents: 0, privacyRequests: 0 });
    expect(result.lifecycle).toEqual({
      privacyRequests: 0,
      expiredExportArtifacts: 0,
      unsubscribedSubscribers: 0,
    });

    expect(mockPrisma.incident.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: 'RESOLVED',
        events: expect.objectContaining({ none: expect.any(Object) }),
      }),
      select: { id: true },
    });

    // Verify delete was NOT called
    expect(mockPrisma.incident.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.alert.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.logEntry.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('should delete data when dryRun is false', async () => {
    // Setup for execution flow
    mockPrisma.incident.findMany
      .mockResolvedValueOnce([{ id: 'inc-1' }, { id: 'inc-2' }]) // initial eligible query
      .mockResolvedValueOnce([{ id: 'inc-1' }, { id: 'inc-2' }]) // batch query inside execution
      .mockResolvedValueOnce([]);
    mockPrisma.incidentEvent.deleteMany.mockResolvedValue({ count: 10 });
    mockPrisma.incidentNote.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.customFieldValue.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.alert.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.incident.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.alert.findMany.mockResolvedValueOnce([{ id: 'alert-1' }]).mockResolvedValueOnce([]);
    mockPrisma.alert.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.logEntry.findMany.mockResolvedValueOnce([{ id: 'log-1' }]).mockResolvedValueOnce([]);
    mockPrisma.logEntry.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.incidentEvent.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.findMany
      .mockResolvedValueOnce([{ id: 'audit-1' }])
      .mockResolvedValueOnce([]);
    mockPrisma.auditLog.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.inAppNotification.findMany.mockResolvedValue([]);
    mockPrisma.sLAPerformanceLog.findMany.mockResolvedValue([]);

    const result = await performDataCleanup(false);

    expect(result.dryRun).toBe(false);
    expect(result.incidents).toBe(2);
    expect(result.events).toBe(10);
    expect(result.logs).toBe(1);
    expect(result.auditLogs).toBe(1);

    // Verify delete WAS called
    expect(mockPrisma.incident.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.alert.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.logEntry.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.auditLog.deleteMany).toHaveBeenCalled();
    const slaCutoff = mockPrisma.sLAPerformanceLog.findMany.mock.calls[0][0].where.timestamp.lt;
    expect(Date.now() - slaCutoff.getTime()).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
  });
});
