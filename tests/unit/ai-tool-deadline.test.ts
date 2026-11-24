import { describe, expect, it, vi } from 'vitest';
import { ToolDeadlineError, withToolDeadline } from '@/lib/intelligence/ai/gateway';

describe('tool deadline', () => {
  it('passes a prompt result through and stops a slow one', async () => {
    expect(await withToolDeadline(Promise.resolve('ok'), 50)).toBe('ok');
    vi.useFakeTimers();
    try {
      const slow = withToolDeadline(new Promise(() => undefined), 20_000);
      const settled = expect(slow).rejects.toBeInstanceOf(ToolDeadlineError);
      await vi.advanceTimersByTimeAsync(20_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the tool’s own error', async () => {
    await expect(withToolDeadline(Promise.reject(new Error('db down')), 50)).rejects.toThrow(
      'db down'
    );
  });
});
