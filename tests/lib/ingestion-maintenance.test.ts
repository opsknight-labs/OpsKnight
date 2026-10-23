import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  db: {},
  mode: 'postgres',
  tasks: Array.from({ length: 5 }, () => vi.fn()),
}));
vi.mock('@/lib/maintenance/database', () => ({ getMaintenanceClient: () => fixture.db }));
vi.mock('@/lib/ingestion/config', () => ({ ingestionConfig: () => ({ mode: fixture.mode }) }));
vi.mock('@/lib/ingestion/retention', () => ({
  pruneCompletedIngestionPayloads: fixture.tasks[0],
  pruneSharedIngestionPayloads: fixture.tasks[1],
  pruneExpiredIngestionReceipts: fixture.tasks[2],
  pruneExpiredIngestionBatches: fixture.tasks[3],
  pruneInactiveIngestionQuotas: fixture.tasks[4],
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
import { startIngestionMaintenance, stopIngestionMaintenance } from '@/lib/ingestion/maintenance';

describe('isolated ingestion maintenance scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fixture.mode = 'postgres';
    for (const task of fixture.tasks) task.mockReset().mockResolvedValue(0);
  });
  afterEach(async () => {
    await stopIngestionMaintenance();
    vi.useRealTimers();
  });
  it('continues other cleanup classes after a failure and backs off the failed class', async () => {
    fixture.tasks[0].mockRejectedValue(new Error('database unavailable'));
    startIngestionMaintenance();
    await vi.advanceTimersByTimeAsync(2000);
    for (const task of fixture.tasks) {
      expect(task).toHaveBeenCalledTimes(1);
      expect(task).toHaveBeenCalledWith(fixture.db);
    }
    await vi.advanceTimersByTimeAsync(60000);
    expect(fixture.tasks[0]).toHaveBeenCalledTimes(2);
  });
  it('bounds a perpetual backlog and rotates all cleanup classes', async () => {
    for (const task of fixture.tasks) task.mockResolvedValue(100);
    startIngestionMaintenance();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.tasks.reduce((sum, task) => sum + task.mock.calls.length, 0)).toBe(20);
    for (const task of fixture.tasks) expect(task).toHaveBeenCalledTimes(4);
  });
  it('does not overlap slow batches and waits for them before shutdown', async () => {
    let release!: (count: number) => void;
    fixture.tasks[0].mockImplementation(
      () =>
        new Promise<number>(resolve => {
          release = resolve;
        })
    );
    startIngestionMaintenance();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fixture.tasks[0]).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = stopIngestionMaintenance().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release(0);
    await stopping;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fixture.tasks[0]).toHaveBeenCalledTimes(1);
  });
  it('leaves synchronous deployments without a maintenance timer', async () => {
    fixture.mode = 'sync';
    startIngestionMaintenance();
    await vi.advanceTimersByTimeAsync(10000);
    for (const task of fixture.tasks) expect(task).not.toHaveBeenCalled();
  });
});
