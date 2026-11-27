import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import type { Prisma } from '@prisma/client';
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    // Aggregations are expensive: use the stricter search/export budget.
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'SEARCH_EXPORT');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.REPORT_READ);

    const { searchParams } = new URL(req.url);
    const serviceId = searchParams.get('serviceId')?.trim();
    const daysRaw = Number(searchParams.get('days') || '30');
    const days = Number.isSafeInteger(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 30;

    // 1. Calculate certified SLA and operational metrics with canonical actor scoping
    const sla = await calculateActorSLAMetrics(actor, {
      windowDays: days,
      serviceId: serviceId || undefined,
    });

    // 2. Compute priority breakdown respecting actor incident read access, over the same window the
    // summary used so the two always describe the same incidents.
    const priorityWhere: Prisma.IncidentWhereInput = {
      AND: [
        incidentReadWhere(actor),
        { createdAt: { gte: sla.effectiveStart, lte: sla.effectiveEnd } },
        ...(serviceId ? [{ serviceId }] : []),
      ],
    };

    const byPriority = await prisma.incident.groupBy({
      by: ['priority'],
      where: priorityWhere,
      _count: { id: true },
    });

    const priorityCounts: Record<string, number> = {};
    for (const group of byPriority) {
      // Incidents without a priority are counted too, so the buckets add up to the total.
      priorityCounts[group.priority ?? 'UNSET'] = group._count.id;
    }

    const resolvedCount =
      sla.statusMix.find(s => s.status === 'RESOLVED')?.count ?? sla.resolvedIncidents ?? 0;

    const metrics = {
      windowDays: days,
      since: sla.effectiveStart.toISOString(),
      serviceId: serviceId ?? null,
      summary: {
        totalIncidents: sla.totalIncidents,
        resolvedIncidents: resolvedCount,
        openIncidents: sla.activeIncidents,
        mttrMinutes: sla.mttr !== null ? Math.round(sla.mttr) : null,
        mttaMinutes: sla.mttd !== null ? Math.round(sla.mttd) : null,
      },
      incidentsByPriority: priorityCounts,
    };

    return apiV2Success(metrics, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
