import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const tasks = vi.hoisted(() => ({
  processPendingEscalations: vi.fn(),
  processPendingJobs: vi.fn(),
  runQueueMaintenance: vi.fn(),
  retryFailedNotifications: vi.fn(),
  processCentralNotificationQueue: vi.fn(),
  processAutoUnsnoozeInternal: vi.fn(),
  checkSLABreaches: vi.fn(),
  reconcileEscalations: vi.fn(),
  reconcileIntegrationControlPlane: vi.fn(),
  reconcileStatusPageSnapshots: vi.fn(),
  reconcileStatusPageRouteOperations: vi.fn(),
  reconcileWarRoomHealth: vi.fn(),
  processShiftRotations: vi.fn(),
  processUpcomingShiftReminders: vi.fn(),
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
vi.mock('@/lib/unsnooze', () => ({
  processAutoUnsnoozeInternal: tasks.processAutoUnsnoozeInternal,
}));
vi.mock('@/lib/user-tokens', () => ({ cleanupUserTokens: vi.fn().mockResolvedValue(0) }));
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
vi.mock('@/lib/war-room/reconcile', () => ({ reconcileWarRoomHealth: tasks.reconcileWarRoomHealth }));
vi.mock('@/lib/war-room/terminal-cleanup', () => ({
  reconcileTerminalWarRoomDrift: vi.fn().mockResolvedValue({ checked: 0, cleaned: 0, stillPending: 0, satisfied: 0 }),
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
    incident: { findFirst: vi.fn().mockResolvedValue(null) },
    backgroundJob: { findFirst: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn().mockResolvedValue(1),
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
    tasks.processCentralNotificationQueue.mockResolvedValue({ processed: 0, failed: 0, pending: 0, skipped: 0 });
    tasks.processAutoUnsnoozeInternal.mockResolvedValue(0);
    tasks.checkSLABreaches.mockResolvedValue({ activeIncidentCount: 0, warningCount: 0 });
    tasks.reconcileEscalations.mockResolvedValue({});
    tasks.reconcileIntegrationControlPlane.mockResolvedValue({});
    tasks.reconcileStatusPageSnapshots.mockResolvedValue({});
    tasks.reconcileStatusPageRouteOperations.mockResolvedValue({});
    tasks.reconcileWarRoomHealth.mockResolvedValue({});
    tasks.processShiftRotations.mockResolvedValue({});
    tasks.processUpcomingShiftReminders.mockResolvedValue(0);
  });

  afterEach(async () => {
    await stopCronScheduler();
    vi.useRealTimers();
    vi.clearAllMocks();
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
  });

  it('runs maintenance work without claiming dedicated worker lanes', async () => {
    startCronScheduler({ profile: 'maintenance' });
    await vi.advanceTimersByTimeAsync(0);

    expect(tasks.processPendingJobs).not.toHaveBeenCalled();
    expect(tasks.processPendingEscalations).not.toHaveBeenCalled();
    expect(tasks.runQueueMaintenance).not.toHaveBeenCalled();
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
  });
});
