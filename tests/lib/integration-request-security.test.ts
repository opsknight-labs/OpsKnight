import { beforeEach, describe, expect, it, vi } from 'vitest';

const backgroundJob = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { backgroundJob },
}));

import {
  claimWebhookDelivery,
  completeWebhookDelivery,
  failWebhookDelivery,
} from '@/lib/integrations/request-security';

describe('durable inbound integration delivery claims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backgroundJob.create.mockResolvedValue({});
    backgroundJob.findUnique.mockResolvedValue(null);
    backgroundJob.updateMany.mockResolvedValue({ count: 0 });
  });

  it('does not invent deduplication when the provider has no delivery identity', async () => {
    expect(await claimWebhookDelivery('integration-1', 'provider', null)).toEqual({ tracked: false });
    expect(backgroundJob.create).not.toHaveBeenCalled();
  });

  it('acquires a new provider delivery as PROCESSING', async () => {
    const claim = await claimWebhookDelivery('integration-1', 'github', 'delivery-1');
    expect(claim).toMatchObject({ tracked: true, state: 'ACQUIRED' });
    expect(backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PROCESSING', type: 'SCHEDULED_TASK' }),
      })
    );
  });

  it('treats only a successfully completed delivery as a safe duplicate', async () => {
    backgroundJob.create.mockRejectedValueOnce(new Error('unique constraint'));
    backgroundJob.findUnique.mockResolvedValueOnce({ status: 'COMPLETED' });

    expect(await claimWebhookDelivery('integration-1', 'github', 'delivery-1')).toMatchObject({
      tracked: true,
      state: 'SUCCEEDED',
    });
    expect(backgroundJob.updateMany).not.toHaveBeenCalled();
  });

  it('does not allow two replicas to own a live delivery concurrently', async () => {
    backgroundJob.create.mockRejectedValueOnce(new Error('unique constraint'));
    backgroundJob.findUnique
      .mockResolvedValueOnce({ status: 'PROCESSING' })
      .mockResolvedValueOnce({ status: 'PROCESSING' });

    expect(await claimWebhookDelivery('integration-1', 'github', 'delivery-1')).toMatchObject({
      tracked: true,
      state: 'IN_PROGRESS',
    });
  });

  it('reclaims a failed delivery so a provider retry can process it', async () => {
    backgroundJob.create.mockRejectedValueOnce(new Error('unique constraint'));
    backgroundJob.findUnique.mockResolvedValueOnce({ status: 'FAILED' });
    backgroundJob.updateMany.mockResolvedValueOnce({ count: 1 });

    expect(await claimWebhookDelivery('integration-1', 'github', 'delivery-1')).toMatchObject({
      tracked: true,
      state: 'ACQUIRED',
    });
    expect(backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
        data: expect.objectContaining({ status: 'PROCESSING' }),
      })
    );
  });

  it('can reclaim a crashed owner after its PROCESSING lease expires', async () => {
    backgroundJob.create.mockRejectedValueOnce(new Error('unique constraint'));
    backgroundJob.findUnique.mockResolvedValueOnce({ status: 'PROCESSING' });
    backgroundJob.updateMany.mockResolvedValueOnce({ count: 1 });

    const claim = await claimWebhookDelivery('integration-1', 'github', 'delivery-1');
    expect(claim).toMatchObject({ tracked: true, state: 'ACQUIRED' });
    expect(backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ status: 'PROCESSING', startedAt: { lte: expect.any(Date) } }),
          ]),
        }),
      })
    );
  });

  it('marks a delivery completed only after the caller reports business success', async () => {
    const claim = { tracked: true, id: 'inbound-delivery:test', state: 'ACQUIRED' } as const;
    backgroundJob.updateMany.mockResolvedValueOnce({ count: 1 });

    await completeWebhookDelivery(claim);
    expect(backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) })
    );
  });

  it('marks a failed processing attempt reclaimable instead of poisoning future retries', async () => {
    const claim = { tracked: true, id: 'inbound-delivery:test', state: 'ACQUIRED' } as const;
    backgroundJob.updateMany.mockResolvedValueOnce({ count: 1 });

    await failWebhookDelivery(claim, new Error('temporary database outage'));
    expect(backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', error: 'temporary database outage' }),
      })
    );
  });
});
