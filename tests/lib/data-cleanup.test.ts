import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditRowsOutsideHeldUsers, performDataCleanup } from '@/lib/data-cleanup';

// Mock dependencies
const { mockPrisma } = vi.hoisted(() => {
  const mockPrisma = {
    inboundDelivery: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
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
    rateLimit: {
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(mockPrisma)),
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
    mockPrisma.inboundDelivery.findMany
      .mockResolvedValueOnce([{ id: 'delivery-1' }])
      .mockResolvedValueOnce([]);
    mockPrisma.inboundDelivery.deleteMany.mockResolvedValue({ count: 1 });

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
    expect(mockPrisma.inboundDelivery.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['COMPLETED', 'FAILED'],
    });
    expect(mockPrisma.inboundDelivery.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['delivery-1'] } },
    });
    const slaCutoff = mockPrisma.sLAPerformanceLog.findMany.mock.calls[0][0].where.timestamp.lt;
    expect(Date.now() - slaCutoff.getTime()).toBeGreaterThan(360 * 24 * 60 * 60 * 1000);
  });
});

describe('USER legal holds and the audit trail', () => {
  type AuditCandidate = {
    id: string;
    actorId: string | null;
    entityType: string;
    entityId: string | null;
  };
  const holdsOf = (scopeIds: string[]) => scopeIds.map(scopeId => ({ scopeId }));

  /**
   * `heldAtStart` is who holds a USER legal hold when cleanup starts; `heldBeforeDelete` is who
   * holds one by the time a batch re-checks inside its transaction (a hold placed mid-run).
   */
  function arrange(candidates: AuditCandidate[], heldAtStart: string[], heldBeforeDelete: string[]) {
    vi.clearAllMocks();
    mockPrisma.incident.findMany.mockResolvedValue([]);
    mockPrisma.alert.findMany.mockResolvedValue([]);
    mockPrisma.alert.count.mockResolvedValue(0);
    mockPrisma.logEntry.findMany.mockResolvedValue([]);
    mockPrisma.logEntry.count.mockResolvedValue(0);
    mockPrisma.incidentEvent.findMany.mockResolvedValue([]);
    mockPrisma.incidentEvent.count.mockResolvedValue(0);
    mockPrisma.inAppNotification.findMany.mockResolvedValue([]);
    mockPrisma.sLAPerformanceLog.findMany.mockResolvedValue([]);
    mockPrisma.inboundDelivery.findMany.mockResolvedValue([]);
    mockPrisma.privacyRequest.findMany.mockResolvedValue([]);
    mockPrisma.privacyExportArtifact.findMany.mockResolvedValue([]);
    mockPrisma.statusPageSubscription.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
    mockPrisma.auditLog.findMany.mockResolvedValueOnce(candidates).mockResolvedValue([]);
    mockPrisma.auditLog.deleteMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) => ({ count: where.id.in.length })
    );
    mockPrisma.dataRetentionHold.findMany.mockImplementation(
      async ({ where }: { where: { scopeType: string; scopeId?: { in: string[] } } }) => {
        if (where.scopeType !== 'USER') return [];
        // Without a scopeId this is the start-of-run lookup; with one it is a batch re-check.
        if (!where.scopeId) return holdsOf(heldAtStart);
        return holdsOf(heldBeforeDelete.filter(id => where.scopeId!.in.includes(id)));
      }
    );
  }

  const deletedAuditIds = () =>
    mockPrisma.auditLog.deleteMany.mock.calls.flatMap(
      call => (call[0] as { where: { id: { in: string[] } } }).where.id.in
    );

  it('keeps rows a held user performed and rows about them, and deletes the rest', async () => {
    arrange(
      [
        { id: 'by-held', actorId: 'u-held', entityType: 'INCIDENT', entityId: 'inc-1' },
        { id: 'about-held', actorId: 'admin-1', entityType: 'USER', entityId: 'u-held' },
        { id: 'other', actorId: 'u-other', entityType: 'USER', entityId: 'u-other' },
        { id: 'system', actorId: null, entityType: 'SERVICE', entityId: null },
      ],
      [],
      ['u-held']
    );

    const result = await performDataCleanup(false);

    expect(deletedAuditIds().sort()).toEqual(['other', 'system']);
    expect(result.auditLogs).toBe(2);
    // The hold is checked under the same advisory lock that creating a hold takes.
    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
  });

  it('excludes held users from the candidate query and from the dry-run count', async () => {
    arrange([], ['u-held'], ['u-held']);

    await performDataCleanup(true);
    await performDataCleanup(false);

    const exclusion = auditRowsOutsideHeldUsers(['u-held']);
    expect(mockPrisma.auditLog.count.mock.calls[0][0].where).toMatchObject(exclusion);
    expect(mockPrisma.auditLog.findMany.mock.calls[0][0].where).toMatchObject(exclusion);
    expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes nothing when every candidate belongs to a user held in the meantime', async () => {
    arrange(
      [
        { id: 'a', actorId: 'u-race', entityType: 'INCIDENT', entityId: 'inc-1' },
        { id: 'b', actorId: 'u-race', entityType: 'USER', entityId: 'u-race' },
      ],
      [],
      ['u-race']
    );

    const result = await performDataCleanup(false);

    expect(mockPrisma.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(result.auditLogs).toBe(0);
  });

  it('builds a filter that keeps rows with no actor or no entity user (NULLs survive NOT IN)', () => {
    expect(auditRowsOutsideHeldUsers([])).toEqual({});
    expect(auditRowsOutsideHeldUsers(['u1'])).toEqual({
      AND: [
        { OR: [{ actorId: null }, { actorId: { notIn: ['u1'] } }] },
        {
          OR: [
            { entityType: { not: 'USER' } },
            { entityId: null },
            { entityId: { notIn: ['u1'] } },
          ],
        },
      ],
    });
  });
});
