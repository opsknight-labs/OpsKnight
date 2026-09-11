import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationError, CAPABILITIES } from '@/lib/authorization';

const mocks = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
  tx: {
    onCallSchedule: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    escalationRule: {
      findMany: vi.fn(),
    },
    onCallLayer: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    onCallLayerUser: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    onCallOverride: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    onCallShift: {
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/rbac', () => ({
  assertAdmin: mocks.assertAdmin,
  assertAdminOrResponder: vi.fn(),
  assertCanCreateScheduleOverride: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: mocks.logAudit,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: vi.fn(async callback => callback(mocks.tx)),
}));

import { deleteSchedule } from '@/app/(app)/schedules/actions';
import { deleteScheduleMutation } from '@/lib/schedules/mutations';

describe('Schedule Deletion Lifecycle & RBAC', () => {
  const scheduleId = 'sched-123';
  const adminActor = { id: 'admin-1', role: 'ADMIN' };

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.assertAdmin.mockResolvedValue(adminActor);
    mocks.tx.onCallSchedule.findUnique.mockResolvedValue({
      id: scheduleId,
      name: 'Primary SRE Rotation',
      timeZone: 'America/New_York',
    });
    mocks.tx.escalationRule.findMany.mockResolvedValue([]);
    mocks.tx.onCallLayer.count.mockResolvedValue(2);
    mocks.tx.onCallLayerUser.count.mockResolvedValue(4);
    mocks.tx.onCallOverride.count.mockResolvedValue(3);
    mocks.tx.onCallShift.count.mockResolvedValue(10);
    mocks.tx.onCallLayerUser.deleteMany.mockResolvedValue({ count: 4 });
    mocks.tx.onCallLayer.deleteMany.mockResolvedValue({ count: 2 });
    mocks.tx.onCallOverride.deleteMany.mockResolvedValue({ count: 3 });
    mocks.tx.onCallShift.deleteMany.mockResolvedValue({ count: 10 });
    mocks.tx.onCallSchedule.delete.mockResolvedValue({ id: scheduleId });
    mocks.logAudit.mockResolvedValue(undefined);
  });

  describe('Authorization Enforcement (Admin Only)', () => {
    it('allows an ADMIN user to successfully delete an unreferenced schedule', async () => {
      const result = await deleteSchedule(scheduleId);

      expect(result).toEqual({ success: true });
      expect(mocks.assertAdmin).toHaveBeenCalledTimes(1);
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/schedules');
      expect(mocks.revalidatePath).toHaveBeenCalledWith('/audit');
    });

    it('rejects RESPONDER access with AUTHORIZATION_DENIED', async () => {
      mocks.assertAdmin.mockRejectedValue(
        new AuthorizationError('Unauthorized. Admin access required.', CAPABILITIES.ADMIN_MANAGE)
      );

      const result = await deleteSchedule(scheduleId);

      expect(result).toMatchObject({
        success: false,
        code: 'AUTHORIZATION_DENIED',
        error: expect.stringContaining('Unauthorized. Admin access required.'),
      });
      expect(mocks.tx.onCallSchedule.delete).not.toHaveBeenCalled();
    });

    it('rejects standard USER access with AUTHORIZATION_DENIED', async () => {
      mocks.assertAdmin.mockRejectedValue(
        new AuthorizationError('Unauthorized. Admin access required.', CAPABILITIES.ADMIN_MANAGE)
      );

      const result = await deleteSchedule(scheduleId);

      expect(result).toMatchObject({
        success: false,
        code: 'AUTHORIZATION_DENIED',
      });
      expect(mocks.tx.onCallSchedule.delete).not.toHaveBeenCalled();
    });
  });

  describe('Dependency Safety (P0: SCHEDULE_IN_USE 409 Conflict)', () => {
    it('blocks deletion with SCHEDULE_IN_USE when linked to escalation policy steps', async () => {
      mocks.tx.escalationRule.findMany.mockResolvedValue([
        {
          stepOrder: 0,
          policy: {
            id: 'policy-prod-core',
            name: 'Production Core Policy',
            services: [
              { id: 'svc-auth', name: 'Auth Service' },
              { id: 'svc-billing', name: 'Billing Service' },
            ],
          },
        },
        {
          stepOrder: 1,
          policy: {
            id: 'policy-infra',
            name: 'Infra Escalation',
            services: [{ id: 'svc-db', name: 'Database Cluster' }],
          },
        },
      ]);

      const result = await deleteSchedule(scheduleId);

      expect(result).toMatchObject({
        success: false,
        code: 'SCHEDULE_IN_USE',
        error: expect.stringContaining('currently in use by 2 escalation policy step(s)'),
        dependencies: [
          {
            policyId: 'policy-prod-core',
            policyName: 'Production Core Policy',
            stepOrder: 0,
            services: [
              { id: 'svc-auth', name: 'Auth Service' },
              { id: 'svc-billing', name: 'Billing Service' },
            ],
          },
          {
            policyId: 'policy-infra',
            policyName: 'Infra Escalation',
            stepOrder: 1,
            services: [{ id: 'svc-db', name: 'Database Cluster' }],
          },
        ],
      });

      // Assert that NO deletions occurred
      expect(mocks.tx.onCallLayerUser.deleteMany).not.toHaveBeenCalled();
      expect(mocks.tx.onCallLayer.deleteMany).not.toHaveBeenCalled();
      expect(mocks.tx.onCallOverride.deleteMany).not.toHaveBeenCalled();
      expect(mocks.tx.onCallShift.deleteMany).not.toHaveBeenCalled();
      expect(mocks.tx.onCallSchedule.delete).not.toHaveBeenCalled();
      expect(mocks.logAudit).not.toHaveBeenCalled();
    });

    it('returns SCHEDULE_NOT_FOUND when schedule does not exist', async () => {
      mocks.tx.onCallSchedule.findUnique.mockResolvedValue(null);

      const result = await deleteSchedule(scheduleId);

      expect(result).toMatchObject({
        success: false,
        code: 'SCHEDULE_NOT_FOUND',
      });
      expect(mocks.tx.onCallSchedule.delete).not.toHaveBeenCalled();
    });
  });

  describe('Transactional Cleanup & Audit Atomicity (P0)', () => {
    it('deletes child resources in correct foreign key order', async () => {
      const deletionOrder: string[] = [];

      mocks.tx.onCallLayerUser.deleteMany.mockImplementation(async () => {
        deletionOrder.push('layerUsers');
        return { count: 4 };
      });
      mocks.tx.onCallLayer.deleteMany.mockImplementation(async () => {
        deletionOrder.push('layers');
        return { count: 2 };
      });
      mocks.tx.onCallOverride.deleteMany.mockImplementation(async () => {
        deletionOrder.push('overrides');
        return { count: 3 };
      });
      mocks.tx.onCallShift.deleteMany.mockImplementation(async () => {
        deletionOrder.push('shifts');
        return { count: 10 };
      });
      mocks.tx.onCallSchedule.delete.mockImplementation(async () => {
        deletionOrder.push('schedule');
        return { id: scheduleId };
      });

      await deleteScheduleMutation(scheduleId, adminActor.id);

      // Verify layer users deleted before layers, and all children before parent schedule
      expect(deletionOrder.indexOf('layerUsers')).toBeLessThan(deletionOrder.indexOf('layers'));
      expect(deletionOrder.indexOf('layers')).toBeLessThan(deletionOrder.indexOf('schedule'));
      expect(deletionOrder.indexOf('overrides')).toBeLessThan(deletionOrder.indexOf('schedule'));
      expect(deletionOrder.indexOf('shifts')).toBeLessThan(deletionOrder.indexOf('schedule'));
    });

    it('emits schedule.deleted audit event inside transaction with safe snapshot metadata', async () => {
      await deleteScheduleMutation(scheduleId, adminActor.id);

      expect(mocks.logAudit).toHaveBeenCalledTimes(1);
      expect(mocks.logAudit).toHaveBeenCalledWith(
        {
          action: 'schedule.deleted',
          entityType: 'SCHEDULE',
          entityId: scheduleId,
          actorId: adminActor.id,
          details: {
            name: 'Primary SRE Rotation',
            timeZone: 'America/New_York',
            layerCount: 2,
            participantCount: 4,
            overrideCount: 3,
            shiftCount: 10,
          },
        },
        mocks.tx
      );
    });

    it('propagates error and aborts transaction if audit write fails', async () => {
      mocks.logAudit.mockRejectedValue(new Error('Audit service unavailable'));

      await expect(deleteScheduleMutation(scheduleId, adminActor.id)).rejects.toThrow(
        'Audit service unavailable'
      );
    });
  });
});
