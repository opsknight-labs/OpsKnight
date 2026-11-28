import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { onCallSchedule: { findMany: mocks.findMany } } }));

import { getActiveOnCallShifts } from '@/lib/oncall-shifts';

const person = (id: string) => ({
  id,
  name: `User ${id}`,
  email: `${id}@example.com`,
  avatarUrl: null,
  gender: null,
  status: 'ACTIVE',
  timeZone: null,
  emailNotificationsEnabled: false,
});

function schedule(overrides: unknown[] = []) {
  return {
    id: 'sched-1',
    name: 'Primary',
    timeZone: 'UTC',
    layers: [
      {
        id: 'layer-1',
        name: 'Weekly',
        start: new Date('2026-01-05T00:00:00Z'),
        end: null,
        rotationLengthHours: 168,
        shiftLengthHours: null,
        restrictions: null,
        priority: 1,
        users: [
          { userId: 'a', position: 0, user: person('a') },
          { userId: 'b', position: 1, user: person('b') },
        ],
      },
    ],
    overrides,
  };
}

describe('getActiveOnCallShifts shift end', () => {
  beforeEach(() => mocks.findMany.mockReset());

  it('reports the real handoff of a weekly rotation, not the end of the read window', async () => {
    mocks.findMany.mockResolvedValue([schedule()]);
    const at = new Date('2026-01-07T12:00:00Z');

    const [shift] = await getActiveOnCallShifts(at);

    expect(shift.userId).toBe('a');
    // 5.5 days ahead; the read window only reaches 48 hours.
    expect(shift.end.toISOString()).toBe('2026-01-12T00:00:00.000Z');
  });

  it('ends the shift where a later override takes over', async () => {
    mocks.findMany.mockResolvedValue([
      schedule([
        {
          id: 'ov-1',
          userId: 'b',
          start: new Date('2026-01-10T00:00:00Z'),
          end: new Date('2026-01-10T06:00:00Z'),
          replacesUserId: 'a',
          user: { ...person('b'), status: undefined },
        },
      ]),
    ]);

    const [shift] = await getActiveOnCallShifts(new Date('2026-01-07T12:00:00Z'));

    expect(shift.end.toISOString()).toBe('2026-01-10T00:00:00.000Z');
  });
});
