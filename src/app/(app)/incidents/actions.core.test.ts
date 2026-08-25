import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createIncident } from './actions';
import prisma from '@/lib/prisma';

// Mock dependencies
vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: vi.fn().mockResolvedValue(true),
  assertCanModifyIncident: vi.fn().mockResolvedValue(true),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', name: 'Test User' }),
}));

vi.mock('@/lib/service-notifications', () => ({
  sendServiceNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/escalation', () => ({
  executeEscalation: vi.fn().mockResolvedValue({ escalated: false }),
}));

const scheduleEscalationMock = vi.fn().mockResolvedValue('job-1');
vi.mock('@/lib/jobs/queue', () => ({
  scheduleEscalation: scheduleEscalationMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/status-page-webhooks', () => ({
  triggerWebhooksForService: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/status-page-notifications', () => ({
  notifyStatusPageSubscribers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('createIncident Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma as any).customField = { findMany: vi.fn().mockResolvedValue([]) };
  });

  it('creates a new incident when no duplicates exist', async () => {
    // Mock Prisma responses
    (prisma.incident.findFirst as any).mockResolvedValue(null);
    (prisma.$transaction as any).mockImplementation((cb: any) => cb(prisma));
    (prisma.user.findUnique as any).mockResolvedValue({ name: 'Test User' });
    (prisma.incident.create as any).mockResolvedValue({ id: 'inc-new', serviceId: 'svc-1' });

    const formData = new FormData();
    formData.append('title', 'New Incident');
    formData.append('serviceId', 'svc-1');
    formData.append('urgency', 'HIGH');
    formData.append('dedupKey', 'unique-key-123');

    const result = await createIncident(formData);

    expect(prisma.incident.findFirst).toHaveBeenCalledTimes(2); // Checks for OPEN and then for RESOLVED
    // 2nd check for RESOLVED is skipped if key not found (logic dependent, but actually code checks for open first)
    // Wait, my code currently does: findFirst(OPEN). If null -> findFirst(RESOLVED).

    expect(prisma.incident.create).toHaveBeenCalled();
    expect(result).toHaveProperty('id', 'inc-new');
  });

  it('merges into an existing OPEN incident (Intelligent Deduplication)', async () => {
    const existingIncident = { id: 'inc-open', status: 'OPEN', title: 'Existing' };

    // Mock finding an OPEN incident
    (prisma.incident.findFirst as any).mockImplementation((args: any) => {
      if (args?.where?.status?.in) return Promise.resolve(existingIncident);
      return Promise.resolve(null);
    });

    (prisma.$transaction as any).mockImplementation((cb: any) => cb(prisma));

    const formData = new FormData();
    formData.append('title', 'Duplicate Incident');
    formData.append('serviceId', 'svc-1');
    formData.append('urgency', 'HIGH');
    formData.append('dedupKey', 'dup-key');

    const result = await createIncident(formData);

    // Should NOT create new incident
    expect(prisma.incident.create).not.toHaveBeenCalled();

    // Should create a note
    expect(prisma.incidentNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'inc-open',
          content: expect.stringContaining('[Manual Report Merged]'),
        }),
      })
    );

    // Should return existing incident
    expect(result).toHaveProperty('id', 'inc-open');
  });

  it('re-opens a recently RESOLVED incident', async () => {
    const recentResolved = {
      id: 'inc-resolved',
      status: 'RESOLVED',
      resolvedAt: new Date(Date.now() - 1000 * 60 * 10), // 10 mins ago
    };

    (prisma.incident.findFirst as any).mockImplementation((args: any) => {
      // 1. Open check -> null
      if (args?.where?.status?.in) return Promise.resolve(null);
      // 2. Resolved check -> returns incident
      if (args?.where?.status === 'RESOLVED') return Promise.resolve(recentResolved);
      return Promise.resolve(null);
    });

    (prisma.incident.update as any).mockResolvedValue({
      id: 'inc-resolved',
      status: 'OPEN',
      resolvedAt: null,
      currentEscalationStep: 0,
    });
    (prisma.$transaction as any).mockImplementation((cb: any) => cb(prisma));

    const formData = new FormData();
    formData.append('title', 'Recurrence');
    formData.append('serviceId', 'svc-1');
    formData.append('urgency', 'HIGH');
    formData.append('dedupKey', 'reopen-key');

    const result = await createIncident(formData);

    // Should NOT create new
    expect(prisma.incident.create).not.toHaveBeenCalled();

    // Should UPDATE (Re-open)
    expect(prisma.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-resolved' },
        data: expect.objectContaining({ status: 'OPEN' }),
      })
    );

    // Should add note
    expect(prisma.incidentNote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidentId: 'inc-resolved',
          content: expect.stringContaining('[Re-opened]'),
        }),
      })
    );

    expect(scheduleEscalationMock).toHaveBeenCalledWith('inc-resolved', 0, 0);
    expect(result).toHaveProperty('id', 'inc-resolved');
  });
});
