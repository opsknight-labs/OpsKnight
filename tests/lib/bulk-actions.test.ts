import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bulkAcknowledge,
  bulkReassign,
  bulkResolve,
  bulkSnooze,
  bulkUnsnooze,
  bulkUpdatePriority,
  bulkUpdateStatus,
  bulkUpdateUrgency,
} from '@/app/(app)/incidents/bulk-actions';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { assertResponderOrAbove, getCurrentAuthorizationActor, getCurrentUser } from '@/lib/rbac';
import { incidentReadWhere } from '@/lib/authorization-filters';
import {
  executeIncidentLifecycleBatch,
  executeIncidentLifecycleTargetBatch,
} from '@/lib/incidents/lifecycle';

vi.mock('@/lib/prisma', () => {
  const incident = {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
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
    user: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    systemSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  };
  return { __esModule: true, default: client };
});

vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn(),
  getCurrentAuthorizationActor: vi.fn(),
  assertResponderOrAbove: vi.fn(),
}));

vi.mock('@/lib/authorization-filters', () => ({
  incidentReadWhere: vi.fn(),
}));

vi.mock('@/lib/incidents/assignment', () => ({
  assignIncidentDomainCommand: vi.fn(),
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
    vi.mocked(getCurrentAuthorizationActor).mockResolvedValue({ id: 'user-1' } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(incidentReadWhere).mockReturnValue({});
  });

  describe('read scope of the selection', () => {
    const scoped = { OR: [{ assigneeId: 'user-1' }] };

    it('refuses a selection that includes an incident outside the actor read scope', async () => {
      vi.mocked(incidentReadWhere).mockReturnValue(scoped);
      vi.mocked(prisma.incident.count).mockResolvedValue(1);

      const result = await bulkResolve(['mine', 'someone-elses'], 'Rolled back the bad deploy');

      expect(result).toEqual({
        success: false,
        error: 'Unauthorized. You cannot act on one or more of the selected incidents.',
      });
      expect(prisma.incident.count).toHaveBeenCalledWith({
        where: { AND: [{ id: { in: ['mine', 'someone-elses'] } }, scoped] },
      });
      expect(executeIncidentLifecycleBatch).not.toHaveBeenCalled();
    });

    it('applies the same scope to the non-lifecycle bulk writes', async () => {
      vi.mocked(incidentReadWhere).mockReturnValue(scoped);
      vi.mocked(prisma.incident.count).mockResolvedValue(0);

      await expect(bulkUpdatePriority(['x'], 'P1')).resolves.toMatchObject({ success: false });
      await expect(bulkUpdateUrgency(['x'], 'HIGH')).resolves.toMatchObject({ success: false });
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });

    it('lets a fully readable selection through, counting each id once', async () => {
      vi.mocked(incidentReadWhere).mockReturnValue(scoped);
      vi.mocked(prisma.incident.count).mockResolvedValue(1);
      vi.mocked(executeIncidentLifecycleBatch).mockResolvedValue([]);

      await expect(bulkAcknowledge(['a', 'a'])).resolves.toEqual({ success: true, count: 0 });
      expect(executeIncidentLifecycleBatch).toHaveBeenCalled();
    });

    it('skips the lookup when the actor reads every incident', async () => {
      vi.mocked(executeIncidentLifecycleBatch).mockResolvedValue([]);

      await bulkAcknowledge(['a']);

      expect(prisma.incident.count).not.toHaveBeenCalled();
    });
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
      expect(prisma.incident.findMany).not.toHaveBeenCalled();
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

      const result = await bulkResolve(['incident-1', 'incident-2'], 'Rolled back the bad deploy');

      expect(result).toEqual({ success: true, count: 1 });
      expect(executeIncidentLifecycleBatch).toHaveBeenCalledWith([
        expect.objectContaining({
          incidentId: 'incident-1',
          command: 'RESOLVE',
          source: 'BULK',
          resolutionNote: 'Rolled back the bad deploy',
        }),
        expect.objectContaining({ incidentId: 'incident-2', command: 'RESOLVE', source: 'BULK' }),
      ]);
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });

    it('requires the same resolution note as resolving a single incident', async () => {
      for (const note of ['', '   ', 'too short', 'x'.repeat(1001)]) {
        await expect(bulkResolve(['incident-1'], note)).resolves.toMatchObject({
          success: false,
          error: expect.stringContaining('Resolution note must be'),
        });
      }
      expect(executeIncidentLifecycleBatch).not.toHaveBeenCalled();
    });

    it('does not bypass lifecycle required-field validation', async () => {
      vi.mocked(executeIncidentLifecycleBatch).mockRejectedValue(
        new Error('Complete required custom fields before resolving: Root Cause')
      );

      const result = await bulkResolve(['incident-1'], 'Rolled back the bad deploy');

      expect(result).toEqual({ success: false, error: 'Failed to resolve incidents' });
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('bulkReassign', () => {
    beforeEach(() => {
      vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'user-2', role: 'RESPONDER' } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    it('reassigns each open incident through the canonical assignment command', async () => {
      vi.mocked(prisma.incident.findMany).mockResolvedValue([{ id: 'open-1' }, { id: 'open-2' }] as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await bulkReassign(['open-1', 'open-2', 'done-1', 'open-1'], 'user-2');

      expect(prisma.incident.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['open-1', 'open-2', 'done-1'] }, status: { not: 'RESOLVED' } },
        select: { id: true },
      });
      expect(assignIncidentDomainCommand).toHaveBeenCalledTimes(2);
      expect(assignIncidentDomainCommand).toHaveBeenCalledWith(
        { incidentId: 'open-1', assigneeId: 'user-2', actor: { id: 'user-1', name: 'Test User' } },
        expect.anything()
      );
      expect(result).toEqual({ success: true, count: 2 });
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });

    it('refuses more incidents than one transaction should carry', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `inc-${i}`);

      await expect(bulkReassign(ids, 'user-2')).resolves.toMatchObject({ success: false });
      expect(assignIncidentDomainCommand).not.toHaveBeenCalled();
    });

    it('says why the command refused and that nothing changed', async () => {
      vi.mocked(prisma.incident.findMany).mockResolvedValue([{ id: 'open-1' }] as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(assignIncidentDomainCommand).mockRejectedValue(
        new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'User was not found.' })
      );

      await expect(bulkReassign(['open-1'], 'user-2')).resolves.toEqual({
        success: false,
        error: 'User was not found. No incidents were changed.',
      });
    });
  });

  describe('bulkUnsnooze', () => {
    it('tells the user why the selection was refused and that nothing changed', async () => {
      vi.mocked(executeIncidentLifecycleBatch).mockRejectedValue(
        new AppError({
          code: 'INCIDENT_INVALID_TRANSITION',
          userMessage: 'Cannot unsnooze an incident while it is ACKNOWLEDGED.',
        })
      );

      const result = await bulkUnsnooze(['snoozed-1', 'acked-1']);

      expect(result).toEqual({
        success: false,
        error: 'Cannot unsnooze an incident while it is ACKNOWLEDGED. No incidents were changed.',
      });
    });

    it('keeps the generic message for unexpected failures', async () => {
      vi.mocked(executeIncidentLifecycleBatch).mockRejectedValue(new Error('connection reset'));

      const result = await bulkUnsnooze(['snoozed-1']);

      expect(result).toEqual({ success: false, error: 'Failed to unsnooze incidents' });
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
    it('does not resolve through the generic status change, which has no resolution note', async () => {
      const result = await bulkUpdateStatus(['incident-1'], 'RESOLVED');

      expect(result).toMatchObject({ success: false });
      expect(executeIncidentLifecycleTargetBatch).not.toHaveBeenCalled();
    });

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

  describe('bulkUpdatePriority', () => {
    it('writes only P1-P5 (or clears the priority with an empty value)', async () => {
      vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.incidentEvent.createMany).mockResolvedValue({ count: 1 });

      await expect(bulkUpdatePriority(['incident-1'], 'P2')).resolves.toMatchObject({
        success: true,
      });
      expect(prisma.incident.updateMany).toHaveBeenLastCalledWith({
        where: { id: { in: ['incident-1'] } },
        data: { priority: 'P2' },
      });
      await bulkUpdatePriority(['incident-1'], '');
      expect(prisma.incident.updateMany).toHaveBeenLastCalledWith({
        where: { id: { in: ['incident-1'] } },
        data: { priority: null },
      });
    });

    it('rejects values that escalation conditions could never match', async () => {
      vi.mocked(prisma.incident.updateMany).mockClear();
      for (const bad of ['p1', 'P6', ' P1', 'x'.repeat(5000)]) {
        await expect(bulkUpdatePriority(['incident-1'], bad)).resolves.toMatchObject({
          success: false,
        });
      }
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });
  });
});
