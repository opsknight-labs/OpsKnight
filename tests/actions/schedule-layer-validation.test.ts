import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  createScheduleLayer: vi.fn(),
  updateScheduleLayer: vi.fn(),
  tx: {},
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    onCallSchedule: { findUnique: async () => ({ name: 'Primary', timeZone: 'UTC' }) },
    onCallLayer: {
      findUnique: async () => ({ scheduleId: 'sched-1', schedule: { timeZone: 'UTC' } }),
    },
  },
}));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: async (callback: (tx: unknown) => unknown) => callback(m.tx),
}));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn(),
  assertAdminOrResponder: async () => ({ id: 'user-1' }),
  assertCanCreateScheduleOverride: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: vi.fn(),
  getScheduleUserIds: async () => [],
}));
vi.mock('@/lib/unique-names', () => ({
  assertScheduleNameAvailable: async (name: string) => name,
  UniqueNameConflictError: class UniqueNameConflictError extends Error {},
}));
vi.mock('@/lib/schedules/mutations', () => ({}));
vi.mock('@/lib/schedules/layer-commands', async importActual => ({
  ...(await importActual<typeof import('@/lib/schedules/layer-commands')>()),
  createScheduleLayer: m.createScheduleLayer,
  updateScheduleLayer: m.updateScheduleLayer,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createLayer, updateLayer } from '@/app/(app)/schedules/actions';

function layerForm(overrides: Record<string, string | string[]> = {}) {
  const data = new FormData();
  const fields: Record<string, string | string[]> = {
    name: ' Primary ',
    start: '2026-01-05T00:00',
    rotationLengthHours: '168',
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

describe('schedule layer actions use the same bounds as the API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.createScheduleLayer.mockResolvedValue({ id: 'layer-1' });
  });

  it.each([
    ['a fractional rotation', { rotationLengthHours: '1.5' }, 'whole number of hours'],
    ['a rotation over a year', { rotationLengthHours: '99999' }, 'cannot exceed one year'],
    ['a fractional shift', { shiftLengthHours: '2.5' }, 'whole number of hours'],
    ['duplicate days', { daysOfWeek: ['1', '1'] }, 'unique'],
  ])('refuses %s with a specific message on create and update', async (_label, fields, text) => {
    const create = await createLayer('sched-1', layerForm(fields));
    const update = await updateLayer('layer-1', layerForm(fields));

    expect(create?.error).toContain(text);
    expect(update?.error).toContain(text);
    expect(m.createScheduleLayer).not.toHaveBeenCalled();
    expect(m.updateScheduleLayer).not.toHaveBeenCalled();
  });

  it('saves valid values with the trimmed name', async () => {
    await expect(createLayer('sched-1', layerForm())).resolves.toBeUndefined();

    expect(m.createScheduleLayer).toHaveBeenCalledWith(
      m.tx,
      'sched-1',
      expect.objectContaining({ name: 'Primary', rotationLengthHours: 168 }),
      []
    );
  });
});
