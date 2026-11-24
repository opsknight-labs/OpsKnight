import { describe, expect, it } from 'vitest';
import {
  CurrencySchema,
  MAX_REVENUE_PER_HOUR_CENTS,
  RevenuePerHourCentsSchema,
  CustomersTotalSchema,
  estimateDowntimeCostCents,
  formatMoney,
  intervalCostCents,
  moneyToCents,
  centsToMoney,
} from '@/lib/business-services/impact-cost';

describe('estimateDowntimeCostCents', () => {
  it('multiplies weighted hours by the hourly rate and rounds once to whole cents', () => {
    expect(estimateDowntimeCostCents(60, 120_000)).toBe(120_000);
    expect(estimateDowntimeCostCents(90, 100_000)).toBe(150_000);
    expect(estimateDowntimeCostCents(1, 100)).toBe(2); // 1.67 rounds to 2
  });

  it('has no cost without a rate and never goes negative or non-finite', () => {
    expect(estimateDowntimeCostCents(60, null)).toBeNull();
    expect(estimateDowntimeCostCents(60, undefined)).toBeNull();
    expect(estimateDowntimeCostCents(-5, 1000)).toBe(0);
    expect(estimateDowntimeCostCents(Number.NaN, 1000)).toBeNull();
    expect(estimateDowntimeCostCents(Infinity, 1000)).toBeNull();
  });

  it('stays an exact integer at the bound for a year of downtime', () => {
    const cost = estimateDowntimeCostCents(365 * 24 * 60, MAX_REVENUE_PER_HOUR_CENTS)!;
    expect(Number.isSafeInteger(cost)).toBe(true);
  });
});

describe('intervalCostCents', () => {
  const startedAt = new Date('2026-11-25T10:00:00Z');
  it('weights by incident urgency over the interval', () => {
    const endedAt = new Date('2026-11-25T11:00:00Z');
    const rate = 120_000;
    expect(intervalCostCents({ urgency: 'HIGH', startedAt, endedAt }, rate, endedAt)).toBe(120_000);
    expect(intervalCostCents({ urgency: 'MEDIUM', startedAt, endedAt }, rate, endedAt)).toBe(
      60_000
    );
    expect(intervalCostCents({ urgency: 'LOW', startedAt, endedAt }, rate, endedAt)).toBe(30_000);
  });
  it('runs an open interval to now and hides cost for an unreadable incident or missing rate', () => {
    const now = new Date('2026-11-25T10:30:00Z');
    expect(intervalCostCents({ urgency: 'HIGH', startedAt, endedAt: null }, 120_000, now)).toBe(
      60_000
    );
    expect(intervalCostCents({ urgency: null, startedAt, endedAt: null }, 120_000, now)).toBeNull();
    expect(intervalCostCents({ urgency: 'HIGH', startedAt, endedAt: null }, null, now)).toBeNull();
  });
});

describe('money validation', () => {
  it('accepts only integer cents within the bound', () => {
    expect(RevenuePerHourCentsSchema.safeParse(0).success).toBe(true);
    expect(RevenuePerHourCentsSchema.safeParse(MAX_REVENUE_PER_HOUR_CENTS).success).toBe(true);
    for (const bad of [-1, 1.5, MAX_REVENUE_PER_HOUR_CENTS + 1, Number.NaN, Infinity])
      expect(RevenuePerHourCentsSchema.safeParse(bad).success).toBe(false);
    expect(RevenuePerHourCentsSchema.safeParse('100').success).toBe(false);
  });
  it('bounds customers exposed', () => {
    expect(CustomersTotalSchema.safeParse(250_000).success).toBe(true);
    expect(CustomersTotalSchema.safeParse(-1).success).toBe(false);
    expect(CustomersTotalSchema.safeParse(2_000_000_000).success).toBe(false);
    expect(CustomersTotalSchema.safeParse(1.2).success).toBe(false);
  });
  it('normalises and validates ISO 4217 currency codes', () => {
    expect(CurrencySchema.parse(' eur ')).toBe('EUR');
    expect(CurrencySchema.safeParse('USDX').success).toBe(false);
    expect(CurrencySchema.safeParse('ZZZ').success).toBe(false);
    expect(CurrencySchema.safeParse('').success).toBe(false);
  });
  it('parses form amounts into cents without float drift', () => {
    expect(moneyToCents('12000.50')).toBe(1_200_050);
    expect(moneyToCents('0.29')).toBe(29);
    expect(moneyToCents('1.1')).toBe(110);
    expect(moneyToCents(' 5 ')).toBe(500);
    for (const bad of ['', '-1', '1,000', '1.234', 'abc', '99999999999', '20000001'])
      expect(moneyToCents(bad), bad).toBeNull();
    expect(moneyToCents('20000000')).toBe(MAX_REVENUE_PER_HOUR_CENTS);
    expect(centsToMoney(1_200_050)).toBe('12000.50');
  });
  it('formats for display', () => {
    expect(formatMoney(123_456, 'USD')).toBe('$1,234.56');
  });
});
