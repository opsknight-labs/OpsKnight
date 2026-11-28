import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { revokeSubscriptionsLosingLastSelection } from '@/lib/status-pages/subscriber-administration';

function fakeTx(ids: string[]) {
  const tx = {
    statusPageSubscription: {
      findMany: vi.fn().mockResolvedValue(ids.map(id => ({ id }))),
      updateMany: vi.fn().mockResolvedValue({ count: ids.length }),
    },
    notification: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  return tx;
}

describe('revokeSubscriptionsLosingLastSelection', () => {
  it('selects only subscribers whose single pick is the deleted service', async () => {
    const tx = fakeTx(['sub-1']);
    await revokeSubscriptionsLosingLastSelection(tx as unknown as Prisma.TransactionClient, {
      serviceId: 'svc-x',
    });
    expect(tx.statusPageSubscription.findMany).toHaveBeenCalledWith({
      where: {
        selectedServices: { some: { serviceId: 'svc-x' }, every: { serviceId: 'svc-x' } },
        selectedBusinessServices: { none: {} },
      },
      select: { id: true },
    });
  });

  it('selects only subscribers whose single pick is the deleted business service', async () => {
    const tx = fakeTx([]);
    await revokeSubscriptionsLosingLastSelection(tx as unknown as Prisma.TransactionClient, {
      businessServiceId: 'bs-1',
    });
    expect(tx.statusPageSubscription.findMany).toHaveBeenCalledWith({
      where: {
        selectedBusinessServices: {
          some: { businessServiceId: 'bs-1' },
          every: { businessServiceId: 'bs-1' },
        },
        selectedServices: { none: {} },
      },
      select: { id: true },
    });
    expect(tx.statusPageSubscription.updateMany).not.toHaveBeenCalled();
  });

  it('unsubscribes consent states, keeps suppression states and skips queued mail', async () => {
    const tx = fakeTx(['sub-1', 'sub-2']);
    await expect(
      revokeSubscriptionsLosingLastSelection(tx as unknown as Prisma.TransactionClient, {
        serviceId: 'svc-x',
      })
    ).resolves.toBe(2);
    const [revoke, keepSuppression] = tx.statusPageSubscription.updateMany.mock.calls.map(
      call => call[0]
    );
    expect(revoke.where).toMatchObject({ id: { in: ['sub-1', 'sub-2'] } });
    expect(revoke.data).toMatchObject({ state: 'UNSUBSCRIBED' });
    expect(keepSuppression.data).not.toHaveProperty('state');
    expect(tx.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SKIPPED' }) })
    );
  });
});
