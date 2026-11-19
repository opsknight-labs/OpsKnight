// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rateLimit = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { rateLimit } }));

import { isUnderRateLimit } from '@/lib/rate-limit';

describe('isUnderRateLimit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the current window without consuming it', async () => {
    rateLimit.findUnique.mockResolvedValue({ count: 9 });
    await expect(isUnderRateLimit('k', 10, 60_000)).resolves.toBe(true);
    expect(rateLimit.findUnique.mock.calls[0][0].where.key).toBe(
      `k:${Math.floor(Date.now() / 60_000)}`
    );
    expect(rateLimit.upsert).not.toHaveBeenCalled();
  });

  it('blocks at the limit, allows an empty window, and fails closed on DB error', async () => {
    rateLimit.findUnique.mockResolvedValueOnce({ count: 10 });
    await expect(isUnderRateLimit('k', 10, 60_000)).resolves.toBe(false);
    rateLimit.findUnique.mockResolvedValueOnce(null);
    await expect(isUnderRateLimit('k', 10, 60_000)).resolves.toBe(true);
    rateLimit.findUnique.mockRejectedValueOnce(new Error('down'));
    await expect(isUnderRateLimit('k', 10, 60_000)).resolves.toBe(false);
  });
});
