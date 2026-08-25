import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimit = vi.hoisted(() => ({
  create: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { rateLimit },
}));

import { rejectWebhookReplay } from '@/lib/integrations/request-security';

describe('integration replay claims', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimit.create.mockResolvedValue({});
    rateLimit.updateMany.mockResolvedValue({ count: 0 });
  });

  it('does not deduplicate identical bodies when the provider has no nonce', async () => {
    expect(await rejectWebhookReplay('integration-1', null)).toBe(false);
    expect(await rejectWebhookReplay('integration-1', null)).toBe(false);
    expect(rateLimit.create).not.toHaveBeenCalled();
  });

  it('rejects an unexpired duplicate provider delivery ID', async () => {
    rateLimit.create.mockRejectedValueOnce(new Error('unique constraint'));

    expect(await rejectWebhookReplay('integration-1', 'delivery-1')).toBe(true);
    expect(rateLimit.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ expiresAt: { lte: expect.any(Date) } }),
      })
    );
  });

  it('atomically reclaims an expired provider delivery ID', async () => {
    rateLimit.create.mockRejectedValueOnce(new Error('unique constraint'));
    rateLimit.updateMany.mockResolvedValueOnce({ count: 1 });

    expect(await rejectWebhookReplay('integration-1', 'delivery-1')).toBe(false);
  });
});
