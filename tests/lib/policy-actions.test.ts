import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import {
  lockResponderPolicy,
  assertResponderPolicySnapshotSafe,
  bumpResponderPolicyRevision,
} from '@/lib/escalation/automation-snapshot';
import { assertAdmin } from '@/lib/rbac';
import {
  addPolicyStep,
  countPolicyIncidentsMidEscalation,
  deletePolicyStep,
  movePolicyStep,
  reorderPolicySteps,
  updatePolicyStep,
} from '@/app/(app)/policies/actions';
import { ESCALATION_STEP_CHANNELS_SUBMITTED } from '@/lib/escalation/policy-validation';

vi.mock('@/lib/escalation/automation-snapshot', () => ({
  lockResponderPolicy: vi.fn(),
  assertResponderPolicySnapshotSafe: vi.fn(),
  bumpResponderPolicyRevision: vi.fn(),
}));

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

type PrismaUpdateCall = [{ where: { id: string }; data: Record<string, unknown> }];

describe('Policy Step Actions', () => {
  const prismaMock = prisma as unknown as {
    $transaction: ReturnType<typeof vi.fn>;
    $queryRaw: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
    incident: { updateMany: ReturnType<typeof vi.fn> };
    escalationRule: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    user: { findFirst: ReturnType<typeof vi.fn> };
    team: { count: ReturnType<typeof vi.fn> };
    onCallSchedule: { count: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      async (arg: Array<Promise<unknown>> | ((tx: typeof prismaMock) => Promise<unknown>)) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg);
        }
        return arg(prismaMock);
      }
    );
    vi.mocked(lockResponderPolicy).mockResolvedValue(undefined);
    vi.mocked(assertResponderPolicySnapshotSafe).mockResolvedValue({ id: 'pol-1', name: 'Policy', steps: [] });
    prismaMock.user.findFirst.mockResolvedValue({ name: 'Ada', role: 'RESPONDER' });
    prismaMock.team.count.mockResolvedValue(1);
    prismaMock.onCallSchedule.count.mockResolvedValue(1);
  });

  describe('policy revision', () => {
    // The v2 If-Match revision only moves when the policy row itself is updated.
    it('bumps the policy revision for every UI step mutation', async () => {
      prismaMock.escalationRule.findUnique.mockResolvedValue({
        id: 'step-1',
        policyId: 'pol-1',
        stepOrder: 1,
        delayMinutes: 10,
        targetType: 'USER',
        targetUserId: 'user-1',
        targetTeamId: null,
        targetScheduleId: null,
        notificationChannels: [],
        notifyOnlyTeamLead: false,
        policy: { id: 'pol-1' },
      });
      prismaMock.escalationRule.findMany.mockResolvedValue([
        { id: 'step-0', stepOrder: 0, delayMinutes: 0 },
        { id: 'step-1', stepOrder: 1, delayMinutes: 10 },
      ]);
      const form = new FormData();
      form.append('targetType', 'USER');
      form.append('targetUserId', 'user-1');
      form.append('delayMinutes', '5');

      await addPolicyStep('pol-1', form);
      await updatePolicyStep('step-1', form);
      await deletePolicyStep('step-1');
      await movePolicyStep('step-1', 'up');
      await reorderPolicySteps('pol-1', ['step-1', 'step-0']);

      expect(vi.mocked(bumpResponderPolicyRevision)).toHaveBeenCalledTimes(5);
      expect(vi.mocked(bumpResponderPolicyRevision).mock.calls.map(call => call[1])).toEqual(
        Array(5).fill('pol-1')
      );
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

      const updates = (prismaMock.escalationRule.update.mock.calls as PrismaUpdateCall[]).map(
        call => call[0]
      );

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

      const updates = (prismaMock.escalationRule.update.mock.calls as PrismaUpdateCall[]).map(
        call => call[0]
      );

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

  describe('in-flight escalations', () => {
    const steps = (...ids: string[]) => ids.map((id, order) => ({ id, stepOrder: order, delayMinutes: 0 }));
    const movedCursors = () =>
      prismaMock.incident.updateMany.mock.calls.map(
        call => (call[0] as { data: { currentEscalationStep: number } }).data.currentEscalationStep
      );

    beforeEach(() => {
      // One incident whose next tier is the third step (index 2).
      prismaMock.$queryRaw.mockResolvedValue([{ id: 'inc-1', step: 2 }]);
    });

    it('keeps an incident on the same tier when an earlier step is deleted', async () => {
      prismaMock.escalationRule.findUnique.mockResolvedValue({
        id: 'step-a',
        policyId: 'pol-1',
        stepOrder: 0,
        delayMinutes: 0,
        policy: { id: 'pol-1' },
      });
      prismaMock.escalationRule.findMany
        .mockResolvedValueOnce(steps('step-a', 'step-b', 'step-c'))
        .mockResolvedValueOnce(steps('step-b', 'step-c'));

      await deletePolicyStep('step-a');

      expect(movedCursors()).toEqual([1]);
      expect(prismaMock.incident.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['inc-1'] } },
        data: { currentEscalationStep: 1 },
      });
    });

    it('leaves an incident alone when a later step is deleted', async () => {
      prismaMock.escalationRule.findUnique.mockResolvedValue({
        id: 'step-d',
        policyId: 'pol-1',
        stepOrder: 3,
        delayMinutes: 0,
        policy: { id: 'pol-1' },
      });
      prismaMock.escalationRule.findMany
        .mockResolvedValueOnce(steps('step-a', 'step-b', 'step-c', 'step-d'))
        .mockResolvedValueOnce(steps('step-a', 'step-b', 'step-c'));

      await deletePolicyStep('step-d');

      expect(prismaMock.incident.updateMany).not.toHaveBeenCalled();
    });

    it('does not skip the unpaged tier when a step is moved above a paged one', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: 'inc-1', step: 1 }]);
      prismaMock.escalationRule.findUnique.mockResolvedValue({
        id: 'step-b',
        policyId: 'pol-1',
        stepOrder: 1,
        delayMinutes: 0,
      });
      prismaMock.escalationRule.findMany
        .mockResolvedValueOnce(steps('step-a', 'step-b'))
        .mockResolvedValueOnce(steps('step-a', 'step-b'))
        .mockResolvedValueOnce(steps('step-b', 'step-a'));

      await movePolicyStep('step-b', 'up');

      expect(movedCursors()).toEqual([0]);
    });

    it('moves the cursor with a full reorder that drops no tier behind it', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: 'inc-1', step: 1 }]);
      prismaMock.escalationRule.findMany
        .mockResolvedValueOnce(steps('step-a', 'step-b', 'step-c'))
        .mockResolvedValueOnce(steps('step-a', 'step-b', 'step-c'))
        .mockResolvedValueOnce(steps('step-a', 'step-c', 'step-b'));

      await reorderPolicySteps('pol-1', ['step-a', 'step-c', 'step-b']);

      // step-a is paged and still first; the unpaged tiers just swap, so the cursor stays.
      expect(prismaMock.incident.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('countPolicyIncidentsMidEscalation', () => {
    it('returns how many open incidents are mid-escalation on the policy', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ count: 3 }]);
      await expect(countPolicyIncidentsMidEscalation('pol-1')).resolves.toEqual({ count: 3 });
      const [, ...values] = prismaMock.$queryRaw.mock.calls[0] as unknown[];
      expect(values).toEqual(['pol-1']);
    });

    it('is for admins only and reads nothing for anyone else', async () => {
      vi.mocked(assertAdmin).mockRejectedValueOnce(new Error('Unauthorized. Admin access required.'));
      await expect(countPolicyIncidentsMidEscalation('pol-1')).resolves.toEqual({
        error: 'Unauthorized. Admin access required.',
      });
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });

    it('rejects an empty policy id', async () => {
      const result = await countPolicyIncidentsMidEscalation('');
      expect(result.count).toBeUndefined();
      expect(result.error).toBeTruthy();
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('updatePolicyStep channel preservation', () => {
    const storedStep = {
      id: 'step-1',
      policyId: 'policy-1',
      stepOrder: 0,
      delayMinutes: 5,
      targetType: 'USER' as const,
      targetUserId: 'user-1',
      targetTeamId: null,
      targetScheduleId: null,
      // A step configured to page by SMS only.
      notificationChannels: ['SMS'],
      notifyOnlyTeamLead: false,
      policy: { id: 'policy-1' },
    };

    function editForm(fields: Record<string, string>): FormData {
      const formData = new FormData();
      for (const [key, value] of Object.entries(fields)) formData.append(key, value);
      return formData;
    }

    function writtenData(): Record<string, unknown> {
      const calls = prismaMock.escalationRule.update.mock.calls as PrismaUpdateCall[];
      expect(calls).toHaveLength(1);
      return calls[0][0].data;
    }

    beforeEach(() => {
      prismaMock.escalationRule.findUnique.mockResolvedValue(storedStep);
    });

    it('keeps configured channels when only the delay is edited', async () => {
      // The edit form does not render channel controls, so it submits neither
      // the channels nor the marker. Clearing them here would silently widen
      // the step to every channel the recipient has enabled.
      await updatePolicyStep('step-1', editForm({ delayMinutes: '15' }));

      expect(writtenData()).toMatchObject({ delayMinutes: 15, notificationChannels: ['SMS'] });
    });

    it('keeps configured channels when only the target is edited', async () => {
      await updatePolicyStep(
        'step-1',
        editForm({ targetType: 'USER', targetUserId: 'user-2', delayMinutes: '5' })
      );

      expect(writtenData()).toMatchObject({
        targetUserId: 'user-2',
        notificationChannels: ['SMS'],
      });
    });

    it('keeps configured channels when a step is switched to a team target', async () => {
      await updatePolicyStep(
        'step-1',
        editForm({
          targetType: 'TEAM',
          targetTeamId: 'team-1',
          delayMinutes: '5',
          notifyOnlyTeamLead: 'true',
        })
      );

      expect(writtenData()).toMatchObject({
        targetType: 'TEAM',
        targetTeamId: 'team-1',
        targetUserId: null,
        notifyOnlyTeamLead: true,
        notificationChannels: ['SMS'],
      });
    });

    it('replaces channels when the submission is authoritative for them', async () => {
      const formData = editForm({ delayMinutes: '5' });
      formData.append(ESCALATION_STEP_CHANNELS_SUBMITTED, 'true');
      formData.append('notificationChannels', 'EMAIL');
      formData.append('notificationChannels', 'PUSH');

      await updatePolicyStep('step-1', formData);

      expect(writtenData()).toMatchObject({ notificationChannels: ['EMAIL', 'PUSH'] });
    });

    it('clears channels only when the submission says so explicitly', async () => {
      const formData = editForm({ delayMinutes: '5' });
      formData.append(ESCALATION_STEP_CHANNELS_SUBMITTED, 'true');

      await updatePolicyStep('step-1', formData);

      // An empty authoritative submission is a deliberate clear, which is the
      // one case that should fall back to recipient preferences.
      expect(writtenData()).toMatchObject({ notificationChannels: [] });
    });

    it('leaves a step with no channel restriction unrestricted', async () => {
      prismaMock.escalationRule.findUnique.mockResolvedValue({
        ...storedStep,
        notificationChannels: [],
      });

      await updatePolicyStep('step-1', editForm({ delayMinutes: '20' }));

      expect(writtenData()).toMatchObject({ delayMinutes: 20, notificationChannels: [] });
    });

    it('rejects a stakeholder as the step target and writes nothing', async () => {
      prismaMock.user.findFirst.mockResolvedValue({ name: 'Sam', role: 'STAKEHOLDER' });

      const result = await updatePolicyStep(
        'step-1',
        editForm({ targetType: 'USER', targetUserId: 'stake-1', delayMinutes: '5' })
      );

      expect(result).toEqual({ error: expect.stringContaining('Stakeholders are never paged') });
      expect(prismaMock.escalationRule.update).not.toHaveBeenCalled();
    });
  });
});
