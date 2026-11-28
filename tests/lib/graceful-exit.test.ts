import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferExitWhileDraining } from '@/lib/graceful-exit';

function fakeProcess() {
  const exit = vi.fn<(code?: number | string | null) => never>();
  return { exit, target: { exit } as { exit: (code?: number | string | null) => never } };
}

describe('deferExitWhileDraining', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the exit until the drain has finished', async () => {
    let finishDrain!: () => void;
    const drain = new Promise<void>(resolve => (finishDrain = resolve));
    const { exit, target } = fakeProcess();
    deferExitWhileDraining(target, () => drain, 55_000);

    target.exit(143);
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();

    finishDrain();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
  });

  it('exits at once when nothing is draining', () => {
    const { exit, target } = fakeProcess();
    deferExitWhileDraining(target, () => null, 55_000);
    target.exit(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits anyway when the drain never finishes', async () => {
    vi.useFakeTimers();
    const { exit, target } = fakeProcess();
    deferExitWhileDraining(target, () => new Promise<void>(() => undefined), 5_000);

    target.exit(143);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(exit).toHaveBeenCalledWith(143);
  });

  it('exits with the original code even when the drain failed', async () => {
    const { exit, target } = fakeProcess();
    deferExitWhileDraining(target, () => Promise.reject(new Error('stop failed')), 55_000);
    target.exit(143);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
  });
});
