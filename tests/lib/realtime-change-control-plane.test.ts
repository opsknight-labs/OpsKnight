import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import {
  getRealtimeChangeGeneration,
  getRealtimeControlPlaneStatus,
  resetRealtimeControlPlaneForTests,
  subscribeToRealtimeChanges,
} from '@/lib/realtime-change-control-plane';

vi.mock('@/lib/prisma', () => ({
  default: { realtimeChange: { findFirst: vi.fn(), create: vi.fn() } },
}));

describe('realtime change control plane', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetRealtimeControlPlaneForTests();
  });

  afterEach(() => {
    resetRealtimeControlPlaneForTests();
    vi.useRealTimers();
  });

  it('uses one database poll to fan a new generation out to every subscriber', async () => {
    vi.mocked(prisma.realtimeChange.findFirst).mockResolvedValue({
      id: BigInt(42),
      changedAt: new Date(),
    });
    const dashboard = vi.fn();
    const widgets = vi.fn();
    const stopDashboard = subscribeToRealtimeChanges('dashboard', '41', dashboard);
    const stopWidgets = subscribeToRealtimeChanges('widgets', '41', widgets);

    await vi.advanceTimersByTimeAsync(0);

    expect(prisma.realtimeChange.findFirst).toHaveBeenCalledTimes(1);
    expect(dashboard).toHaveBeenCalledWith('42');
    expect(widgets).toHaveBeenCalledWith('42');
    expect(getRealtimeControlPlaneStatus().subscribers).toBe(2);
    stopDashboard();
    stopWidgets();
  });

  it('does not notify unchanged generations and stops polling without subscribers', async () => {
    vi.mocked(prisma.realtimeChange.findFirst).mockResolvedValue({
      id: BigInt(7),
      changedAt: new Date(),
    });
    const listener = vi.fn();
    const stop = subscribeToRealtimeChanges('dashboard', '7', listener);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(listener).not.toHaveBeenCalled();
    expect(prisma.realtimeChange.findFirst).toHaveBeenCalledTimes(4);

    stop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(prisma.realtimeChange.findFirst).toHaveBeenCalledTimes(4);
  });

  it('degrades safely when the initial durable clock read fails', async () => {
    vi.mocked(prisma.realtimeChange.findFirst).mockRejectedValue(new Error('database unavailable'));
    await expect(getRealtimeChangeGeneration()).resolves.toBeNull();
  });

  it('singleflights simultaneous initial generation reads', async () => {
    let finish!: (value: { id: bigint; changedAt: Date }) => void;
    vi.mocked(prisma.realtimeChange.findFirst).mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      }) as never
    );

    const first = getRealtimeChangeGeneration();
    const second = getRealtimeChangeGeneration();
    finish({ id: BigInt(9), changedAt: new Date() });

    await expect(Promise.all([first, second])).resolves.toEqual(['9', '9']);
    expect(prisma.realtimeChange.findFirst).toHaveBeenCalledTimes(1);
  });
});
