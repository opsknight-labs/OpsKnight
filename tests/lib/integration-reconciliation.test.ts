import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { reconcileIntegrationControlPlane } from '@/lib/integrations/reconciliation';

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(async operations => Promise.all(operations)),
    inboundDelivery: { updateMany: vi.fn() },
    chatOpsIntent: { updateMany: vi.fn() },
    externalOperation: { updateMany: vi.fn() },
    incident: { updateMany: vi.fn() },
  },
}));
vi.mock('@/lib/metrics/operational/registry', () => ({ addOperationalMetric: vi.fn() }));

describe('integration control-plane reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.inboundDelivery.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(prisma.chatOpsIntent.updateMany)
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 });
    vi.mocked(prisma.externalOperation.updateMany).mockResolvedValue({ count: 4 });
    vi.mocked(prisma.incident.updateMany).mockResolvedValue({ count: 5 });
  });

  it('recovers response leases without repeating completed domain effects', async () => {
    await expect(
      reconcileIntegrationControlPlane(new Date('2026-09-05T00:00:00Z'))
    ).resolves.toEqual({
      inboundReclaimed: 1,
      chatOpsReclaimed: 5,
      externalReclaimed: 4,
      warRoomsReclaimed: 5,
    });
    expect(prisma.chatOpsIntent.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ status: 'RESPONSE_PROCESSING' }),
        data: expect.objectContaining({ status: 'RESPONSE_PENDING' }),
      })
    );
  });
});
