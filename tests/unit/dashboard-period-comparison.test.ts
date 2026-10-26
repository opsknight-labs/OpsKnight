import { isComparablePriorPeriod } from '@/lib/dashboard/period-comparison';

describe('isComparablePriorPeriod', () => {
  it('rejects a sparse prior period next to a much larger current one', () => {
    expect(isComparablePriorPeriod(2331, 52)).toBe(false);
  });

  it('rejects a prior period below the minimum sample', () => {
    expect(isComparablePriorPeriod(12, 9)).toBe(false);
    expect(isComparablePriorPeriod(5, 0)).toBe(false);
  });

  it('accepts similarly sized periods', () => {
    expect(isComparablePriorPeriod(58, 40)).toBe(true);
    expect(isComparablePriorPeriod(100, 25)).toBe(true);
  });
});
