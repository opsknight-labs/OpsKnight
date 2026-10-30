import 'server-only';

import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { dashboardReadWhere } from './dashboards';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { serializeSlaMetrics } from '@/lib/sla';
import { AppError } from '@/lib/errors';
import { AUTHORIZATION_ACTIONS, type AuthorizationActor } from '@/lib/authorization-policy';
import { enforceV2Authorization } from '@/lib/api-v2/rbac';

export const DashboardDataQueryV2Schema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).optional(),
    serviceId: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export async function readDashboardData(
  actor: AuthorizationActor,
  dashboardId: string,
  query: z.infer<typeof DashboardDataQueryV2Schema>
) {
  const dashboard = await prisma.dashboard.findFirst({
    where: { id: dashboardId, AND: [dashboardReadWhere(actor)] },
    select: { id: true, config: true },
  });
  if (!dashboard) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
  const configuredDays =
    dashboard.config && typeof dashboard.config === 'object' && !Array.isArray(dashboard.config)
      ? (dashboard.config as Record<string, unknown>).timeRange
      : undefined;
  const days =
    query.days ??
    (typeof configuredDays === 'number' && Number.isInteger(configuredDays)
      ? Math.max(1, Math.min(configuredDays, 90))
      : 7);
  const metrics = await calculateActorSLAMetrics(actor, {
    windowDays: days,
    ...(query.serviceId ? { serviceId: query.serviceId } : {}),
  });
  return {
    dashboardId: dashboard.id,
    windowDays: days,
    serviceId: query.serviceId ?? null,
    generatedAt: new Date().toISOString(),
    metrics: serializeSlaMetrics(metrics),
  };
}
