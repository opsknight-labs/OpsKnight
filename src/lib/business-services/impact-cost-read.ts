import 'server-only';

import prisma from '@/lib/prisma';
import type { BusinessServiceStats, ImpactTimelineEntry } from './contract';
import { estimateDowntimeCostCents, intervalCostCents } from './impact-cost';

/**
 * Cost figures for a business service the caller already passed the visibility check for.
 * Null cost fields mean no revenue rate is set; entries the caller cannot read carry no cost.
 */
export async function withImpactCost(
  businessServiceId: string,
  stats: BusinessServiceStats,
  entries: readonly ImpactTimelineEntry[],
  now = new Date(),
  /** Callers pass canReadBusinessServiceFinancials(actor); without it no cost data is returned. */
  financials = false
) {
  if (!financials) return { entries: entries.map(entry => ({ ...entry })) };
  const service = await prisma.businessService.findUnique({
    where: { id: businessServiceId },
    select: { revenuePerHourCents: true, currency: true, customersTotal: true },
  });
  const rate = service?.revenuePerHourCents ?? null;
  return {
    currency: service?.currency ?? 'USD',
    customersTotal: service?.customersTotal ?? null,
    estimatedCostCents: estimateDowntimeCostCents(stats.weightedDowntimeMinutes ?? 0, rate),
    entries: entries.map(entry => ({
      ...entry,
      costCents: entry.excluded ? null : intervalCostCents(entry, rate, now),
    })),
  };
}
