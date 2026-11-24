import 'server-only';

import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getBusinessServiceStats } from '../stats';
import { computeErrorBudget } from '../slo';
import { priorPeriod, type ReviewPeriod } from './period';
import type { ReviewService } from './digest';

/** Reads every service once with global scope; per-recipient visibility is applied afterwards. */
export const SYSTEM_ACTOR: AuthorizationActor = {
  id: 'system:service-review',
  role: 'ADMIN',
  status: 'ACTIVE',
  teamIds: [],
};
const CHUNK = 5;
const MAX_SERVICES = 1000;

type Rowish = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Revenue fields may not exist yet (added by another change); read them without a schema reference. */
export function revenueOf(row: Rowish): { perHourCents: number | null; currency: string | null } {
  return {
    perHourCents: num(row.revenuePerHourCents),
    currency: typeof row.currency === 'string' ? row.currency : null,
  };
}

export const estimateCostCents = (impactMinutes: number, perHourCents: number | null) =>
  perHourCents === null ? null : Math.round((impactMinutes / 60) * perHourCents);

export async function collectServiceReviews(
  serviceIds: readonly string[],
  period: ReviewPeriod,
  timeZone: string
): Promise<Map<string, ReviewService>> {
  const ids = [...new Set(serviceIds)].slice(0, MAX_SERVICES);
  if (!ids.length) return new Map();
  const rows = (await prisma.businessService.findMany({
    where: { id: { in: ids }, lifecycle: { not: 'RETIRED' } },
  })) as unknown as Array<Rowish & { id: string; name: string }>;
  const prior = priorPeriod(period, timeZone);
  const causes = await topCauses(ids, period);
  const out = new Map<string, ReviewService>();
  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(
      rows.slice(i, i + CHUNK).map(async row => {
        const target = num(row.sloTarget);
        const [stats, priorStats] = await Promise.all([
          getBusinessServiceStats(row.id, { from: period.from, to: period.to }, SYSTEM_ACTOR),
          target === null
            ? null
            : getBusinessServiceStats(row.id, { from: prior.from, to: prior.to }, SYSTEM_ACTOR),
        ]);
        const budget =
          target === null
            ? null
            : computeErrorBudget({
                targetPercent: target,
                windowDays: period.days,
                downtimeMinutes: stats.weightedDowntimeMinutes,
              });
        const priorBudget =
          target === null || !priorStats
            ? null
            : computeErrorBudget({
                targetPercent: target,
                windowDays: prior.days,
                downtimeMinutes: priorStats.weightedDowntimeMinutes,
              });
        const revenue = revenueOf(row);
        out.set(row.id, {
          id: row.id,
          name: row.name,
          criticality: typeof row.criticality === 'string' ? row.criticality : null,
          sloTarget: target,
          attainmentPercent: target === null ? null : stats.weightedUptimePercent,
          budget,
          priorRemainingPercent: priorBudget?.remainingPercent ?? null,
          downtimeMinutes: stats.impactMinutes,
          incidentCount: stats.incidentCount,
          mttaMinutes: stats.mttaMinutes,
          mttrMinutes: stats.mttrMinutes,
          estimatedCostCents: estimateCostCents(stats.impactMinutes, revenue.perHourCents),
          currency: revenue.currency,
          topCauses: causes.get(row.id) ?? [],
        });
      })
    );
  }
  return out;
}

/** Up to three causes per service: postmortem root cause when written, else the incident title. */
async function topCauses(ids: string[], period: ReviewPeriod) {
  const impacts = await prisma.incidentBusinessServiceImpact.findMany({
    where: {
      businessServiceId: { in: ids },
      excluded: false,
      startedAt: { lt: period.to },
      OR: [{ endedAt: null }, { endedAt: { gt: period.from } }],
    },
    take: 5000,
    select: {
      businessServiceId: true,
      incident: { select: { title: true, postmortem: { select: { rootCause: true } } } },
    },
  });
  const counts = new Map<string, Map<string, number>>();
  for (const row of impacts) {
    const label = (row.incident.postmortem?.rootCause?.split('\n')[0] || row.incident.title)
      .trim()
      .slice(0, 80);
    const perService = counts.get(row.businessServiceId) ?? new Map<string, number>();
    perService.set(label, (perService.get(label) ?? 0) + 1);
    counts.set(row.businessServiceId, perService);
  }
  return new Map(
    [...counts].map(([id, m]) => [
      id,
      [...m]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([l]) => l),
    ])
  );
}
