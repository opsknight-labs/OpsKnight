/**
 * Estimated cost of downtime. Money is a trust boundary: amounts are integer hundredths of the
 * currency's major unit ("cents"), bounded on write, and every derived figure is rounded to an
 * integer once, at the end.
 */
import { z } from 'zod/v3';
import { URGENCY_DOWNTIME_WEIGHT } from './slo';

/** $20M per hour of full downtime; far above any real service, well inside int4. */
export const MAX_REVENUE_PER_HOUR_CENTS = 2_000_000_000;
export const MAX_CUSTOMERS_TOTAL = 1_000_000_000;
export const DEFAULT_CURRENCY = 'USD';

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

export const CurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(code => CURRENCIES.has(code), 'Use an ISO 4217 currency code, such as USD.');

export const RevenuePerHourCentsSchema = z.number().int().min(0).max(MAX_REVENUE_PER_HOUR_CENTS);
export const CustomersTotalSchema = z.number().int().min(0).max(MAX_CUSTOMERS_TOTAL);

/** Severity-weighted downtime minutes times the hourly revenue, rounded to whole cents. */
export function estimateDowntimeCostCents(
  weightedDowntimeMinutes: number,
  revenuePerHourCents: number | null | undefined
): number | null {
  if (revenuePerHourCents == null || !Number.isFinite(weightedDowntimeMinutes)) return null;
  return Math.round((Math.max(weightedDowntimeMinutes, 0) * revenuePerHourCents) / 60);
}

/** Cost of one impact interval, weighted by the incident's urgency (as the SLO maths does). */
export function intervalCostCents(
  interval: {
    urgency: keyof typeof URGENCY_DOWNTIME_WEIGHT | null;
    startedAt: Date;
    endedAt: Date | null;
  },
  revenuePerHourCents: number | null | undefined,
  now: Date
): number | null {
  // An unreadable incident has no urgency; a cost would leak it, so show none.
  if (!interval.urgency) return null;
  const minutes = Math.max(
    ((interval.endedAt ?? now).getTime() - interval.startedAt.getTime()) / 60_000,
    0
  );
  return estimateDowntimeCostCents(
    minutes * URGENCY_DOWNTIME_WEIGHT[interval.urgency],
    revenuePerHourCents
  );
}

/** "$1,234.56" for 123456 cents. */
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** "1234.5" -> 123450 cents; null for text that is not a plain amount within the bound. */
export function moneyToCents(text: string): number | null {
  const trimmed = text.trim();
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded quantifiers, no nesting
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  return cents <= MAX_REVENUE_PER_HOUR_CENTS ? cents : null;
}

/** 123450 -> "1234.50", for editing. */
export const centsToMoney = (cents: number) => (cents / 100).toFixed(2);
