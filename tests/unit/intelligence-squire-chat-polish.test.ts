import { describe, expect, it, vi } from 'vitest';
import { createDeltaBatcher } from '@/components/squire/delta-batcher';
import {
  retryAfterUntil,
  squireAvailabilityState,
} from '@/components/squire/SquireAvailabilityNotice';
import { aiLimitFrom } from '@/lib/intelligence/squire/contract';
import { KEYBOARD_SHORTCUTS } from '@/lib/keyboard-shortcuts';

function manualFrames() {
  const queue: Array<() => void> = [];
  return {
    schedule: (callback: () => void) => {
      queue.push(callback);
      return () => {
        const index = queue.indexOf(callback);
        if (index >= 0) queue.splice(index, 1);
      };
    },
    run: () => queue.splice(0).forEach(callback => callback()),
    get size() {
      return queue.length;
    },
  };
}

describe('createDeltaBatcher', () => {
  it('joins every delta of a frame into one update and schedules one frame at a time', () => {
    const frames = manualFrames();
    const apply = vi.fn();
    const batcher = createDeltaBatcher(apply, frames.schedule);
    for (let index = 0; index < 100; index += 1) batcher.push(`${index},`);
    expect(frames.size).toBe(1);
    expect(apply).not.toHaveBeenCalled();
    frames.run();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].split(',').filter(Boolean)).toHaveLength(100);
    batcher.push('next');
    frames.run();
    expect(apply).toHaveBeenLastCalledWith('next');
  });

  it('flushes on demand and cancels the scheduled frame, and ignores empty text', () => {
    const frames = manualFrames();
    const apply = vi.fn();
    const batcher = createDeltaBatcher(apply, frames.schedule);
    batcher.push('');
    expect(frames.size).toBe(0);
    batcher.push('a');
    batcher.flush();
    expect(apply).toHaveBeenCalledWith('a');
    expect(frames.size).toBe(0);
    batcher.flush();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('drops queued text on cancel', () => {
    const frames = manualFrames();
    const apply = vi.fn();
    const batcher = createDeltaBatcher(apply, frames.schedule);
    batcher.push('stale');
    batcher.cancel();
    frames.run();
    batcher.flush();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('Squire availability states', () => {
  it('derives one distinct state per cause, rate limit first', () => {
    expect(squireAvailabilityState({ availability: 'ready', rateLimit: null })).toBeNull();
    expect(squireAvailabilityState({ availability: 'disabled', rateLimit: null })).toBe('disabled');
    expect(squireAvailabilityState({ availability: 'quota', rateLimit: null })).toBe('budget');
    expect(squireAvailabilityState({ availability: 'unavailable', rateLimit: null })).toBe('basic');
    expect(squireAvailabilityState({ availability: 'quota', rateLimit: { until: null } })).toBe(
      'rate_limited'
    );
    expect(squireAvailabilityState({ availability: 'disabled', rateLimit: { until: 5 } })).toBe(
      'rate_limited'
    );
  });

  it('parses Retry-After seconds and dates, capped, and ignores nonsense', () => {
    const now = Date.parse('2026-11-10T00:00:00Z');
    expect(retryAfterUntil('30', now)).toBe(now + 30_000);
    expect(retryAfterUntil(new Date(now + 10_000).toUTCString(), now)).toBe(now + 10_000);
    expect(retryAfterUntil('86400', now)).toBe(now + 15 * 60_000);
    expect(retryAfterUntil(null, now)).toBeNull();
    expect(retryAfterUntil('0', now)).toBeNull();
    expect(retryAfterUntil('soon', now)).toBeNull();
  });

  it('reads the limit from the AI gateway error text', () => {
    expect(aiLimitFrom('Too many requests')).toBe('rate');
    expect(aiLimitFrom('Daily AI budget reached')).toBe('budget');
    expect(aiLimitFrom('Provider quota exceeded')).toBe('budget');
    expect(aiLimitFrom('Provider timed out')).toBeUndefined();
  });
});

describe('Squire keyboard shortcut', () => {
  it('is in the shared registry that /shortcuts renders, owned by the launcher', () => {
    const entry = KEYBOARD_SHORTCUTS.find(shortcut => shortcut.id === 'squire-toggle');
    expect(entry).toMatchObject({
      keys: ['⌘/Ctrl', 'J'],
      scope: 'global',
      runtimeOwner: 'SquireLauncher',
    });
  });
});
