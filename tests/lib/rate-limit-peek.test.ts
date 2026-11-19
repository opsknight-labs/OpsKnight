// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimit = vi.hoisted(() => ({ updateMany: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { rateLimit } }));

import { releaseRateLimit } from '@/lib/rate-limit';

describe('releaseRateLimit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refunds one hit in the window the reservation was taken in', async () => {
    const windowMs = 60_000;
    const windowStart = 29_000_000;
    await releaseRateLimit('k', windowMs, (windowStart + 1) * windowMs);
    expect(rateLimit.updateMany).toHaveBeenCalledWith({
      where: { key: `k:${windowStart}`, count: { gt: 0 } },
      data: { count: { decrement: 1 } },
    });
    expect(rateLimit.upsert).not.toHaveBeenCalled();
  });

  it('keeps the hit counted when the refund fails', async () => {
    rateLimit.updateMany.mockRejectedValueOnce(new Error('down'));
    await expect(releaseRateLimit('k', 60_000, 120_000)).resolves.toBeUndefined();
  });
});
