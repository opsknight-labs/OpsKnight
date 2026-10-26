import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const resources = createRequire(import.meta.url)('../../scripts/ingestion/database-resources.cjs');
it('rejects malformed cgroup evidence rather than reporting zero contention', () => {
  expect(() => resources.parseCounters('usage_usec unknown')).toThrow();
  expect(() => resources.parseCounters('usage_usec -1')).toThrow();
});
describe('database resource evidence', () => {
  it('keeps shared VM memory separate from owned database counters', async () => {
    const invoke = vi.fn(async (args: string[]) => {
      switch (args.at(-1)) {
        case '/sys/fs/cgroup/cpu.stat':
          return 'usage_usec 10\nnr_throttled 2\n';
        case '/sys/fs/cgroup/memory.current':
          return '1234';
        case '/sys/fs/cgroup/memory.peak':
          return '2345';
        case '/sys/fs/cgroup/memory.events':
          return 'oom 0\noom_kill 0';
        default:
          return 'MemTotal: 8000 kB\nMemAvailable: 4000 kB\nUnrelated: 999 kB\n';
      }
    });
    const result = await resources(invoke, 'owned-test-pg');
    expect(result.cpu).toEqual({ usage_usec: 10, nr_throttled: 2 });
    expect(result.memoryCurrentBytes).toBe(1234);
    expect(result.vmMemoryKiB).toEqual({ MemTotal: 8000, MemAvailable: 4000 });
    expect(invoke).toHaveBeenCalledTimes(5);
  });
});
