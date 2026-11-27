import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/logger', () => ({ logger: { warn } }));
import { warnAndContinue } from '@/lib/intelligence/conversations/warn';

beforeEach(() => warn.mockReset());

describe('warnAndContinue', () => {
  it('logs the failure by name, without the message, and lets the caller carry on', async () => {
    const result = await Promise.reject(new TypeError('secret detail')).catch(
      warnAndContinue('Could not start queued background answers')
    );
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[Squire] Could not start queued background answers', {
      error: 'TypeError',
    });
  });

  it('copes with a rejection that is not an Error', async () => {
    await Promise.reject('plain').catch(warnAndContinue('x'));
    expect(warn).toHaveBeenCalledWith('[Squire] x', { error: 'error' });
  });
});
