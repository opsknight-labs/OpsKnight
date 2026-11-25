import { describe, expect, it } from 'vitest';
import { computeErrorBudget, weightedDowntime } from '@/lib/business-services/slo';

const H = 3_600_000;
const bounds = { from: 0, to: 10 * H };

describe('computeErrorBudget', () => {
  it('99.9% over 30 days allows 43.2 minutes', () => {
    const b = computeErrorBudget({ targetPercent: 99.9, windowDays: 30, downtimeMinutes: 10 });
    expect(b.allowedMinutes).toBeCloseTo(43.2);
    expect(b.remainingPercent).toBeCloseTo(76.85, 1);
    expect(b.burnState).toBe('OK');
  });
  it('flags AT_RISK under 25% left and BREACHED at zero', () => {
    const at = (m: number) =>
      computeErrorBudget({ targetPercent: 99.9, windowDays: 30, downtimeMinutes: m }).burnState;
    expect(at(35)).toBe('AT_RISK');
    expect(at(43.2)).toBe('BREACHED');
    expect(at(100)).toBe('BREACHED');
  });
});

describe('weightedDowntime', () => {
  it('weights severity and takes the heaviest weight where intervals overlap', () => {
    const { downtimeMs, windowMs } = weightedDowntime(
      [
        { start: 0, end: 2 * H, weight: 0.25 },
        { start: H, end: 3 * H, weight: 1 },
      ],
      [],
      bounds
    );
    // 0-1h at 0.25, 1-3h at 1
    expect(downtimeMs).toBeCloseTo(0.25 * H + 2 * H);
    expect(windowMs).toBe(10 * H);
  });
  it('removes planned maintenance from impact and from the denominator', () => {
    const { downtimeMs, windowMs } = weightedDowntime(
      [{ start: 0, end: 4 * H, weight: 1 }],
      [{ start: 2 * H, end: 6 * H }],
      bounds
    );
    expect(downtimeMs).toBeCloseTo(2 * H);
    expect(windowMs).toBe(6 * H);
  });
});
