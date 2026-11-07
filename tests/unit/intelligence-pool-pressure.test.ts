import { describe, expect, it, vi } from 'vitest';
import { getPrismaPoolWaitCount } from '@/lib/prisma-pool-pressure';
import { evaluateLanePause } from '@/lib/intelligence/jobs/backpressure';

describe('database capacity protection', () => {
  it('reads the engine gauge without issuing SQL', async () => {
    const client = {
      $metrics: {
        json: vi.fn().mockResolvedValue({
          gauges: [
            { key: 'prisma_pool_connections_busy', value: 20 },
            { key: 'prisma_client_queries_wait', value: 3 },
          ],
        }),
      },
    };
    expect(await getPrismaPoolWaitCount(client)).toBe(3);
    expect(client.$metrics.json).toHaveBeenCalledOnce();
  });

  it('keeps unavailable, missing and invalid observations distinct from zero waiting', async () => {
    for (const value of [undefined, -1, NaN, Infinity]) {
      const client = {
        $metrics: {
          json: async () => ({
            gauges: value === undefined ? [] : [{ key: 'prisma_client_queries_wait', value }],
          }),
        },
      };
      expect(await getPrismaPoolWaitCount(client)).toBeNull();
    }
    expect(
      await getPrismaPoolWaitCount({
        $metrics: {
          json: async () => {
            throw new Error('private');
          },
        },
      })
    ).toBeNull();
    expect(
      await getPrismaPoolWaitCount({
        $metrics: {
          json: async () => ({ gauges: [{ key: 'prisma_client_queries_wait', value: 0 }] }),
        },
      })
    ).toBe(0);
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
