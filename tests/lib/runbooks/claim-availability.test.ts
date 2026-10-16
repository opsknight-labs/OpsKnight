import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const find = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ default: { runbookStepAttempt: { findFirst: find } } }));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
it('coalesces 1000 concurrent idle probes and only caches the negative hint for one second', async () => {
  find.mockResolvedValue(null);
  const { mayHaveAgentWork } = await import('@/lib/runbooks/claim-availability');
  expect(
    (await Promise.all(Array.from({ length: 1000 }, () => mayHaveAgentWork()))).every(
      value => !value
    )
  ).toBe(true);
  expect(find).toHaveBeenCalledTimes(1);
  await mayHaveAgentWork();
  expect(find).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1001);
  find.mockResolvedValue({ id: 'work' });
  expect(await mayHaveAgentWork()).toBe(true);
  expect(await mayHaveAgentWork()).toBe(true);
  expect(find).toHaveBeenCalledTimes(3);
});
it('does not cache database errors or convert an outage to an empty queue', async () => {
  find
    .mockRejectedValueOnce(new Error('database unavailable'))
    .mockResolvedValueOnce({ id: 'work' });
  const { mayHaveAgentWork } = await import('@/lib/runbooks/claim-availability');
  await expect(mayHaveAgentWork()).rejects.toThrow('database unavailable');
  expect(await mayHaveAgentWork()).toBe(true);
});
