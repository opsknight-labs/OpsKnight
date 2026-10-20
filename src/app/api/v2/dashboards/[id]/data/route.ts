import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route, enforceV2Authorization } from '@/lib/api-v2';
import { DashboardIdV2Schema, dashboardReadWhere } from '@/lib/api-v2/dashboards';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { serializeSlaMetrics } from '@/lib/sla';
import { AppError } from '@/lib/errors';

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).optional(),
  serviceId: z.string().trim().min(1).max(100).optional(),
}).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  paramsSchema: DashboardIdV2Schema,
  querySchema,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ actor, params, query }) => {
    const dashboard = await prisma.dashboard.findFirst({
      where: { id: params.id, AND: [dashboardReadWhere(actor)] },
      select: { id: true, config: true },
    });
    if (!dashboard) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const configuredDays =
      dashboard.config && typeof dashboard.config === 'object' && !Array.isArray(dashboard.config)
        ? (dashboard.config as Record<string, unknown>).timeRange
        : undefined;
    const days = query.days ??
      (typeof configuredDays === 'number' && Number.isInteger(configuredDays)
        ? Math.max(1, Math.min(configuredDays, 90))
        : 7);
    const metrics = await calculateActorSLAMetrics(actor, {
      windowDays: days,
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
    });
    return { data: {
      dashboardId: dashboard.id,
      windowDays: days,
      serviceId: query.serviceId ?? null,
      generatedAt: new Date().toISOString(),
      metrics: serializeSlaMetrics(metrics),
    } };
  },
});
