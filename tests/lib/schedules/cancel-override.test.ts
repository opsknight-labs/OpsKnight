import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db-utils', () => ({ runSerializableTransaction: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { cancelScheduleOverrideMutation } from '@/lib/schedules/mutations';

const now = new Date('2026-03-10T12:00:00Z');

function tx(override: { start: string; end: string } | null) {
  return {
    onCallOverride: {
      findFirst: vi.fn().mockResolvedValue(
        override && {
          id: 'ovr-1',
          userId: 'user-2',
          replacesUserId: 'user-1',
          start: new Date(override.start),
          end: new Date(override.end),
        }
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('cancelScheduleOverrideMutation', () => {
  it('removes an override that has not started', async () => {
    const client = tx({ start: '2026-03-11T00:00:00Z', end: '2026-03-12T00:00:00Z' });

    const result = await cancelScheduleOverrideMutation('sched-1', 'ovr-1', client as never, now);

    expect(result.outcome).toBe('DELETED');
    expect(client.onCallOverride.deleteMany).toHaveBeenCalled();
    expect(client.onCallOverride.updateMany).not.toHaveBeenCalled();
  });

  it('ends an override in progress now instead of erasing what it served', async () => {
    const client = tx({ start: '2026-03-10T09:00:00Z', end: '2026-03-10T17:00:00Z' });

    const result = await cancelScheduleOverrideMutation('sched-1', 'ovr-1', client as never, now);

    expect(result).toMatchObject({ outcome: 'ENDED', end: now });
    expect(client.onCallOverride.updateMany).toHaveBeenCalledWith({
      where: { id: 'ovr-1', scheduleId: 'sched-1', end: { gt: now } },
      data: { end: now },
    });
    expect(client.onCallOverride.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses to delete an override that has finished', async () => {
    const client = tx({ start: '2026-03-09T09:00:00Z', end: '2026-03-09T17:00:00Z' });

    await expect(
      cancelScheduleOverrideMutation('sched-1', 'ovr-1', client as never, now)
    ).rejects.toMatchObject({ code: 'SCHEDULE_OVERRIDE_CONFLICT' });
    expect(client.onCallOverride.deleteMany).not.toHaveBeenCalled();
    expect(client.onCallOverride.updateMany).not.toHaveBeenCalled();
  });

  it('reports a missing override', async () => {
    await expect(
      cancelScheduleOverrideMutation('sched-1', 'ovr-x', tx(null) as never, now)
    ).rejects.toMatchObject({ code: 'SCHEDULE_OVERRIDE_NOT_FOUND' });
  });
});
