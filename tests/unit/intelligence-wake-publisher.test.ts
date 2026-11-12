import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: mocks.transaction } }));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  mocks.execute.mockResolvedValue(1);
  mocks.transaction.mockImplementation(
    async (run: (tx: { $executeRaw: typeof mocks.execute }) => Promise<unknown>) =>
      run({ $executeRaw: mocks.execute })
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const batches = () =>
  mocks.execute.mock.calls
    .filter(call => String(call[0]).includes('pg_notify'))
    .map(call => JSON.parse(call[2]) as string[]);

describe('post-commit wake throttling', () => {
  it('coalesces a hot incident, retains its trailing dirty wake, and promptly wakes new incidents', async () => {
    const { signalIntelligenceIncident: signal } =
      await import('@/lib/intelligence/jobs/wake-publisher');
    signal('hot');
    await vi.advanceTimersByTimeAsync(10);
    for (let i = 0; i < 100; i++) signal('hot');
    await vi.advanceTimersByTimeAsync(100);
    expect(batches()).toEqual([['hot']]);
    signal('fresh');
    await vi.advanceTimersByTimeAsync(10);
    expect(batches()).toEqual([['hot'], ['fresh']]);
    await vi.advanceTimersByTimeAsync(1900);
    expect(batches()).toEqual([['hot'], ['fresh'], ['hot']]);
  });
  it('does not spin or automatically retry a failed hint', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('private-pool-failure'));
    const { signalIntelligenceIncident: signal } =
      await import('@/lib/intelligence/jobs/wake-publisher');
    signal('hot');
    await vi.advanceTimersByTimeAsync(10000);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    signal('hot');
    await vi.advanceTimersByTimeAsync(10);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
  it('caps pending identifiers and sends at most 50 per batch', async () => {
    const { signalIntelligenceIncident: signal } =
      await import('@/lib/intelligence/jobs/wake-publisher');
    for (let i = 0; i < 10000; i++) signal(`incident-${i}`);
    await vi.runAllTimersAsync();
    expect(batches()).toHaveLength(20);
    expect(batches().every(ids => ids.length <= 50)).toBe(true);
    expect(batches().flat()).toHaveLength(1000);
  });
  it('drops invalid identifiers', async () => {
    const { signalIntelligenceIncident: signal } =
      await import('@/lib/intelligence/jobs/wake-publisher');
    for (const id of ['', 'bad/id', 'x'.repeat(65), 'bad\nvalue']) signal(id);
    await vi.runAllTimersAsync();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
