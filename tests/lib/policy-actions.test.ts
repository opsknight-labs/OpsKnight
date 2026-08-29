import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { movePolicyStep, reorderPolicySteps } from '@/app/(app)/policies/actions';

vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'ADMIN' }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  getDefaultActorId: vi.fn().mockResolvedValue('actor-1'),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('Policy Step Actions', () => {
  const prismaMock = prisma as any;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (arg: any) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      return arg(prismaMock);
    });
  });

  describe('movePolicyStep', () => {
    it('updates step orders and preserves positional timeline delays when moving a step up', async () => {
      prismaMock.escalationRule.findUnique.mockResolvedValue({
        id: 'step-1',
        policyId: 'pol-1',
        stepOrder: 1,
        delayMinutes: 10,
      });

      prismaMock.escalationRule.findMany.mockResolvedValue([
        { id: 'step-0', stepOrder: 0, delayMinutes: 0 },
        { id: 'step-1', stepOrder: 1, delayMinutes: 10 },
      ]);

      const result = await movePolicyStep('step-1', 'up');
      expect(result).toBeUndefined();

      const updates = prismaMock.escalationRule.update.mock.calls.map((call: any) => call[0]);

      expect(updates).toEqual([
        {
          where: { id: 'step-1' },
          data: { stepOrder: -1 },
        },
        {
          where: { id: 'step-0' },
          data: { stepOrder: 1, delayMinutes: 10 },
        },
        {
          where: { id: 'step-1' },
          data: { stepOrder: 0, delayMinutes: 0 },
        },
      ]);
    });
  });

  describe('reorderPolicySteps', () => {
    it('reorders all steps and updates positional delays to prevent unique constraint collisions', async () => {
      prismaMock.escalationRule.findMany.mockResolvedValue([
        { id: 'step-b', stepOrder: 1, delayMinutes: 10 },
        { id: 'step-a', stepOrder: 0, delayMinutes: 0 },
        { id: 'step-c', stepOrder: 2, delayMinutes: 20 },
      ]);

      const newOrder = [
        { id: 'step-b', delayMinutes: 0 },
        { id: 'step-c', delayMinutes: 10 },
        { id: 'step-a', delayMinutes: 20 },
      ];
      const result = await reorderPolicySteps('pol-1', newOrder);
      expect(result).toBeUndefined();

      const updates = prismaMock.escalationRule.update.mock.calls.map((call: any) => call[0]);

      // Phase 1 (negative index): -(i+1)
      // Phase 2 (final 0-index): i with positional delayMinutes
      expect(updates).toEqual([
        { where: { id: 'step-b' }, data: { stepOrder: -1 } },
        { where: { id: 'step-c' }, data: { stepOrder: -2 } },
        { where: { id: 'step-a' }, data: { stepOrder: -3 } },
        { where: { id: 'step-b' }, data: { stepOrder: 0, delayMinutes: 0 } },
        { where: { id: 'step-c' }, data: { stepOrder: 1, delayMinutes: 10 } },
        { where: { id: 'step-a' }, data: { stepOrder: 2, delayMinutes: 20 } },
      ]);
    });
  });
});
