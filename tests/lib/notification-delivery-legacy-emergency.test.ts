import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendNotificationIntentPush: vi.fn(),
  sendIncidentEmail: vi.fn(),
  incidentFindUnique: vi.fn(),
  rateLimitFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  capacityFindUnique: vi.fn(),
  runtimeFindUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findUnique: mocks.incidentFindUnique },
    rateLimit: { findUnique: mocks.rateLimitFindUnique, deleteMany: vi.fn() },
    notificationProviderCapacity: { findUnique: mocks.capacityFindUnique },
    notificationRuntimeSettings: { findUnique: mocks.runtimeFindUnique },
    $queryRaw: mocks.queryRaw,
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/incident-push-delivery', () => ({
  sendNotificationIntentPush: mocks.sendNotificationIntentPush,
}));

vi.mock('@/lib/email', () => ({
  sendIncidentEmail: mocks.sendIncidentEmail,
}));

vi.mock('@/lib/notification-providers', () => ({
  getPushConfig: vi.fn().mockResolvedValue({ provider: 'default' }),
  getEmailConfig: vi.fn().mockResolvedValue({ provider: 'default' }),
}));

import { dispatchNotificationAttempt } from '@/lib/notification-delivery';
import {
  forceProductionModeForTests,
  resetProviderAdmissionForTests,
} from '@/lib/provider-admission';
import { resetCapacityResolverForTests } from '@/lib/notification-capacity/resolver';

describe('legacy notification delivery under control plane DB outage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProviderAdmissionForTests();
    resetCapacityResolverForTests();
    forceProductionModeForTests();

    // Simulate complete control-plane and RateLimit outage
    const dbOutage = new Error('Control-plane database unavailable');
    mocks.rateLimitFindUnique.mockRejectedValue(dbOutage);
    mocks.queryRaw.mockRejectedValue(dbOutage);
    mocks.capacityFindUnique.mockRejectedValue(dbOutage);
    mocks.runtimeFindUnique.mockRejectedValue(dbOutage);

    // Default provider response: success
    mocks.sendNotificationIntentPush.mockResolvedValue({
      success: true,
      delivered: 1,
      failed: 0,
    });
    mocks.sendIncidentEmail.mockResolvedValue({
      success: true,
      delivered: 1,
      failed: 0,
    });
  });

  it('delivers legacy triggered/high incident via CRITICAL emergency limiter during DB outage', async () => {
    mocks.incidentFindUnique.mockResolvedValue({
      id: 'inc-p1',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date(),
      updatedAt: new Date(),
      escalationGeneration: 0,
      service: null,
    });

    const result = await dispatchNotificationAttempt({
      notificationId: 'notif-p1-1',
      incidentId: 'inc-p1',
      userId: 'user-1',
      channel: 'PUSH',
      eventType: 'triggered',
      message: 'P1 incident triggered',
    });

    expect(result.outcome).toBe('DELIVERED');
    expect(mocks.sendNotificationIntentPush).toHaveBeenCalledTimes(1);
  });

  it('delivers legacy triggered/normal incident via CRITICAL emergency limiter during DB outage', async () => {
    mocks.incidentFindUnique.mockResolvedValue({
      id: 'inc-p3',
      status: 'OPEN',
      priority: 'P3',
      urgency: 'LOW',
      createdAt: new Date(),
      updatedAt: new Date(),
      escalationGeneration: 0,
      service: null,
    });

    const result = await dispatchNotificationAttempt({
      notificationId: 'notif-p3-1',
      incidentId: 'inc-p3',
      userId: 'user-2',
      channel: 'PUSH',
      eventType: 'triggered',
      message: 'P3 incident triggered',
    });

    expect(result.outcome).toBe('DELIVERED');
    expect(mocks.sendNotificationIntentPush).toHaveBeenCalledTimes(1);
  });

  it('delivers legacy ACK via TRANSACTIONAL emergency limiter during DB outage', async () => {
    mocks.incidentFindUnique.mockResolvedValue({
      id: 'inc-ack',
      status: 'ACKNOWLEDGED',
      priority: 'P2',
      urgency: 'HIGH',
      createdAt: new Date(),
      updatedAt: new Date(),
      acknowledgedAt: new Date(),
      escalationGeneration: 0,
      service: null,
    });

    const result = await dispatchNotificationAttempt({
      notificationId: 'notif-ack-1',
      incidentId: 'inc-ack',
      userId: 'user-3',
      channel: 'PUSH',
      eventType: 'acknowledged',
      message: 'Incident acknowledged',
    });

    expect(result.outcome).toBe('DELIVERED');
    expect(mocks.sendNotificationIntentPush).toHaveBeenCalledTimes(1);
  });

  it('delivers legacy resolve via TRANSACTIONAL emergency limiter during DB outage', async () => {
    mocks.incidentFindUnique.mockResolvedValue({
      id: 'inc-res',
      status: 'RESOLVED',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: new Date(),
      escalationGeneration: 0,
      service: null,
    });

    const result = await dispatchNotificationAttempt({
      notificationId: 'notif-res-1',
      incidentId: 'inc-res',
      userId: 'user-4',
      channel: 'PUSH',
      eventType: 'resolved',
      message: 'Incident resolved',
    });

    expect(result.outcome).toBe('DELIVERED');
    expect(mocks.sendNotificationIntentPush).toHaveBeenCalledTimes(1);
  });

  it('fails closed for BULK / public incident traffic during DB outage', async () => {
    mocks.incidentFindUnique.mockResolvedValue({
      id: 'inc-bulk',
      status: 'OPEN',
      priority: 'P1',
      urgency: 'HIGH',
      createdAt: new Date(),
      updatedAt: new Date(),
      escalationGeneration: 0,
      service: null,
    });

    const result = await dispatchNotificationAttempt({
      notificationId: 'notif-bulk-1',
      incidentId: 'inc-bulk',
      userId: 'user-5',
      channel: 'PUSH',
      eventType: 'triggered',
      trafficClass: 'BULK',
      message: 'Bulk status update',
    });

    expect(result.outcome).toBe('QUEUED');
    expect(result.error).toContain('Provider concurrency deferred');
    expect(mocks.sendNotificationIntentPush).not.toHaveBeenCalled();
  });

  it('uses caller-supplied incident snapshot when incident table itself is unreachable', async () => {
    mocks.incidentFindUnique.mockRejectedValue(new Error('Incident table unreachable'));

    const result = await dispatchNotificationAttempt({
      notificationId: 'notif-offline-1',
      incidentId: 'inc-offline',
      userId: 'user-6',
      channel: 'PUSH',
      eventType: 'triggered',
      message: 'Incident snapshot fallback',
      incident: {
        id: 'inc-offline',
        status: 'OPEN',
        priority: 'P1',
        urgency: 'HIGH',
        escalationGeneration: 0,
      },
    });

    expect(result.outcome).toBe('DELIVERED');
    expect(mocks.sendNotificationIntentPush).toHaveBeenCalledTimes(1);
  });
});
