import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { calculateSLAMetrics, calculateMultiServiceUptime } from '@/lib/sla-server';
import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability, isAppRole } from '@/lib/authorization';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError } from '@/lib/errors';
import { getCurrentUser } from '@/lib/rbac';

async function getDefinitionWhereForUser(userId: string, role: string) {
  if (isAppRole(role) && hasCapability(role, CAPABILITIES.METRICS_READ_ALL)) {
    return { activeTo: null } as const;
  }
  const memberships = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const teamIds = memberships.map(m => m.teamId);
  if (teamIds.length === 0) {
    return { activeTo: null, id: { in: [] as string[] } };
  }
  return {
    activeTo: null,
    service: { is: { teamId: { in: teamIds } } },
  } as const;
}

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const whereClause = await getDefinitionWhereForUser(user.id, user.role);

    const definitions = await prisma.sLADefinition.findMany({
      where: whereClause,
      include: {
        service: { select: { id: true, name: true } },
      },
      orderBy: { activeFrom: 'desc' },
    });

    const complianceData = await Promise.all(
      definitions.map(async def => {
        try {
          let windowDays = 30;
          switch (def.window) {
            case '7d':
              windowDays = 7;
              break;
            case '30d':
              windowDays = 30;
              break;
            case '90d':
            case 'quarterly':
              windowDays = 90;
              break;
            case 'yearly':
              windowDays = 365;
              break;
          }

          const metrics = await calculateSLAMetrics({
            serviceId: def.serviceId || undefined,
            priority: (def as any).priority || undefined,
            windowDays,
          });

          let currentValue: number | null = null;
          let previousUptime: number | null = null;
          let breached = false;

          switch (def.metricType) {
            case 'UPTIME':
            case 'AVAILABILITY':
              if (def.serviceId) {
                const now = new Date();
                const startDate = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
                const uptimeMap = await calculateMultiServiceUptime(
                  [def.serviceId],
                  startDate,
                  now
                );
                currentValue = uptimeMap[def.serviceId] ?? null;
                const previousStart = new Date(startDate.getTime() - windowDays * 86400000);
                const previousMap = await calculateMultiServiceUptime(
                  [def.serviceId],
                  previousStart,
                  startDate
                );
                previousUptime = previousMap[def.serviceId] ?? null;
              }
              if (currentValue !== null) {
                currentValue = Math.max(0, Math.min(100, currentValue));
                breached = currentValue < def.target;
              }
              break;
            case 'MTTA':
              currentValue = metrics.mttd;
              breached = currentValue !== null && currentValue > def.target;
              break;
            case 'MTTR':
              currentValue = metrics.mttr;
              breached = currentValue !== null && currentValue > def.target;
              break;
            case 'LATENCY_P99':
              currentValue = metrics.avgLatencyP99;
              breached = currentValue !== null && currentValue > def.target;
              break;
          }

          let trend: 'up' | 'down' | 'stable' = 'stable';
          if (def.metricType === 'UPTIME' || def.metricType === 'AVAILABILITY') {
            if (currentValue !== null && previousUptime !== null) {
              if (currentValue > previousUptime) trend = 'up';
              else if (currentValue < previousUptime) trend = 'down';
            }
          } else if (metrics.previousPeriod.available !== false && def.metricType === 'MTTA') {
            const prev = metrics.previousPeriod.mtta;
            const curr = currentValue;
            if (prev !== null && curr !== null) {
              if (curr < prev) trend = 'up';
              else if (curr > prev) trend = 'down';
            }
          } else if (metrics.previousPeriod.available !== false) {
            if (metrics.previousPeriod.mttr !== null && metrics.mttr !== null) {
              if (metrics.mttr < metrics.previousPeriod.mttr) trend = 'up';
              else if (metrics.mttr > metrics.previousPeriod.mttr) trend = 'down';
            }
          }

          return {
            definitionId: def.id,
            name: def.name,
            serviceId: def.serviceId,
            serviceName: def.service?.name ?? 'Global',
            metricType: def.metricType,
            target: def.target,
            window: def.window,
            currentValue,
            breached,
            dataState: currentValue === null ? ('no_data' as const) : ('available' as const),
            trend,
            totalIncidents: metrics.totalIncidents,
            activeIncidents: metrics.activeIncidents,
            lastUpdated: new Date().toISOString(),
          };
        } catch (err) {
          logger.error('Failed to calculate compliance for definition', {
            definitionId: def.id,
            error: err,
          });
          return {
            definitionId: def.id,
            name: def.name,
            serviceId: def.serviceId,
            serviceName: def.service?.name ?? 'Global',
            metricType: def.metricType,
            target: def.target,
            window: def.window,
            currentValue: null,
            breached: null,
            trend: 'stable' as const,
            totalIncidents: null,
            activeIncidents: null,
            dataState: 'unavailable' as const,
            error: 'Failed to calculate',
            lastUpdated: new Date().toISOString(),
          };
        }
      })
    );

    const totalDefinitions = complianceData.length;
    const availableDefinitions = complianceData.filter(c => c.dataState === 'available');
    const breachedCount = availableDefinitions.filter(c => c.breached === true).length;
    const healthyCount = availableDefinitions.length - breachedCount;
    const unavailableCount = complianceData.filter(c => c.dataState === 'unavailable').length;
    const noDataCount = complianceData.filter(c => c.dataState === 'no_data').length;
    const complianceValues = complianceData
      .filter(
        c =>
          c.currentValue !== null && (c.metricType === 'UPTIME' || c.metricType === 'AVAILABILITY')
      )
      .map(c => c.currentValue as number);
    const avgCompliance = complianceValues.length
      ? complianceValues.reduce((sum, value) => sum + value, 0) / complianceValues.length
      : null;

    return jsonOk({
      definitions: complianceData,
      summary: {
        total: totalDefinitions,
        available: availableDefinitions.length,
        unavailable: unavailableCount,
        noData: noDataCount,
        healthy: healthyCount,
        breached: breachedCount,
        avgCompliance: avgCompliance === null ? null : Math.round(avgCompliance * 100) / 100,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AppError) return jsonError(error);
    logger.error('SLA compliance calculation error', { error });
    return jsonError(new AppError({ code: 'INTERNAL_ERROR', cause: error }));
  }
}
