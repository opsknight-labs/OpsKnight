import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const drain = createRequire(import.meta.url)('../../scripts/ingestion/downstream-drain.cjs');
function clock() {
  let time = 0;
  return {
    timeoutMs: 100,
    intervalMs: 25,
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}
describe('post-load downstream drain', () => {
  it('waits for processing jobs and requires two empty snapshots', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ type: 'RUNBOOK', status: 'PROCESSING', count: 1, due: 1 }])
      .mockResolvedValue([]);
    const result = await drain({ $queryRaw: query }, clock());
    expect(result.passed).toBe(true);
    expect(query).toHaveBeenCalledTimes(3);
    expect(result.samples.map((row: { due: number }) => row.due)).toEqual([1, 0, 0]);
  });
  it('fails while retryable failures remain even if their next schedule is future', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ type: 'SCHEDULED_TASK', status: 'FAILED', count: 1, due: 0 }]);
    const result = await drain({ $queryRaw: query }, clock());
    expect(result.passed).toBe(false);
    expect(result.samples.at(-1).failed).toBe(1);
  });
  it('does not demand execution of intentional future jobs', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ type: 'ESCALATION', status: 'PENDING', count: 1, due: 0 }]);
    expect((await drain({ $queryRaw: query }, clock())).passed).toBe(true);
  });
});
