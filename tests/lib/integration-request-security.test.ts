import { beforeEach, describe, expect, it, vi } from 'vitest';

const inboundDelivery = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { inboundDelivery } }));

import {
  claimInboundDelivery,
  completeInboundDelivery,
  failInboundDelivery,
} from '@/lib/integrations/request-security';

describe('inbound delivery inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inboundDelivery.create.mockResolvedValue({ id: 'delivery-1', attempt: 1 });
    inboundDelivery.updateMany.mockResolvedValue({ count: 1 });
  });

  it('does not claim identical bodies without a provider delivery nonce', async () => {
    expect(await claimInboundDelivery('integration-1', 'GITHUB', null)).toBeNull();
    expect(inboundDelivery.create).not.toHaveBeenCalled();
  });

  it('creates a leased claim for a new provider delivery', async () => {
    const claim = await claimInboundDelivery('integration-1', 'GITHUB', 'delivery-1');

    expect(claim).toMatchObject({ disposition: 'CLAIMED', id: 'delivery-1', attempt: 1 });
    expect(inboundDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ integrationId: 'integration-1', provider: 'GITHUB' }),
      })
    );
  });

  it('returns completed without executing a duplicate delivery', async () => {
    // A standalone build may throw this from a different Prisma runtime, so it
    // must be recognized structurally rather than with `instanceof`.
    inboundDelivery.create.mockRejectedValueOnce({ code: 'P2002', meta: {} });
    inboundDelivery.findUnique.mockResolvedValueOnce({
      id: 'delivery-1',
      status: 'COMPLETED',
      leaseExpiresAt: null,
    });

    expect(await claimInboundDelivery('integration-1', 'GITHUB', 'delivery-1')).toEqual({
      disposition: 'COMPLETED',
    });
  });

  it('waits and resolves to completed when an in-flight delivery finishes during backoff', async () => {
    inboundDelivery.create.mockRejectedValueOnce({ code: 'P2002', meta: {} });
    // First query: PROCESSING with active lease
    inboundDelivery.findUnique.mockResolvedValueOnce({
      id: 'delivery-1',
      status: 'PROCESSING',
      leaseExpiresAt: new Date(Date.now() + 60_000),
    });
    // Second query (after sleep): COMPLETED
    inboundDelivery.findUnique.mockResolvedValueOnce({
      id: 'delivery-1',
      status: 'COMPLETED',
      leaseExpiresAt: null,
    });

    expect(await claimInboundDelivery('integration-1', 'GITHUB', 'delivery-1')).toEqual({
      disposition: 'COMPLETED',
    });
  });

  it('does not allow a stale lease to mark a newer claim completed', async () => {
    const claim = {
      disposition: 'CLAIMED' as const,
      id: 'delivery-1',
      leaseToken: 'lease-old',
      attempt: 1,
    };
    inboundDelivery.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(completeInboundDelivery(claim)).rejects.toThrow('superseded');
  });

  it('makes a failed claim retryable without completing it', async () => {
    const claim = {
      disposition: 'CLAIMED' as const,
      id: 'delivery-1',
      leaseToken: 'lease-1',
      attempt: 1,
    };
    await failInboundDelivery(claim, new Error('temporary database failure'));

    expect(inboundDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) })
    );
  });

  it('reclaims an expired lease after polling with a refreshed cutoff timestamp', async () => {
    inboundDelivery.create.mockRejectedValueOnce({ code: 'P2002' });
    // First query: active lease expiring very shortly (e.g. 10ms)
    inboundDelivery.findUnique.mockResolvedValueOnce({
      id: 'delivery-1',
      status: 'PROCESSING',
      leaseExpiresAt: new Date(Date.now() + 10),
    });
    // Second query (after polling loop): lease has now expired
    inboundDelivery.findUnique.mockResolvedValueOnce({
      id: 'delivery-1',
      status: 'PROCESSING',
      leaseExpiresAt: new Date(Date.now() - 50),
    });
    inboundDelivery.updateMany.mockResolvedValueOnce({ count: 1 });
    inboundDelivery.findUnique.mockResolvedValueOnce({ attempt: 2 });

    const result = await claimInboundDelivery('integration-1', 'GITHUB', 'delivery-1');
    expect(result).toMatchObject({
      disposition: 'CLAIMED',
      id: 'delivery-1',
      attempt: 2,
    });
    // Ensure updateMany used a fresh cutoff predicate
    expect(inboundDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'delivery-1',
          OR: expect.arrayContaining([
            expect.objectContaining({
              status: 'PROCESSING',
              leaseExpiresAt: expect.objectContaining({ lte: expect.any(Date) }),
            }),
          ]),
        }),
      })
    );
  });
});
