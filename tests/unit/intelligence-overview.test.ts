import { describe, expect, it } from 'vitest';
import { APP_ROLES, CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getAuthorizedNavItems, NAVIGATION_ITEMS } from '@/config/navigation';
import {
  formatCount,
  formatDuration,
  formatPercent,
  parseOverviewWindow,
  resolveOverviewWindow,
} from '@/lib/intelligence/overview/window';

describe('AIOps overview window', () => {
  it('accepts only the three supported windows and defaults to 7 days', () => {
    expect(parseOverviewWindow('24h')).toBe('24h');
    expect(parseOverviewWindow(['30d', '24h'])).toBe('30d');
    expect(parseOverviewWindow('90d')).toBe('7d');
    expect(parseOverviewWindow('constructor')).toBe('7d');
    expect(parseOverviewWindow(undefined)).toBe('7d');
  });

  it('resolves contiguous current and previous windows with aligned buckets', () => {
    const now = new Date('2026-11-09T12:00:00Z');
    const day = resolveOverviewWindow('24h', now);
    expect(day.until).toEqual(now);
    expect(day.since).toEqual(new Date('2026-11-08T12:00:00Z'));
    expect(day.previousSince).toEqual(new Date('2026-11-07T12:00:00Z'));
    expect(day.buckets).toBe(24);
    expect(day.days).toBe(1);
    const month = resolveOverviewWindow('30d', now);
    expect(month.buckets).toBe(30);
    expect(month.days).toBe(30);
    expect(month.since.getTime() - month.previousSince.getTime()).toBe(30 * 86_400_000);
  });

  it('formats durations, percentages and counts compactly and never invents a value', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(720)).toBe('12 min');
    expect(formatDuration(5400)).toBe('1.5 h');
    expect(formatDuration(2 * 86_400)).toBe('2.0 d');
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0.4567)).toBe('45.7%');
    expect(formatCount(1284)).toBe('1,284');
    expect(formatCount(12_900)).toBe('12.9K');
  });
});

describe('AIOps overview navigation', () => {
  it('is offered exactly to the roles that hold INTELLIGENCE_READ', () => {
    const item = NAVIGATION_ITEMS.find(entry => entry.href === '/intelligence');
    expect(item).toBeDefined();
    const expected = APP_ROLES.filter(role => hasCapability(role, CAPABILITIES.INTELLIGENCE_READ));
    expect([...(item?.requiresRole ?? [])].sort()).toEqual([...expected].sort());
    for (const role of APP_ROLES) {
      const hrefs = getAuthorizedNavItems(role).map(entry => entry.href);
      expect(hrefs.includes('/intelligence')).toBe(expected.includes(role));
    }
  });
});
