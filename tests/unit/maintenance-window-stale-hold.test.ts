import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  // A held incident that an integration acknowledged, then a person suppressed: still linked to
  // the window, but the maintenance-window SLA pause is gone.
  const linked = { value: 1 };
  const tx = {
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 0),
    incident: {
      findUnique: vi.fn(async () => ({
        status: 'SUPPRESSED',
        maintenanceWindowId: 'win-1',
        serviceId: 'svc-1',
      })),
      update: vi.fn(async () => {
        linked.value = 0;
      }),
      count: vi.fn(async () => linked.value),
    },
    incidentSlaPause: { findFirst: vi.fn(async () => null) },
    maintenanceWindow: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  const prisma = {
    maintenanceWindow: {
      findUnique: vi.fn(async () => ({
        endsAt: new Date('2026-11-01T00:00:00Z'),
        endProcessedAt: null,
        endBehavior: 'RESUME_FIRING',
      })),
    },
    incident: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce([{ id: 'inc-1' }])
        .mockResolvedValue([]),
    },
    $transaction: vi.fn(async (callback: (t: unknown) => unknown) => callback(tx)),
  };
  return { tx, prisma, linked };
});

vi.mock('@/lib/prisma', () => ({ default: db.prisma }));
vi.mock('@/lib/db-utils', () => ({
  runReadCommittedTransaction: async (callback: (t: unknown) => unknown) => callback(db.tx),
}));

import { processEndedMaintenanceWindow } from '@/lib/service-maintenance/windows';

describe('ending a maintenance window', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drops a stale link and finishes instead of retrying forever', async () => {
    const result = await processEndedMaintenanceWindow('win-1', new Date('2026-11-02T00:00:00Z'));

    expect(db.tx.incident.update).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: { maintenanceWindow: { disconnect: true } },
    });
    expect(result).toEqual({ released: 0, complete: true });
    expect(db.tx.maintenanceWindow.updateMany).toHaveBeenCalled();
  });
});
