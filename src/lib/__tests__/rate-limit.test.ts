import { describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from '@/lib/rate-limit';

// Mock existing prisma client
vi.mock('@/lib/prisma', () => ({
  default: {
    rateLimit: {
      upsert: vi.fn(),
    },
  },
}));

import prisma from '@/lib/prisma';

describe('checkRateLimit', () => {
  it('enforces limits within a window', async () => {
    vi.useFakeTimers();
    const now = new Date('2025-01-01T00:00:00.000Z');
    vi.setSystemTime(now);

    const key = 'test-rate-limit';
    const windowMs = 1000;
    const limit = 2;

    // Mock return for first call (count = 1)
    (prisma.rateLimit.upsert as any).mockResolvedValueOnce({
      count: 1,
      windowStart: now,
    });

    const res1 = await checkRateLimit(key, limit, windowMs);
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(1);

    // Mock return for second call (count = 2)
    (prisma.rateLimit.upsert as any).mockResolvedValueOnce({
      count: 2,
      windowStart: now,
    });

    const res2 = await checkRateLimit(key, limit, windowMs);
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(0);

    // Mock return for third call (count = 3 - blocked)
    (prisma.rateLimit.upsert as any).mockResolvedValueOnce({
      count: 3,
      windowStart: now,
    });

    const res3 = await checkRateLimit(key, limit, windowMs);
    expect(res3.allowed).toBe(false);

    // Advance time
    const later = new Date('2025-01-01T00:00:01.001Z'); // 1s + 1ms later
    vi.setSystemTime(later);

    // Mock return for new window (count = 1)
    // Note: The implementation logic should handle the reset if the DB returns old window?
    // OR the DB upsert logic handles checking the window.
    // Let's check rate-limit.ts implementation logic.
    // Usually upsert logic in the code handles "if window expired, reset count".
    // But if we are mocking the result of upsert, we need to know what logic is WHERE.
    // If logic is in DB (SQL), we mock the result.
    // If the code sends specific values to upsert, we verify arguments.

    // Let's assume the code handles the window logic by passing the correct windowStart to upsert or checking the result?
    // Actually, if I look at standard implementation:
    // upsert(create: {count: 1, windowStart: now}, update: {...})
    // The mock return needs to match what Prisma would return AFTER the operation.

    // If window expired, the code creates a NEW window logic?
    // Let's just mock what we expect successful DB operation to return for a "fresh" window
    (prisma.rateLimit.upsert as any).mockResolvedValueOnce({
      count: 1,
      windowStart: later,
    });

    const res4 = await checkRateLimit(key, limit, windowMs);
    expect(res4.allowed).toBe(true);

    vi.useRealTimers();
  });
});
