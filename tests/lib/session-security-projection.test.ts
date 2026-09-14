import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import {
  getSessionSecurityProjection,
  invalidateSessionSecurityProjection,
  resetSessionSecurityProjectionCache,
} from '@/lib/session-security-projection';

describe('session security projection', () => {
  beforeEach(() => {
    resetSessionSecurityProjectionCache();
    vi.mocked(prisma.user.findUnique).mockReset();
  });

  it('deduplicates concurrent and repeated security reads', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      tokenVersion: 4,
      status: 'ACTIVE',
      role: 'RESPONDER',
    } as never);

    const [first, second] = await Promise.all([
      getSessionSecurityProjection('user-1'),
      getSessionSecurityProjection('user-1'),
    ]);
    const third = await getSessionSecurityProjection('user-1');

    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads fresh security state after explicit invalidation', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        id: 'user-1',
        tokenVersion: 4,
        status: 'ACTIVE',
        role: 'USER',
      } as never)
      .mockResolvedValueOnce({
        id: 'user-1',
        tokenVersion: 5,
        status: 'DISABLED',
        role: 'USER',
      } as never);

    await getSessionSecurityProjection('user-1');
    invalidateSessionSecurityProjection('user-1');
    const updated = await getSessionSecurityProjection('user-1');

    expect(updated).toMatchObject({ tokenVersion: 5, status: 'DISABLED' });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('does not request profile fields', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await getSessionSecurityProjection('missing');

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'missing' },
      select: { id: true, tokenVersion: true, status: true, role: true },
    });
  });
});
