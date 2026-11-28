import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { MAX_ACTIVE_API_KEYS_PER_USER, assertApiKeyCapacity } from '@/lib/api-key-capacity';

function fakeTx(active: number) {
  const count = vi.fn().mockResolvedValue(active);
  const $queryRaw = vi.fn().mockResolvedValue([{ id: 'u1' }]);
  const tx = { apiKey: { count }, $queryRaw } as unknown as Prisma.TransactionClient;
  return { tx, count, $queryRaw };
}

describe('assertApiKeyCapacity', () => {
  it('allows a user below the cap and counts only keys that are neither revoked nor expired', async () => {
    const { tx, count, $queryRaw } = fakeTx(MAX_ACTIVE_API_KEYS_PER_USER - 1);

    await expect(assertApiKeyCapacity(tx, 'u1')).resolves.toBeUndefined();

    // The user row is locked first, so two concurrent creations cannot both pass.
    expect($queryRaw).toHaveBeenCalledTimes(1);
    const where = (count.mock.calls[0][0] as { where: Prisma.ApiKeyWhereInput }).where;
    expect(where).toEqual({
      userId: 'u1',
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    });
  });

  it('refuses the key past the cap with a 409 that names the limit', async () => {
    const { tx } = fakeTx(MAX_ACTIVE_API_KEYS_PER_USER);

    await expect(assertApiKeyCapacity(tx, 'u1')).rejects.toMatchObject({
      code: 'API_KEY_LIMIT_REACHED',
      status: 409,
      message: expect.stringContaining(String(MAX_ACTIVE_API_KEYS_PER_USER)),
    });
  });

  it('caps at 25', () => {
    expect(MAX_ACTIVE_API_KEYS_PER_USER).toBe(25);
  });
});
