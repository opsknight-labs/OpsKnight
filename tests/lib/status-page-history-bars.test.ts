import { describe, expect, it } from 'vitest';
import {
  barSeverity,
  barTooltip,
  downtimeMinutes,
  visibleBarIndexes,
} from '@/lib/status-pages/history-bars';

const day = (status: string, availabilityPercent: number | null) =>
  ({ date: '2026-11-01', status, availabilityPercent, incidentCount: 0 }) as never;

describe('history bars', () => {
  it('keeps the most recent days with original indexes', () => {
    expect(visibleBarIndexes(90, 30)[0]).toBe(60);
    expect(visibleBarIndexes(10, 30)).toHaveLength(10);
    expect(visibleBarIndexes(0, 30)).toEqual([]);
  });
  it('grades severity by availability', () => {
    expect(barSeverity(day('OPERATIONAL', 100))).toBe('ok');
    expect(barSeverity(day('OPERATIONAL', 99.7))).toBe('minor');
    expect(barSeverity(day('DEGRADED', 98.5))).toBe('moderate');
    expect(barSeverity(day('MAJOR_OUTAGE', 90))).toBe('severe');
    expect(barSeverity(day('UNKNOWN', null))).toBe('none');
    expect(barSeverity(day('MAJOR_OUTAGE', null))).toBe('moderate');
  });
  it('derives downtime and tooltip', () => {
    expect(downtimeMinutes(99)).toBe(14);
    expect(downtimeMinutes(null)).toBeNull();
    expect(barTooltip(day('DEGRADED', 99), 'Degraded')).toBe('2026-11-01 · Degraded · 99% · 14 min downtime');
  });
});
