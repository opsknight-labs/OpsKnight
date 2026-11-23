import { describe, expect, it } from 'vitest';
import { createPrismaClient } from '@/lib/db/create-client';
import { getPrismaPoolWaitCount } from '@/lib/prisma-pool-pressure';
import { evaluateLanePause } from '@/lib/intelligence/jobs/backpressure';

describe('database capacity protection', () => {
  it('reads the pg pool waiting count without issuing SQL', async () => {
    const client = createPrismaClient({ url: 'postgresql://u:p@127.0.0.1:1/db' });
    // No connection has been opened yet, so nothing is waiting; the reader never touches the database.
    expect(await getPrismaPoolWaitCount(client)).toBe(0);
  });

  it('keeps clients it cannot observe distinct from zero waiting', async () => {
    expect(await getPrismaPoolWaitCount({})).toBeNull();
    expect(await getPrismaPoolWaitCount(createPrismaClient({ url: '' }))).toBeNull();
  });

  it('pauses on contention and requires two consecutive measured quiet samples', () => {
    const busy = evaluateLanePause({ paused: false }, 0, 15000, 1);
    expect(busy).toMatchObject({ paused: true, changed: true, poolRecoverySamples: 2 });
    const quiet = evaluateLanePause(busy, 0, 15000, 0);
    expect(quiet).toMatchObject({ paused: true, poolRecoverySamples: 1 });
    expect(evaluateLanePause(quiet, 0, 15000, null)).toMatchObject({
      paused: true,
      poolRecoverySamples: 1,
    });
    const again = evaluateLanePause(quiet, 0, 15000, 1);
    expect(again.poolRecoverySamples).toBe(2);
    const recovered = evaluateLanePause(evaluateLanePause(again, 0, 15000, 0), 0, 15000, 0);
    expect(recovered).toMatchObject({ paused: false, changed: true });
  });

  it('retains paging hysteresis independently of pool recovery', () => {
    const lag = evaluateLanePause({ paused: false }, 16000, 15000, 0);
    expect(lag.paused).toBe(true);
    expect(evaluateLanePause(lag, 10000, 15000, 0).paused).toBe(true);
    expect(evaluateLanePause(lag, 7000, 15000, 0).paused).toBe(false);
    expect(evaluateLanePause({ paused: false }, 0, 15000, null).paused).toBe(false);
    const pool = evaluateLanePause({ paused: false }, 0, 15000, 1);
    const mixed = evaluateLanePause(pool, 20000, 15000, 0);
    expect(evaluateLanePause(mixed, 10000, 15000, 0).paused).toBe(true);
  });
});
