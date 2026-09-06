import { describe, expect, it, vi } from 'vitest';
import { acquireAdvisoryLock, tryAdvisoryLock } from '@/lib/db-locks';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('database advisory locks', () => {
  it('accepts a supported boolean result after acquiring the lock', async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]) };
    await expect(acquireAdvisoryLock(tx as never, BigInt(9141001))).resolves.toBeUndefined();
  });

  it('fails closed so the surrounding transaction can roll back', async () => {
    const error = new Error('transaction aborted');
    const tx = { $queryRaw: vi.fn().mockRejectedValue(error) };
    await expect(acquireAdvisoryLock(tx as never, BigInt(9141001))).rejects.toBe(error);
  });

  it('distinguishes lock contention from a failed lock query', async () => {
    const contended = {
      $queryRaw: vi.fn().mockResolvedValue([{ pg_try_advisory_xact_lock: false }]),
    };
    await expect(tryAdvisoryLock(contended as never, BigInt(9141002))).resolves.toBe(false);

    const error = new Error('connection lost');
    const failed = { $queryRaw: vi.fn().mockRejectedValue(error) };
    await expect(tryAdvisoryLock(failed as never, BigInt(9141002))).rejects.toBe(error);
  });
});
