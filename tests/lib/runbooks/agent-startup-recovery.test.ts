import { expect, it, vi } from 'vitest';
import { recoverStartup } from '../../../agent/src/connection';
it('recovers initialization without restart and uses bounded backoff', async () => {
  const operation = vi
    .fn()
    .mockRejectedValueOnce(new Error('fetch failed'))
    .mockRejectedValueOnce(new Error('ECONNRESET'))
    .mockResolvedValue('identity');
  const wait = vi.fn().mockResolvedValue(undefined);
  const report = vi.fn().mockResolvedValue(undefined);
  expect(await recoverStartup(operation, { wait, report })).toBe('identity');
  expect(wait.mock.calls.map(call => call[0])).toEqual([1000, 2000]);
  expect(report).toHaveBeenCalledTimes(2);
});
it('does not retry invalid credentials or corrupt local identity storage', async () => {
  const error = Object.assign(new Error('Enrollment rejected'), { status: 401 });
  const operation = vi.fn().mockRejectedValue(error);
  await expect(recoverStartup(operation, { report: async () => {} })).rejects.toBe(error);
  expect(operation).toHaveBeenCalledTimes(1);
  const corrupt = vi.fn().mockRejectedValue(new SyntaxError('Invalid identity JSON'));
  await expect(recoverStartup(corrupt, { report: async () => {} })).rejects.toBeInstanceOf(
    SyntaxError
  );
});
it('cancels disconnected initialization promptly', async () => {
  const controller = new AbortController();
  const operation = vi.fn().mockRejectedValue(new Error('fetch failed'));
  await expect(
    recoverStartup(operation, {
      signal: controller.signal,
      report: async () => {
        controller.abort();
      },
    })
  ).rejects.toThrow('cancelled');
  expect(operation).toHaveBeenCalledTimes(1);
});
