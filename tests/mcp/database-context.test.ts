import { describe, expect, it } from 'vitest';
import { withMcpDatabase, isMcpDatabaseWorkload } from '@/lib/database-workload';

describe('database workload isolation', () => {
  it('retains MCP context across nested async calls without leaking into concurrent work', async () => {
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const paused = new Promise<void>(resolve => {
      resume = resolve;
    });
    const mcp = withMcpDatabase(async () => {
      expect(isMcpDatabaseWorkload()).toBe(true);
      entered();
      await paused;
      expect(isMcpDatabaseWorkload()).toBe(true);
      await withMcpDatabase(async () => {
        await Promise.resolve();
        expect(isMcpDatabaseWorkload()).toBe(true);
      });
    });
    await started;
    expect(isMcpDatabaseWorkload()).toBe(false);
    resume();
    await mcp;
    expect(isMcpDatabaseWorkload()).toBe(false);
    await expect(
      withMcpDatabase(async () => {
        throw new Error('domain failure');
      })
    ).rejects.toThrow();
    expect(isMcpDatabaseWorkload()).toBe(false);
  });
});
