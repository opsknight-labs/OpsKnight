import { describe, expect, it, vi } from 'vitest';
import { createScheduleLayer } from '@/lib/schedules/layer-commands';

function scheduleTx(users: Array<{ name: string; role: string }>) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    onCallSchedule: { findUnique: vi.fn().mockResolvedValue({ id: 'sched-1' }) },
    onCallLayer: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
    onCallLayerUser: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { findMany: vi.fn().mockResolvedValue(users) },
  };
}

const values = {
  name: 'Primary',
  start: new Date('2026-11-23T00:00:00.000Z'),
  end: null,
  rotationLengthHours: 24,
  shiftLengthHours: null,
  restrictions: null,
};

describe('schedule layer membership', () => {
  it('rejects a stakeholder responder before writing the layer', async () => {
    const tx = scheduleTx([
      { name: 'Rae', role: 'RESPONDER' },
      { name: 'Sam', role: 'STAKEHOLDER' },
    ]);

    await expect(
      createScheduleLayer(tx as never, 'sched-1', values, ['rae', 'sam'])
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      userMessage: expect.stringContaining('Sam is a stakeholder'),
    });
    expect(tx.onCallLayer.create).not.toHaveBeenCalled();
  });
});
