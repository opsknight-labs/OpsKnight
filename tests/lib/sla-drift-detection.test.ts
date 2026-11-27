import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calculateSLAMetrics: vi.fn(),
  calculateSLAMetricsFromRollups: vi.fn(),
  tryAdvisoryLock: vi.fn(),
  events: [] as string[],
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: async (fn: (tx: unknown) => unknown) => {
      mocks.events.push('transaction');
      return fn({});
    },
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/sla-server', () => ({
  calculateSLAMetrics: mocks.calculateSLAMetrics,
  calculateSLAMetricsFromRollups: mocks.calculateSLAMetricsFromRollups,
}));
vi.mock('@/lib/retention-policy', () => ({
  getRetentionPolicy: async () => ({ realTimeWindowDays: 90 }),
  getQueryDateBounds: async (start: Date, end: Date) => ({ start, end, isClipped: false }),
}));
vi.mock('@/lib/db-locks', () => ({
  tryAdvisoryLock: mocks.tryAdvisoryLock,
  LOCK_KEYS: { DRIFT_DETECTION: 1 },
}));

import { runSLADriftDetection } from '@/lib/sla-drift-detection';

const metrics = (over: Record<string, number | null> = {}) => ({
  totalIncidents: 100,
  highUrgencyCount: 10,
  mediumUrgencyCount: 10,
  lowUrgencyCount: 10,
  ackBreaches: 10,
  resolveBreaches: 10,
  mttr: 100,
  autoResolvedCount: 10,
  ...over,
});

describe('runSLADriftDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events.length = 0;
    mocks.tryAdvisoryLock.mockResolvedValue(true);
  });

  it('applies the configured tolerance to every compared field', async () => {
    // 3% apart on total incidents (103 vs 100): outside the 1% default, inside a 10% tolerance.
    mocks.calculateSLAMetrics.mockResolvedValue(metrics({ totalIncidents: 103 }));
    mocks.calculateSLAMetricsFromRollups.mockResolvedValue(metrics());

    const strict = await runSLADriftDetection();
    expect(strict.samples.find(s => s.field === 'totalIncidents')?.withinTolerance).toBe(false);

    const lenient = await runSLADriftDetection({ toleranceFraction: 0.1 });
    expect(lenient.samples.every(s => s.withinTolerance)).toBe(true);
    expect(lenient.withinTolerance).toBe(true);
  });

  it('runs the heavy aggregates before, and outside, any transaction, without logging performance', async () => {
    mocks.calculateSLAMetrics.mockImplementation(async () => {
      mocks.events.push('live');
      return metrics();
    });
    mocks.calculateSLAMetricsFromRollups.mockImplementation(async () => {
      mocks.events.push('rollup');
      return metrics();
    });

    const report = await runSLADriftDetection();

    expect(report.ran).toBe(true);
    expect(mocks.events).toEqual(['live', 'rollup', 'transaction']);
    expect(mocks.calculateSLAMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ _forceLive: true, _skipPerformanceLog: true })
    );
  });

  it('skips when another instance is reporting', async () => {
    mocks.calculateSLAMetrics.mockResolvedValue(metrics());
    mocks.calculateSLAMetricsFromRollups.mockResolvedValue(metrics());
    mocks.tryAdvisoryLock.mockResolvedValue(false);

    await expect(runSLADriftDetection()).resolves.toMatchObject({
      ran: false,
      skippedReason: 'concurrent-run',
      samples: [],
    });
  });

  it('skips a second run while one is still computing in this process', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    mocks.calculateSLAMetrics.mockImplementation(async () => {
      await gate;
      return metrics();
    });
    mocks.calculateSLAMetricsFromRollups.mockResolvedValue(metrics());

    const first = runSLADriftDetection();
    await vi.waitFor(() => expect(mocks.calculateSLAMetrics).toHaveBeenCalledOnce());
    await expect(runSLADriftDetection()).resolves.toMatchObject({
      ran: false,
      skippedReason: 'concurrent-run',
    });
    release();
    await expect(first).resolves.toMatchObject({ ran: true });
    expect(mocks.calculateSLAMetrics).toHaveBeenCalledOnce();
  });
});
