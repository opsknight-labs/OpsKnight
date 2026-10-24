import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const start = createRequire(import.meta.url)('../../scripts/ingestion/backlog-sampler.cjs');

afterEach(() => vi.useRealTimers());
describe('offered-load backlog sampler', () => {
  it('samples both stages before drain, stops once and never records service identities', async () => {
    vi.useFakeTimers();
    const db = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const stop = await start(db, 'private-fixture', 1000);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await stop();
    expect(result.samples).toHaveLength(3);
    expect(db.$queryRaw).toHaveBeenCalledTimes(6);
    expect(result.passed).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-fixture');
    expect(await stop()).toBe(result);
    await vi.advanceTimersByTimeAsync(5000);
    expect(db.$queryRaw).toHaveBeenCalledTimes(6);
  });

  it('reports query failures without retaining raw errors', async () => {
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error('private SQL payload')) };
    const stop = await start(db, 'private-fixture');
    const result = await stop();
    expect(result.passed).toBe(false);
    expect(result.errors).toBe(2);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('does not overlap a slow sample with another poll', async () => {
    vi.useFakeTimers();
    const db = { $queryRaw: vi.fn().mockResolvedValue([]) };
    const stop = await start(db, 'fixture', 1000);
    let release: (value: unknown[]) => void = () => {};
    const pending = new Promise(resolve => {
      release = resolve;
    });
    db.$queryRaw.mockReturnValue(pending);
    await vi.advanceTimersByTimeAsync(5000);
    expect(db.$queryRaw).toHaveBeenCalledTimes(4);
    release([]);
    await stop();
    expect(db.$queryRaw).toHaveBeenCalledTimes(6);
  });
});
