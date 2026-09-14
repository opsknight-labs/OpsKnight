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

  it('discards stale in-flight reads when invalidated before resolution', async () => {
    let resolveStaleLookup!: (val: unknown) => void;
    const stalePromise = new Promise(resolve => {
      resolveStaleLookup = resolve;
    });

    vi.mocked(prisma.user.findUnique)
      .mockImplementationOnce(() => stalePromise as never)
      .mockResolvedValueOnce({
        id: 'user-1',
        tokenVersion: 5,
        status: 'DISABLED',
        role: 'USER',
      } as never);

    // T0: start read for user-1 (in flight)
    const inFlightPromise = getSessionSecurityProjection('user-1');

    // T1: admin revokes user-1 and invalidates projection while T0 is in flight
    invalidateSessionSecurityProjection('user-1');

    // T2: request B arrives while T0 is STILL IN FLIGHT.
    // It must NOT reuse T0; it must trigger a new lookup.
    const requestBPromise = getSessionSecurityProjection('user-1');

    // T3: old T0 database lookup completes with stale tokenVersion = 4
    resolveStaleLookup({
      id: 'user-1',
      tokenVersion: 4,
      status: 'ACTIVE',
      role: 'USER',
    });

    const [t0Result, t1Result] = await Promise.all([inFlightPromise, requestBPromise]);
    expect(t0Result).toMatchObject({ tokenVersion: 4, status: 'ACTIVE' });
    expect(t1Result).toMatchObject({ tokenVersion: 5, status: 'DISABLED' });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);

    // T4: subsequent read uses cache of fresh result
    const cachedResult = await getSessionSecurityProjection('user-1');
    expect(cachedResult).toMatchObject({ tokenVersion: 5, status: 'DISABLED' });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
