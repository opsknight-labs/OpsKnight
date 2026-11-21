import prisma from '@/lib/prisma';
import { calculateActorMultiServiceUptime } from '@/lib/actor-metrics';
import { serviceObjectiveReadWhere } from '@/lib/slo/authorization';
import type { AnalyticsScope } from './scope';
import type { AnalyticsWindow } from './window';

export type AvailabilityRow = {
  id: string;
  name: string;
  /** Percent of the window with no open incident on the service. */
  uptime: number;
  downtimeMs: number;
  /** Uptime objective in force at the window end, if the service has one. */
  objective: { name: string; target: number } | null;
  /** Share of the window's error budget still left; negative once overspent. Null without an objective. */
  budgetRemaining: number | null;
};

// shortcut: same 500 cap as the services table; paginate if tenants exceed it.
const SERVICE_LIMIT = 500;

/** Error budget for one window: allowed downtime is (100 − target)% of the window. */
export function errorBudget(uptime: number, target: number, windowMs: number) {
  const allowedMs = ((100 - target) / 100) * windowMs;
  const burnedMs = ((100 - uptime) / 100) * windowMs;
  const remaining =
    allowedMs > 0 ? ((allowedMs - burnedMs) / allowedMs) * 100 : burnedMs > 0 ? -100 : 100;
  return { allowedMs, burnedMs, remaining };
}

export async function queryAvailability(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<AvailabilityRow[]> {
  const services = await prisma.service.findMany({
    where: scope.serviceWhere,
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: SERVICE_LIMIT,
  });
  if (services.length === 0) return [];
  const ids = services.map(service => service.id);
  const [uptime, objectives] = await Promise.all([
    calculateActorMultiServiceUptime(scope.actor, ids, window.start, window.end),
    prisma.serviceObjective.findMany({
      where: {
        AND: [
          serviceObjectiveReadWhere(scope.actor),
          {
            serviceId: { in: ids },
            metricType: { in: ['UPTIME', 'AVAILABILITY'] },
            activeFrom: { lte: window.end },
            OR: [{ activeTo: null }, { activeTo: { gt: window.end } }],
          },
        ],
      },
      select: { serviceId: true, name: true, target: true },
      orderBy: { version: 'desc' },
    }),
  ]);

  const objectiveByService = new Map<string, { name: string; target: number }>();
  for (const objective of objectives) {
    if (objective.serviceId && !objectiveByService.has(objective.serviceId)) {
      objectiveByService.set(objective.serviceId, {
        name: objective.name,
        target: objective.target,
      });
    }
  }

  const windowMs = window.end.getTime() - window.start.getTime();
  return services
    .map(service => {
      const value = uptime[service.id] ?? 100;
      const objective = objectiveByService.get(service.id) ?? null;
      return {
        id: service.id,
        name: service.name,
        uptime: value,
        downtimeMs: ((100 - value) / 100) * windowMs,
        objective,
        budgetRemaining: objective
          ? errorBudget(value, objective.target, windowMs).remaining
          : null,
      };
    })
    .sort((a, b) => a.uptime - b.uptime || a.name.localeCompare(b.name));
}
