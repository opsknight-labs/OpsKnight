import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  update: vi.fn(),
  findUnique: vi.fn(),
  createInAppNotifications: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({ onCallSchedule: { update: m.update } }),
    onCallSchedule: { findUnique: m.findUnique },
  },
}));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn(),
  assertAdminOrResponder: async () => ({ id: 'user-1' }),
  assertCanCreateScheduleOverride: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: m.createInAppNotifications,
  getScheduleUserIds: async () => ['user-2'],
}));
vi.mock('@/lib/unique-names', () => ({
  assertScheduleNameAvailable: async (name: string) => name,
  UniqueNameConflictError: class UniqueNameConflictError extends Error {},
}));
vi.mock('@/lib/db-utils', () => ({ runSerializableTransaction: vi.fn() }));
vi.mock('@/lib/schedules/mutations', () => ({}));
vi.mock('@/lib/schedules/layer-commands', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateSchedule } from '@/app/(app)/schedules/actions';

function form(name: string, timeZone: string, revision?: string) {
  const data = new FormData();
  data.set('name', name);
  data.set('timeZone', timeZone);
  if (revision) data.set('revision', revision);
  return data;
}

describe('updateSchedule notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findUnique.mockResolvedValue({ name: 'Primary', timeZone: 'UTC' });
  });

  it('tells members that a time zone change moves restriction hours and handoffs', async () => {
    await updateSchedule('sched-1', form('Primary', 'America/New_York'));

    const { message } = m.createInAppNotifications.mock.calls[0][0];
    expect(message).toContain('time zone changed from UTC to America/New_York');
    expect(message).toContain('restriction hours and handoffs');
    expect(message).not.toContain('renamed');
  });

  it('reports a rename without mentioning the time zone', async () => {
    await updateSchedule('sched-1', form('Primary on-call', 'UTC'));

    const { message } = m.createInAppNotifications.mock.calls[0][0];
    expect(message).toBe('Schedule "Primary on-call" renamed from "Primary" to "Primary on-call"');
  });

  it('sends nothing when nothing changed', async () => {
    await updateSchedule('sched-1', form('Primary', 'UTC'));

    expect(m.createInAppNotifications).not.toHaveBeenCalled();
  });

  it('refuses an edit made from an older revision instead of overwriting', async () => {
    m.update.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'P2025' }));

    const result = await updateSchedule('sched-1', form('Renamed', 'UTC', '2'));

    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sched-1', revision: 2 } })
    );
    expect(result?.error).toContain('Someone else changed this schedule');
    expect(m.createInAppNotifications).not.toHaveBeenCalled();
  });
});
