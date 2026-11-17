import 'server-only';
import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { forecastErrorBudget, type BudgetForecast } from './forecast';

const MAX_INCIDENTS = 500;
const DAY_MS = 86_400_000;

export interface ObjectiveForecastView extends Omit<BudgetForecast, 'topIncidents'> {
  /** The largest budget consumers the viewer may open; others are left out. */
  topIncidents: Array<{ incidentId: string; title: string; minutes: number }>;
}

/**
 * Budget forecasts for the availability objectives on the objectives page, keyed by objective id. One
 * bounded incident read per service plus one scoped title read; empty while the helpers switch is off.
 */
export async function getObjectiveForecasts(
  actor: AuthorizationActor,
  objectives: ReadonlyArray<{
    id: string;
    serviceId: string | null;
    metricType: string;
    target: number;
    windowType: string;
    windowValue: number | null;
  }>,
  now: Date = new Date()
): Promise<Map<string, ObjectiveForecastView>> {
  const result = new Map<string, ObjectiveForecastView>();
  const eligible = objectives.filter(
    objective =>
      objective.serviceId &&
      (objective.metricType === 'UPTIME' || objective.metricType === 'AVAILABILITY')
  );
  if (eligible.length === 0) return result;
  const settings = await getIntelligenceSettings();
  if (!settings.enabled || !settings.opsHelpersEnabled) return result;

  // The window is at most a year; reading per service over that bound keeps it one query per service.
  const since = new Date(now.getTime() - 366 * DAY_MS);
  const serviceIds = [...new Set(eligible.map(objective => objective.serviceId!))];
  const incidentsByService = new Map(
    await Promise.all(
      serviceIds.map(
        async serviceId =>
          [
            serviceId,
            await prisma.incident.findMany({
              where: {
                serviceId,
                createdAt: { lte: now },
                OR: [{ resolvedAt: null }, { resolvedAt: { gte: since } }],
                status: { not: 'SUPPRESSED' },
              },
              orderBy: { createdAt: 'desc' },
              take: MAX_INCIDENTS,
              select: { id: true, createdAt: true, resolvedAt: true },
            }),
          ] as const
      )
    )
  );

  const forecasts = new Map<string, BudgetForecast>();
  for (const objective of eligible) {
    const forecast = forecastErrorBudget(
      objective,
      incidentsByService.get(objective.serviceId!) ?? [],
      now
    );
    if (forecast) forecasts.set(objective.id, forecast);
  }
  const ids = [
    ...new Set([...forecasts.values()].flatMap(f => f.topIncidents.map(i => i.incidentId))),
  ];
  const titles = new Map(
    ids.length
      ? (
          await prisma.incident.findMany({
            where: { AND: [{ id: { in: ids } }, incidentReadWhere(actor)] },
            select: { id: true, title: true },
          })
        ).map(row => [row.id, row.title])
      : []
  );
  for (const [objectiveId, forecast] of forecasts) {
    result.set(objectiveId, {
      ...forecast,
      topIncidents: forecast.topIncidents.flatMap(item => {
        const title = titles.get(item.incidentId);
        return title === undefined ? [] : [{ ...item, title }];
      }),
    });
  }
  return result;
}
