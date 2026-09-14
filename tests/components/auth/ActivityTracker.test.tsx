import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ActivityTracker from '@/components/auth/ActivityTracker';

const update = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } }, update }),
}));

describe('ActivityTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    update.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not make a session request from a navigation interaction', () => {
    render(<ActivityTracker />);

    fireEvent.mouseDown(window);
    fireEvent.click(window);

    expect(update).not.toHaveBeenCalled();
  });

  it('coalesces activity into the coarse background heartbeat', async () => {
    render(<ActivityTracker />);
    fireEvent.keyDown(window);
    fireEvent.scroll(window);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ activity: true });
  });
});
