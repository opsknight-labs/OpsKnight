import { describe, expect, it } from 'vitest';
import { forecastErrorBudget } from '@/lib/slo/forecast';

const DAY = 86_400_000;
const now = new Date('2026-11-17T12:00:00Z');
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
const incident = (id: string, startDaysAgo: number, minutes: number | null) => ({
  id,
  createdAt: at(startDaysAgo),
  resolvedAt: minutes === null ? null : new Date(at(startDaysAgo).getTime() + minutes * 60_000),
});

describe('error budget forecast', () => {
  // 99.9% over 30 days allows 43.2 minutes.
  const objective = { target: 99.9, windowType: 'THIRTY_DAYS', windowValue: null };

  it('projects days left at the 7-day burn and ranks the incidents that used the budget', () => {
    const forecast = forecastErrorBudget(
      objective,
      [incident('old', 20, 10), incident('a', 3, 7), incident('b', 2, 7)],
      now
    );
    expect(forecast).not.toBeNull();
    expect(forecast!.budgetMinutes).toBe(43.2);
    expect(forecast!.consumedMinutes).toBe(24);
    expect(forecast!.remainingMinutes).toBe(19.2);
    expect(forecast!.burnPerDay).toBe(2);
    expect(forecast!.daysLeft).toBe(9.6);
    expect(forecast!.topIncidents.map(item => item.incidentId)).toEqual(['old', 'a', 'b']);
  });

  it('says not burning when the last 7 days were clean, and exhausted when nothing is left', () => {
    expect(forecastErrorBudget(objective, [incident('old', 20, 10)], now)!.daysLeft).toBeNull();
    const exhausted = forecastErrorBudget(objective, [incident('open', 1, null)], now)!;
    expect(exhausted.remainingMinutes).toBe(0);
    expect(exhausted.daysLeft).toBe(0);
  });

  it('counts overlapping incidents once in the budget and ignores ones outside the window', () => {
    const forecast = forecastErrorBudget(
      objective,
      [incident('a', 2, 10), incident('b', 2, 10), incident('ancient', 40, 60)],
      now
    )!;
    expect(forecast.consumedMinutes).toBe(10);
    expect(forecast.topIncidents.map(item => item.incidentId)).toEqual(['a', 'b']);
  });

  it('has no forecast for a target that allows no downtime', () => {
    expect(forecastErrorBudget({ ...objective, target: 100 }, [], now)).toBeNull();
  });
});
