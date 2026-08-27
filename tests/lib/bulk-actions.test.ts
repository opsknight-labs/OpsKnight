import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkAcknowledge,
  bulkResolve,
  bulkSnooze,
  bulkUpdateStatus,
  bulkUpdateUrgency,
} from '@/app/(app)/incidents/bulk-actions';
import prisma from '@/lib/prisma';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import {
  executeIncidentLifecycleBatch,
  executeIncidentLifecycleTargetBatch,
} from '@/lib/incidents/lifecycle';

vi.mock('@/lib/prisma', () => {
  const incident = {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  };
  const incidentEvent = {
    create: vi.fn(),
    createMany: vi.fn(),
  };
  const client = {
    incident,
    incidentEvent,
    $transaction: vi.fn(
      async (callback: (tx: { incident: typeof incident; incidentEvent: typeof incidentEvent }) => unknown) =>
        callback({ incident, incidentEvent })
    ),
    auditLog: { create: vi.fn() },
    systemSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  return { __esModule: true, default: client };
});

vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(),
  assertResponderOrAbove: vi.fn(),
}));

vi.mock('@/lib/incidents/lifecycle', () => ({
  executeIncidentLifecycleBatch: vi.fn(),
  executeIncidentLifecycleTargetBatch: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('Bulk Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertResponderOrAbove).mockResolvedValue({} as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      role: 'RESPONDER',
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.incident.findMany).mockResolvedValue([]);
  });

  describe('bulkAcknowledge', () => {
    it('routes acknowledgement through the lifecycle batch engine', async () => {
      const incidentIds = ['incident-1', 'incident-2'];
      vi.mocked(executeIncidentLifecycleBatch).mockResolvedValue([
        {
          incidentId: 'incident-1',
          command: 'ACKNOWLEDGE',
          source: 'BULK',
          previousStatus: 'OPEN',
          status: 'ACKNOWLEDGED',
          changed: true,
        },
        {
          incidentId: 'incident-2',
          command: 'ACKNOWLEDGE',
          source: 'BULK',
          previousStatus: 'ACKNOWLEDGED',
          status: 'ACKNOWLEDGED',
          changed: false,
        },
      ]);

      const result = await bulkAcknowledge(incidentIds);

      expect(result).toEqual({ success: true, count: 1 });
      expect(executeIncidentLifecycleBatch).toHaveBeenCalledWith([
        expect.objectContaining({
          incidentId: 'incident-1',
          command: 'ACKNOWLEDGE',
          source: 'BULK',
          actor: { id: 'user-1', name: 'Test User' },
        }),
        expect.objectContaining({
          incidentId: 'incident-2',
          command: 'ACKNOWLEDGE',
          source: 'BULK',
          actor: { id: 'user-1', name: 'Test User' },
        }),
      ]);
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['incident-1'] } } })
      );
    });

    it('returns an error if no incidents are selected', async () => {
      await expect(bulkAcknowledge([])).resolves.toEqual({
        success: false,
        error: 'No incidents selected',
      });
      expect(executeIncidentLifecycleBatch).not.toHaveBeenCalled();
    });

    it('returns an authorization error before invoking lifecycle commands', async () => {
      vi.mocked(assertResponderOrAbove).mockRejectedValue(new Error('Unauthorized'));

      const result = await bulkAcknowledge(['incident-1']);

      expect(result).toEqual({ success: false, error: 'Unauthorized' });
      expect(executeIncidentLifecycleBatch).not.toHaveBeenCalled();
    });
  });

  describe('bulkResolve', () => {
    it('routes resolution through lifecycle validation and only counts changed incidents', async () => {
      vi.mocked(executeIncidentLifecycleBatch).mockResolvedValue([
        {
          incidentId: 'incident-1',
          command: 'RESOLVE',
          source: 'BULK',
          previousStatus: 'ACKNOWLEDGED',
          status: 'RESOLVED',
          changed: true,
        },
        {
          incidentId: 'incident-2',
          command: 'RESOLVE',
          source: 'BULK',
          previousStatus: 'RESOLVED',
          status: 'RESOLVED',
          changed: false,
        },
      ]);

      const result = await bulkResolve(['incident-1', 'incident-2']);

      expect(result).toEqual({ success: true, count: 1 });
      expect(executeIncidentLifecycleBatch).toHaveBeenCalledWith([
        expect.objectContaining({ incidentId: 'incident-1', command: 'RESOLVE', source: 'BULK' }),
        expect.objectContaining({ incidentId: 'incident-2', command: 'RESOLVE', source: 'BULK' }),
      ]);
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });

    it('does not bypass lifecycle required-field validation', async () => {
      vi.mocked(executeIncidentLifecycleBatch).mockRejectedValue(
        new Error('Complete required custom fields before resolving: Root Cause')
      );

      const result = await bulkResolve(['incident-1']);

      expect(result).toEqual({ success: false, error: 'Failed to resolve incidents' });
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('bulkSnooze', () => {
    it('routes snooze metadata through the semantic lifecycle command', async () => {
      vi.mocked(executeIncidentLifecycleBatch).mockResolvedValue([
        {
          incidentId: 'incident-1',
          command: 'SNOOZE',
          source: 'BULK',
          previousStatus: 'OPEN',
          status: 'SNOOZED',
          changed: true,
        },
      ]);

      const result = await bulkSnooze(['incident-1'], 30, 'maintenance');

      expect(result).toEqual({ success: true, count: 1 });
      expect(executeIncidentLifecycleBatch).toHaveBeenCalledWith([
        expect.objectContaining({
          incidentId: 'incident-1',
          command: 'SNOOZE',
          source: 'BULK',
          snoozeReason: 'maintenance',
          snoozedUntil: expect.any(Date),
        }),
      ]);
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('bulkUpdateStatus', () => {
    it('delegates OPEN to target-status translation so source state selects the semantic command', async () => {
      vi.mocked(executeIncidentLifecycleTargetBatch).mockResolvedValue([
        {
          incidentId: 'incident-1',
          command: 'REOPEN',
          source: 'BULK',
          previousStatus: 'RESOLVED',
          status: 'OPEN',
          changed: true,
        },
      ]);

      const result = await bulkUpdateStatus(['incident-1'], 'OPEN');

      expect(result).toEqual({ success: true, count: 1 });
      expect(executeIncidentLifecycleTargetBatch).toHaveBeenCalledWith([
        expect.objectContaining({
          incidentId: 'incident-1',
          status: 'OPEN',
          source: 'BULK',
          actor: { id: 'user-1', name: 'Test User' },
        }),
      ]);
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });

    it('does not write acknowledgement timestamps directly for generic status updates', async () => {
      vi.mocked(executeIncidentLifecycleTargetBatch).mockResolvedValue([
        {
          incidentId: 'incident-1',
          command: 'ACKNOWLEDGE',
          source: 'BULK',
          previousStatus: 'OPEN',
          status: 'ACKNOWLEDGED',
          changed: true,
        },
      ]);

      await bulkUpdateStatus(['incident-1'], 'ACKNOWLEDGED');

      expect(executeIncidentLifecycleTargetBatch).toHaveBeenCalled();
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('bulkUpdateUrgency', () => {
    it('keeps non-lifecycle bulk updates on their existing direct path', async () => {
      vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 2 });
      vi.mocked(prisma.incidentEvent.createMany).mockResolvedValue({ count: 2 });

      const result = await bulkUpdateUrgency(['incident-1', 'incident-2'], 'HIGH');

      expect(result).toEqual({ success: true, count: 2 });
      expect(prisma.incident.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['incident-1', 'incident-2'] } },
        data: { urgency: 'HIGH' },
      });
      expect(executeIncidentLifecycleBatch).not.toHaveBeenCalled();
      expect(executeIncidentLifecycleTargetBatch).not.toHaveBeenCalled();
    });
  });
});
