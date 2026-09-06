import { describe, it, expect } from 'vitest';
import {
  isIncidentAfterHours,
  DEFAULT_BUSINESS_HOURS_TIMEZONE,
} from '@/lib/business-hours';

// All fixture timestamps are explicit UTC instants so the assertions
// don't depend on the test host's local TZ.

describe('isIncidentAfterHours', () => {
  it('classifies a UTC weekday at 09:00 as in-hours under the default UTC TZ', () => {
    const d = new Date('2024-06-12T09:00:00Z'); // Wednesday
    expect(isIncidentAfterHours(d, DEFAULT_BUSINESS_HOURS_TIMEZONE)).toBe(false);
  });

  it('classifies a UTC weekday at 19:00 as after-hours', () => {
    const d = new Date('2024-06-12T19:00:00Z');
    expect(isIncidentAfterHours(d, DEFAULT_BUSINESS_HOURS_TIMEZONE)).toBe(true);
  });

  it('classifies UTC weekends as after-hours regardless of hour', () => {
    const sat = new Date('2024-06-15T12:00:00Z'); // Saturday noon UTC
    const sun = new Date('2024-06-16T12:00:00Z'); // Sunday noon UTC
    expect(isIncidentAfterHours(sat, DEFAULT_BUSINESS_HOURS_TIMEZONE)).toBe(true);
    expect(isIncidentAfterHours(sun, DEFAULT_BUSINESS_HOURS_TIMEZONE)).toBe(true);
  });

  it('honors the timezone argument — same instant, different TZs', () => {
    // 2024-06-12T22:00:00Z is Wed 22:00 in UTC (after-hours) but Wed
    // 18:00 in America/New_York (which is exactly the end of business
    // hours — i.e. after-hours, since end is exclusive).
    const d = new Date('2024-06-12T22:00:00Z');
    expect(isIncidentAfterHours(d, 'UTC')).toBe(true);
    expect(isIncidentAfterHours(d, 'America/New_York')).toBe(true);

    // 2024-06-12T15:00:00Z is Wed 11:00 in America/New_York (in-hours).
    const d2 = new Date('2024-06-12T15:00:00Z');
    expect(isIncidentAfterHours(d2, 'America/New_York')).toBe(false);
  });

  it('treats early-morning hours (before startHour) as after-hours', () => {
    const d = new Date('2024-06-12T05:00:00Z'); // 05:00 UTC, before 08:00
    expect(isIncidentAfterHours(d, 'UTC')).toBe(true);
  });

  it('honors custom start/end hours', () => {
    // 09:00 in-hours by default, but if we say startHour=10, it's after-hours.
    const d = new Date('2024-06-12T09:00:00Z');
    expect(isIncidentAfterHours(d, 'UTC', 8, 18)).toBe(false);
    expect(isIncidentAfterHours(d, 'UTC', 10, 18)).toBe(true);
  });
});
