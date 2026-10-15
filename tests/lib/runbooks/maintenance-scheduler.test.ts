import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ purge: vi.fn(), transaction: vi.fn(), disconnect: vi.fn() }));
vi.mock('@/lib/runbooks/nonce-cleanup', () => ({ purgeExpiredAgentNonces: mocks.purge }));
vi.mock('@/lib/runbooks/maintenance-db', () => ({
  getRunbookMaintenanceClient: () => ({ $transaction: mocks.transaction }),
  disconnectRunbookMaintenanceClient: mocks.disconnect,
}));
import {
  startRunbookArtifactCleanup,
  stopRunbookArtifactCleanup,
} from '@/lib/runbooks/artifact-cleanup';
afterEach(async () => {
  await stopRunbookArtifactCleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it('bounds nonce cadence, preserves minute artifact cadence and skips overlapping maintenance ticks', async () => {
  vi.useFakeTimers();
  mocks.purge.mockResolvedValue({});
  let release!: (value: {
    count: number;
    bytes: number;
    skipped: boolean;
    oldestExpiredAgeSeconds: number;
  }) => void;
  mocks.transaction.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        release = resolve;
      })
  );
  startRunbookArtifactCleanup();
  startRunbookArtifactCleanup();
  await vi.advanceTimersByTimeAsync(59000);
  expect(mocks.purge).toHaveBeenCalledTimes(59);
  expect(mocks.transaction).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4000);
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
  expect(mocks.purge).toHaveBeenCalledTimes(59);
  release({ count: 0, bytes: 0, skipped: false, oldestExpiredAgeSeconds: 0 });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.purge).toHaveBeenCalledTimes(60);
  await stopRunbookArtifactCleanup();
  await vi.advanceTimersByTimeAsync(60000);
  expect(mocks.purge).toHaveBeenCalledTimes(60);
});

it('keeps both maintenance tasks scheduled when one batch fails', async () => {
  vi.useFakeTimers();
  mocks.purge.mockRejectedValueOnce(new Error('Nonce timeout')).mockResolvedValue({});
  mocks.transaction.mockRejectedValueOnce(new Error('Artifact timeout'));
  startRunbookArtifactCleanup();
  await vi.advanceTimersByTimeAsync(61000);
  expect(mocks.purge).toHaveBeenCalledTimes(61);
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
});
