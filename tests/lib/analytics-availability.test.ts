import { describe, expect, it } from 'vitest';
import { errorBudget } from '@/lib/analytics/queries-availability';

const WEEK = 7 * 24 * 3_600_000;

describe('errorBudget', () => {
  it('allows (100 - target)% of the window as downtime', () => {
    const budget = errorBudget(99.5, 99, WEEK);
    expect(budget.allowedMs).toBeCloseTo(0.01 * WEEK);
    expect(budget.burnedMs).toBeCloseTo(0.005 * WEEK);
    expect(budget.remaining).toBeCloseTo(50);
  });

  it('goes negative once overspent and is full with no downtime', () => {
    expect(errorBudget(98, 99, WEEK).remaining).toBeCloseTo(-100);
    expect(errorBudget(100, 99.9, WEEK).remaining).toBe(100);
  });

  it('treats a 100% target as exhausted by any downtime', () => {
    expect(errorBudget(100, 100, WEEK).remaining).toBe(100);
    expect(errorBudget(99.99, 100, WEEK).remaining).toBeLessThan(0);
  });
});
