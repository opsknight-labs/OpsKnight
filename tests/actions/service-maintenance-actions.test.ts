import { beforeEach, describe, expect, it, vi } from 'vitest';

const rbac = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  assertCanModifyService: vi.fn(),
}));
const windows = vi.hoisted(() => ({
  createMaintenanceWindow: vi.fn(async () => ({})),
  deleteMaintenanceWindow: vi.fn(),
  endMaintenanceWindowNow: vi.fn(),
  getMaintenanceWindow: vi.fn(),
  updateMaintenanceWindow: vi.fn(),
}));
const schedules = vi.hoisted(() => ({
  createMaintenanceSchedule: vi.fn(async () => ({})),
  deleteMaintenanceSchedule: vi.fn(),
  getMaintenanceSchedule: vi.fn(),
  updateMaintenanceSchedule: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', () => rbac);
vi.mock('@/lib/service-maintenance/windows', () => windows);
vi.mock('@/lib/service-maintenance/schedules', () => schedules);

import {
  createMaintenanceScheduleAction,
  createMaintenanceWindowAction,
} from '@/app/(app)/services/[id]/maintenance-actions';

const input = {
  title: 'Patch',
  serviceIds: [] as string[],
  startsAt: new Date('2030-01-01T00:00:00Z'),
  endsAt: new Date('2030-01-01T01:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('maintenance server actions with an empty service set', () => {
  it('requires a signed-in user even when no service is named', async () => {
    rbac.getCurrentUser.mockRejectedValue(new Error('Unauthorized'));
    const result = await createMaintenanceWindowAction('svc-a', input);
    expect(result.ok).toBe(false);
    expect(windows.createMaintenanceWindow).not.toHaveBeenCalled();
  });

  it('denies a non-admin with no services to authorise against', async () => {
    rbac.getCurrentUser.mockResolvedValue({ id: 'u1', role: 'USER' });
    const window = await createMaintenanceWindowAction('svc-a', input);
    const schedule = await createMaintenanceScheduleAction('svc-a', {
      ...input,
      frequency: 'DAILY',
      timeZone: 'UTC',
      startTime: '02:00',
      durationMinutes: 60,
      startsOn: '2030-01-01',
    });
    expect(window).toEqual({ ok: false, error: expect.stringContaining('Unauthorized') });
    expect(schedule.ok).toBe(false);
    expect(windows.createMaintenanceWindow).not.toHaveBeenCalled();
    expect(schedules.createMaintenanceSchedule).not.toHaveBeenCalled();
  });

  it('lets an admin through to validation and still checks every named service', async () => {
    rbac.getCurrentUser.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
    await createMaintenanceWindowAction('svc-a', input);
    expect(windows.createMaintenanceWindow).toHaveBeenCalledWith(input, {
      id: 'admin',
      source: 'UI',
    });

    rbac.getCurrentUser.mockResolvedValue({ id: 'u1', role: 'USER' });
    rbac.assertCanModifyService.mockResolvedValue({ id: 'u1' });
    await createMaintenanceWindowAction('svc-a', { ...input, serviceIds: ['svc-a', 'svc-b'] });
    expect(rbac.assertCanModifyService.mock.calls).toEqual([['svc-a'], ['svc-b']]);
  });

  it('starts a "Start now" window at the server clock, not a client time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-06-01T12:00:00Z'));
    try {
      rbac.getCurrentUser.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
      await createMaintenanceWindowAction('svc-a', {
        title: 'Patch',
        serviceIds: [],
        startNowForMinutes: 90,
      });
      expect(windows.createMaintenanceWindow).toHaveBeenCalledWith(
        {
          title: 'Patch',
          serviceIds: [],
          startsAt: new Date('2030-06-01T12:00:00Z'),
          endsAt: new Date('2030-06-01T13:30:00Z'),
        },
        { id: 'admin', source: 'UI' }
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
