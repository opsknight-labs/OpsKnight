import { describe, expect, it } from 'vitest';
import { actionItemOverdueBefore } from '@/lib/action-item-due-dates';

describe('actionItemOverdueBefore', () => {
  it('is the start of the current UTC day, whatever the time of day', () => {
    const expected = new Date('2026-11-20T00:00:00.000Z');

    expect(actionItemOverdueBefore(new Date('2026-11-20T00:00:00.000Z'))).toEqual(expected);
    expect(actionItemOverdueBefore(new Date('2026-11-20T23:59:59.999Z'))).toEqual(expected);
  });

  it('keeps an item due today out of the overdue set until tomorrow', () => {
    const dueToday = new Date('2026-11-20T00:00:00.000Z');
    const afternoonInLosAngeles = new Date('2026-11-20T23:00:00.000Z');

    expect(dueToday < actionItemOverdueBefore(afternoonInLosAngeles)).toBe(false);
    expect(dueToday < actionItemOverdueBefore(new Date('2026-11-21T00:00:00.000Z'))).toBe(true);
  });
});
