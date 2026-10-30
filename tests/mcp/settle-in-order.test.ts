import { describe, expect, it } from 'vitest';
import { settleInOrder } from '@/lib/mcp/protocol/server';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('settleInOrder (incident_get_context reads)', () => {
  it('runs reads concurrently up to the bound and returns results by position', async () => {
    let active = 0;
    let peak = 0;
    const read = (value: number, ms: number) => async () => {
      active++;
      peak = Math.max(peak, active);
      await delay(ms);
      active--;
      return value;
    };
    expect(await settleInOrder([read(1, 40), read(2, 10), read(3, 10)], 2)).toEqual([1, 2, 3]);
    expect(peak).toBe(2);
  });

  it('fails with the first failing read by position, as sequential reads would', async () => {
    const late = new Error('first');
    const early = new Error('second');
    let thirdStarted = false;
    await expect(
      settleInOrder(
        [
          async () => {
            await delay(30);
            throw late;
          },
          async () => {
            throw early;
          },
          async () => {
            thirdStarted = true;
            return 3;
          },
        ],
        2
      )
    ).rejects.toBe(late);
    // Nothing new starts after a failure.
    expect(thirdStarted).toBe(false);
  });
});
