import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const tx = {
    onCallSchedule: { create: vi.fn(), update: vi.fn() },
    onCallOverride: { delete: vi.fn() },
  };
  return {
    tx,
    logAudit: vi.fn(),
    addScheduleLayerUser: vi.fn(),
    moveScheduleLayerUser: vi.fn(),
    removeScheduleLayerUser: vi.fn(),
    createScheduleOverrideMutation: vi.fn(),
    cancelScheduleOverrideMutation: vi.fn(),
    overrideFindFirst: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: async (callback: (tx: typeof m.tx) => unknown) => callback(m.tx),
    onCallSchedule: {
      findUnique: async () => ({ name: 'Primary', timeZone: 'UTC' }),
    },
    onCallOverride: { findFirst: m.overrideFindFirst },
  },
}));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: async (callback: (tx: typeof m.tx) => unknown) => callback(m.tx),
}));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn(),
  assertAdminOrResponder: async () => ({ id: 'user-1' }),
  assertCanCreateScheduleOverride: async () => ({ id: 'user-1' }),
}));
vi.mock('@/lib/audit', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: vi.fn(),
  getScheduleUserIds: async () => [],
}));
vi.mock('@/lib/unique-names', () => ({
  assertScheduleNameAvailable: async (name: string) => name,
  UniqueNameConflictError: class UniqueNameConflictError extends Error {},
}));
vi.mock('@/lib/schedules/mutations', () => ({
  addScheduleLayerUser: m.addScheduleLayerUser,
  moveScheduleLayerUser: m.moveScheduleLayerUser,
  removeScheduleLayerUser: m.removeScheduleLayerUser,
  createScheduleOverrideMutation: m.createScheduleOverrideMutation,
  cancelScheduleOverrideMutation: m.cancelScheduleOverrideMutation,
  deleteScheduleMutation: vi.fn(),
}));
vi.mock('@/lib/schedules/layer-commands', () => ({
  createScheduleLayer: vi.fn(),
  updateScheduleLayer: vi.fn(),
  deleteScheduleLayer: vi.fn(),
  reorderScheduleLayers: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  addLayerUser,
  createOverride,
  createSchedule,
  deleteOverride,
  moveLayerUser,
  removeLayerUser,
  updateSchedule,
} from '@/app/(app)/schedules/actions';

/** The tx the audit row was written with (second argument of logAudit). */
const auditTx = (action: string) =>
  m.logAudit.mock.calls.find(([params]) => params.action === action)?.[1];

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('schedule actions write the audit record in the change transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.tx.onCallSchedule.create.mockResolvedValue({ id: 'sched-1' });
  });

  it('createSchedule and updateSchedule', async () => {
    await createSchedule({}, form({ name: 'Primary', timeZone: 'UTC' }));
    await updateSchedule('sched-1', form({ name: 'Primary', timeZone: 'UTC' }));

    expect(auditTx('schedule.created')).toBe(m.tx);
    expect(auditTx('schedule.updated')).toBe(m.tx);
  });

  it('adding, moving and removing a responder', async () => {
    m.addScheduleLayerUser.mockResolvedValue({ scheduleId: 'sched-1', position: 1 });
    m.moveScheduleLayerUser.mockResolvedValue({ scheduleId: 'sched-1' });
    m.removeScheduleLayerUser.mockResolvedValue({ scheduleId: 'sched-1', removed: true });

    await addLayerUser('layer-1', form({ userId: 'user-2' }));
    await moveLayerUser('layer-1', 'user-2', 'up');
    await removeLayerUser('layer-1', 'user-2');

    for (const action of [
      'schedule.member.added',
      'schedule.member.reordered',
      'schedule.member.removed',
    ]) {
      expect(auditTx(action), action).toBe(m.tx);
    }
    // The change runs inside that same transaction, so a failing audit rolls it back.
    expect(m.addScheduleLayerUser).toHaveBeenCalledWith('layer-1', 'user-2', m.tx);
    expect(m.moveScheduleLayerUser).toHaveBeenCalledWith('layer-1', 'user-2', 'up', m.tx);
    expect(m.removeScheduleLayerUser).toHaveBeenCalledWith('layer-1', 'user-2', m.tx);
  });

  it('a failed audit surfaces as an error from the action, not a committed change', async () => {
    m.addScheduleLayerUser.mockResolvedValue({ scheduleId: 'sched-1', position: 1 });
    m.logAudit.mockRejectedValueOnce(new Error('audit down'));

    const result = await addLayerUser('layer-1', form({ userId: 'user-2' }));

    expect(result).toHaveProperty('error');
    expect(m.addScheduleLayerUser.mock.calls[0]![2]).toBe(m.tx);
  });

  it('creating and deleting an override', async () => {
    m.createScheduleOverrideMutation.mockImplementation(async (_input, afterCreate) => {
      await afterCreate(m.tx, { id: 'ovr-1' });
      return { id: 'ovr-1' };
    });
    m.cancelScheduleOverrideMutation.mockResolvedValue({
      id: 'ovr-1',
      userId: 'user-2',
      replacesUserId: null,
      start: new Date('2030-01-01T09:00:00Z'),
      end: new Date('2030-01-01T17:00:00Z'),
      outcome: 'DELETED',
    });

    await createOverride(
      'sched-1',
      form({ userId: 'user-2', start: '2030-01-01T09:00', end: '2030-01-01T17:00' })
    );
    await deleteOverride('sched-1', 'ovr-1');

    expect(auditTx('schedule.override.created')).toBe(m.tx);
    expect(auditTx('schedule.override.deleted')).toBe(m.tx);
    expect(m.cancelScheduleOverrideMutation).toHaveBeenCalledWith('sched-1', 'ovr-1', m.tx);
  });

  it('ending an override in progress is audited as ended, with the window it served', async () => {
    m.cancelScheduleOverrideMutation.mockResolvedValue({
      id: 'ovr-1',
      userId: 'user-2',
      replacesUserId: 'user-3',
      start: new Date('2030-01-01T09:00:00Z'),
      end: new Date('2030-01-01T12:00:00Z'),
      outcome: 'ENDED',
    });

    await deleteOverride('sched-1', 'ovr-1');

    expect(auditTx('schedule.override.ended')).toBe(m.tx);
    expect(auditTx('schedule.override.deleted')).toBeUndefined();
    expect(m.logAudit.mock.calls[0]![0].details).toMatchObject({
      start: '2030-01-01T09:00:00.000Z',
      end: '2030-01-01T12:00:00.000Z',
    });
  });
});
