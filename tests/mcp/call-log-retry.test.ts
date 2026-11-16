import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ default: { mcpCallLog: { createMany } } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));

import {
  flushMcpCallLog,
  queuedMcpCallLogForTests,
  recordMcpCallLog,
} from '@/lib/mcp/core/call-log';

const row = (requestId: string) => ({
  grantId: 'g',
  tool: 'whoami',
  operationId: null,
  outcome: 'ok',
  durationMs: 1,
  requestId,
  errorCode: null,
});
const written = (call: number) =>
  (createMany.mock.calls.at(call)![0] as { data: { requestId: string }[] }).data.map(
    entry => entry.requestId
  );

describe('MCP activity log writes', () => {
  beforeEach(() => createMany.mockReset());

  it('keeps a failed batch and writes it with the next flush', async () => {
    createMany.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ count: 2 });
    recordMcpCallLog(row('a'));
    await flushMcpCallLog();
    expect(queuedMcpCallLogForTests()).toBe(1);
    recordMcpCallLog(row('b'));
    await flushMcpCallLog();
    expect(written(1)).toEqual(['a', 'b']);
    expect(queuedMcpCallLogForTests()).toBe(0);
  });

  it('drops a batch that fails twice so a long outage cannot grow memory', async () => {
    createMany.mockRejectedValue(new Error('down'));
    recordMcpCallLog(row('a'));
    await flushMcpCallLog();
    recordMcpCallLog(row('b'));
    await flushMcpCallLog();
    // "a" failed twice and is gone; "b" failed once and waits for one more try.
    expect(queuedMcpCallLogForTests()).toBe(1);
    createMany.mockResolvedValue({ count: 1 });
    await flushMcpCallLog();
    expect(written(2)).toEqual(['b']);
  });
});
