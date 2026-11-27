import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const tasks = vi.hoisted(() => ({
  startIngestionMaintenance: vi.fn(),
  stopIngestionMaintenance: vi.fn().mockResolvedValue(undefined),
  processPendingEscalations: vi.fn(),
  processPendingJobs: vi.fn(),
  runQueueMaintenance: vi.fn(),
  retryFailedNotifications: vi.fn(),
  processCentralNotificationQueue: vi.fn(),
  processAutoUnsnoozeInternal: vi.fn(),
  checkSLABreaches: vi.fn(),
  materializeMaintenanceSchedules: vi.fn().mockResolvedValue({ created: 0, failed: 0 }),
  reconcileEscalations: vi.fn(),
  reconcileIntegrationControlPlane: vi.fn(),
  reconcileStatusPageSnapshots: vi.fn(),
  reconcileStatusPageRouteOperations: vi.fn(),
  reconcileWarRoomHealth: vi.fn(),
  processShiftRotations: vi.fn(),
  processUpcomingShiftReminders: vi.fn(),
  schedulerQueryRaw: vi.fn(),
  processEndedMaintenanceWindows: vi.fn().mockResolvedValue({ windows: 0, released: 0 }),
  releaseStableFlappingHolds: vi.fn().mockResolvedValue(0),
  enqueueBusinessServiceImpactReconcile: vi.fn().mockResolvedValue(undefined),
  reconcileStalledMeetingProvisions: vi.fn().mockResolvedValue(0),
  reconcileMeetingCleanupDebt: vi.fn().mockResolvedValue(0),
  cleanupUserTokens: vi.fn().mockResolvedValue(0),
  processAuthenticationAlerts: vi.fn().mockResolvedValue(undefined),
  processEndedAccessGrants: vi.fn().mockResolvedValue({ reverted: 0 }),
  expireStaleAccessRequests: vi.fn().mockResolvedValue({ expired: 0 }),
  maybeStartScheduledAccessReview: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/ingestion/maintenance', () => ({
  startIngestionMaintenance: tasks.startIngestionMaintenance,
  stopIngestionMaintenance: tasks.stopIngestionMaintenance,
}));
vi.mock('@/lib/escalation', () => ({
  processPendingEscalations: tasks.processPendingEscalations,
}));
vi.mock('@/lib/jobs/queue', () => ({
  processPendingJobs: tasks.processPendingJobs,
  cleanupOldJobs: vi.fn().mockResolvedValue(0),
  runQueueMaintenance: tasks.runQueueMaintenance,
}));
vi.mock('@/lib/notification-retry', () => ({
  getNextNotificationRetryAt: vi.fn().mockResolvedValue(null),
  retryFailedNotifications: tasks.retryFailedNotifications,
}));
vi.mock('@/lib/notification-control-plane', () => ({
  getNextCentralNotificationAt: vi.fn().mockResolvedValue(null),
  processCentralNotificationQueue: tasks.processCentralNotificationQueue,
}));
vi.mock('@/lib/service-maintenance/windows', () => ({
  processEndedMaintenanceWindows: tasks.processEndedMaintenanceWindows,
}));
vi.mock('@/lib/business-services/impacts', () => ({
  enqueueBusinessServiceImpactReconcile: tasks.enqueueBusinessServiceImpactReconcile,
}));
vi.mock('@/lib/flapping', () => ({
  releaseStableFlappingHolds: tasks.releaseStableFlappingHolds,
}));
vi.mock('@/lib/service-maintenance/schedules', () => ({
  materializeMaintenanceSchedules: tasks.materializeMaintenanceSchedules,
}));
vi.mock('@/lib/unsnooze', () => ({
  processAutoUnsnoozeInternal: tasks.processAutoUnsnoozeInternal,
}));
vi.mock('@/lib/user-tokens', () => ({ cleanupUserTokens: tasks.cleanupUserTokens }));
vi.mock('@/lib/auth-control/security-events', () => ({
  processAuthenticationAlerts: tasks.processAuthenticationAlerts,
}));
vi.mock('@/lib/access/grants', () => ({
  processEndedAccessGrants: tasks.processEndedAccessGrants,
}));
vi.mock('@/lib/access/requests', () => ({
  expireStaleAccessRequests: tasks.expireStaleAccessRequests,
}));
vi.mock('@/lib/access/admin', () => ({
  maybeStartScheduledAccessReview: tasks.maybeStartScheduledAccessReview,
}));
vi.mock('@/lib/rate-limit', () => ({ cleanupExpiredRateLimits: vi.fn().mockResolvedValue(0) }));
vi.mock('@/lib/sla-breach-monitor', () => ({ checkSLABreaches: tasks.checkSLABreaches }));
vi.mock('@/lib/incident-sla/next-transition', () => ({
  getNextIncidentSlaTransitionAt: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/escalation/recovery', () => ({
  reconcileEscalations: tasks.reconcileEscalations,
}));
vi.mock('@/lib/integrations/reconciliation', () => ({
  reconcileIntegrationControlPlane: tasks.reconcileIntegrationControlPlane,
}));
vi.mock('@/lib/status-pages/snapshot', () => ({
  reconcileStatusPageSnapshots: tasks.reconcileStatusPageSnapshots,
}));
vi.mock('@/lib/status-pages/route-operations', () => ({
  reconcileStatusPageRouteOperations: tasks.reconcileStatusPageRouteOperations,
}));
vi.mock('@/lib/war-room/reconcile', () => ({
  reconcileWarRoomHealth: tasks.reconcileWarRoomHealth,
}));
vi.mock('@/lib/war-room/terminal-cleanup', () => ({
  reconcileTerminalWarRoomDrift: vi
    .fn()
    .mockResolvedValue({ checked: 0, cleaned: 0, stillPending: 0, satisfied: 0 }),
}));
vi.mock('@/lib/incident-collaboration/meeting-reconciliation', () => ({
  reconcileStalledMeetingProvisions: tasks.reconcileStalledMeetingProvisions,
  reconcileMeetingCleanupDebt: tasks.reconcileMeetingCleanupDebt,
}));
vi.mock('@/lib/war-room/engine', () => ({
  repairOrphanedClosingWarRooms: vi.fn().mockResolvedValue({ checked: 0, repaired: 0 }),
}));
vi.mock('@/lib/oncall-handoff', () => ({
  processShiftRotations: tasks.processShiftRotations,
  processUpcomingShiftReminders: tasks.processUpcomingShiftReminders,
}));
vi.mock('@/lib/notification-fanout', () => ({
  cleanupExpiredNotificationCapacityData: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/lib/privacy/export/artifact', () => ({
  expireDuePrivacyExportArtifacts: vi.fn().mockResolvedValue(0),
}));

import {
  getCronSchedulerStatus,
  startCronScheduler,
  stopCronScheduler,
} from '@/lib/cron-scheduler';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    cronSchedulerState: {
      upsert: vi.fn().mockResolvedValue({
        id: 'singleton',
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        nextRunAt: null,
        lockedBy: null,
        lockedAt: null,
        lastRollupDate: null,
      }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    automationTrace: { findFirst: vi.fn().mockResolvedValue(null) },
    automationContextObservation: { findFirst: vi.fn().mockResolvedValue(null) },
    incident: { findFirst: vi.fn().mockResolvedValue(null) },
    backgroundJob: { findFirst: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: tasks.schedulerQueryRaw,
  },
}));

describe('cron-scheduler lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T00:30:00.000Z'));
    tasks.processPendingEscalations.mockResolvedValue({ processed: 0, total: 0 });
    tasks.processPendingJobs.mockResolvedValue({ processed: 0, failed: 0, total: 0 });
    tasks.runQueueMaintenance.mockResolvedValue(undefined);
    tasks.retryFailedNotifications.mockResolvedValue({ retried: 0, succeeded: 0, failed: 0 });
    tasks.processCentralNotificationQueue.mockResolvedValue({
      processed: 0,
      failed: 0,
      pending: 0,
      skipped: 0,
    });
    tasks.processAutoUnsnoozeInternal.mockResolvedValue(0);
    tasks.checkSLABreaches.mockResolvedValue({ activeIncidentCount: 0, warningCount: 0 });
    tasks.reconcileEscalations.mockResolvedValue({});
    tasks.reconcileIntegrationControlPlane.mockResolvedValue({});
    tasks.reconcileStatusPageSnapshots.mockResolvedValue({});
    tasks.reconcileStatusPageRouteOperations.mockResolvedValue({});
    tasks.reconcileWarRoomHealth.mockResolvedValue({});
    tasks.processShiftRotations.mockResolvedValue({});
    tasks.processUpcomingShiftReminders.mockResolvedValue(0);
    tasks.cleanupUserTokens.mockResolvedValue(0);
    tasks.processAuthenticationAlerts.mockResolvedValue(undefined);
    tasks.schedulerQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('RETURNING "leaseEpoch"')) return Promise.resolve([{ leaseEpoch: 1 }]);
      if (sql.includes('SELECT EXISTS')) return Promise.resolve([{ held: true }]);
      return Promise.resolve([]);
    });
  });

  afterEach(async () => {
    await stopCronScheduler();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('keeps ingestion maintenance alive with external cron scheduling', () => {
    vi.stubEnv('ENABLE_INTERNAL_CRON', 'false');
    startCronScheduler();
    expect(tasks.startIngestionMaintenance).toHaveBeenCalledTimes(1);
    expect(tasks.processPendingEscalations).not.toHaveBeenCalled();
  });

  it('marks scheduler as running after start', async () => {
    startCronScheduler();

    const status = await getCronSchedulerStatus();

    expect(status.running).toBe(true);
    expect(status.schedule).toBe('dynamic');
  });

  it('marks scheduler as stopped after stop', async () => {
    startCronScheduler();
    await stopCronScheduler();

    const status = await getCronSchedulerStatus();

    expect(status.running).toBe(false);
  });

  it('keeps queue maintenance under the full scheduler in integrated mode', async () => {
    startCronScheduler({ profile: 'full' });
    await vi.advanceTimersByTimeAsync(0);

    expect(tasks.processPendingJobs).toHaveBeenCalledTimes(1);
    expect(tasks.runQueueMaintenance).toHaveBeenCalledTimes(1);
    // Held-alert release runs at the start of every tick.
    expect(tasks.processEndedMaintenanceWindows).toHaveBeenCalledTimes(1);
    expect(tasks.releaseStableFlappingHolds).toHaveBeenCalledTimes(1);
    expect(tasks.enqueueBusinessServiceImpactReconcile).toHaveBeenCalledTimes(1);
  });

  it('runs maintenance work without claiming dedicated worker lanes', async () => {
    startCronScheduler({ profile: 'maintenance' });
    await vi.advanceTimersByTimeAsync(0);

    expect(tasks.processPendingJobs).not.toHaveBeenCalled();
    expect(tasks.processPendingEscalations).not.toHaveBeenCalled();
    expect(tasks.runQueueMaintenance).toHaveBeenCalledTimes(1);
    expect(tasks.retryFailedNotifications).not.toHaveBeenCalled();
    expect(tasks.processCentralNotificationQueue).not.toHaveBeenCalled();
    expect(tasks.reconcileEscalations).not.toHaveBeenCalled();
    expect(tasks.reconcileStatusPageSnapshots).not.toHaveBeenCalled();

    expect(tasks.checkSLABreaches).toHaveBeenCalledTimes(1);
    expect(tasks.processAutoUnsnoozeInternal).toHaveBeenCalledTimes(1);
    expect(tasks.processShiftRotations).toHaveBeenCalledTimes(1);
    expect(tasks.processUpcomingShiftReminders).toHaveBeenCalledTimes(1);
    expect(tasks.reconcileIntegrationControlPlane).toHaveBeenCalledTimes(1);
    expect(tasks.reconcileStatusPageRouteOperations).toHaveBeenCalledTimes(1);
    expect(tasks.reconcileWarRoomHealth).toHaveBeenCalledTimes(1);
    // Lost MEETING_PROVISION jobs and Teams cleanup debt are only recovered if the tick runs these.
    expect(tasks.reconcileStalledMeetingProvisions).toHaveBeenCalledTimes(1);
    expect(tasks.reconcileMeetingCleanupDebt).toHaveBeenCalledTimes(1);
  });

  it('keeps running the tick when the SLA breach check throws', async () => {
    tasks.checkSLABreaches.mockRejectedValue(new Error('slack enqueue failed'));

    startCronScheduler({ profile: 'maintenance' });
    await vi.advanceTimersByTimeAsync(0);

    expect(tasks.checkSLABreaches).toHaveBeenCalledTimes(1);
    // Steps after the secondary group (maintenance materialization) still ran.
    expect(tasks.materializeMaintenanceSchedules).toHaveBeenCalledTimes(1);
    expect(tasks.processShiftRotations).toHaveBeenCalledTimes(1);
  });

  it('still expires team grants when earlier maintenance steps keep throwing', async () => {
    tasks.processAuthenticationAlerts.mockRejectedValue(new Error('alert store down'));
    tasks.cleanupUserTokens.mockRejectedValue(new Error('token table locked'));
    tasks.expireStaleAccessRequests.mockRejectedValue(new Error('requests down'));

    startCronScheduler({ profile: 'maintenance' });
    await vi.advanceTimersByTimeAsync(0);

    expect(tasks.processAuthenticationAlerts).toHaveBeenCalledTimes(1);
    expect(tasks.cleanupUserTokens).toHaveBeenCalledTimes(1);
    expect(tasks.processEndedAccessGrants).toHaveBeenCalledTimes(1);
    // The access steps are isolated from each other too.
    expect(tasks.expireStaleAccessRequests).toHaveBeenCalledTimes(1);
    expect(tasks.maybeStartScheduledAccessReview).toHaveBeenCalledTimes(1);
  });

  it('fences a stale scheduler before it enters the next operation group', async () => {
    // Answer by statement, not call order: other sweeps in the tick (for example the noise-policy
    // version backfill) also read through $queryRaw between lease acquisition and the fence check.
    tasks.schedulerQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('RETURNING "leaseEpoch"')) return Promise.resolve([{ leaseEpoch: 41 }]);
      if (sql.includes('SELECT EXISTS')) return Promise.resolve([{ held: false }]);
      return Promise.resolve([]);
    });

    startCronScheduler({ profile: 'maintenance' });
    await vi.advanceTimersByTimeAsync(0);

    expect(tasks.reconcileIntegrationControlPlane).toHaveBeenCalledTimes(1);
    expect(tasks.processAutoUnsnoozeInternal).not.toHaveBeenCalled();
    expect(tasks.checkSLABreaches).not.toHaveBeenCalled();
  });
});
