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

export async function GET(req: NextRequest) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.REPORT_READ);

    const { searchParams } = new URL(req.url);
    const serviceId = searchParams.get('serviceId')?.trim();
    const daysRaw = Number(searchParams.get('days') || '30');
    const days = Number.isSafeInteger(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 30;

    const sinceDate = new Date(Date.now() - days * 86_400_000);

    const where = {
      createdAt: { gte: sinceDate },
      ...(serviceId ? { serviceId } : {}),
    };

    const [total, resolved, open, byPriority] = await Promise.all([
      prisma.incident.count({ where }),
      prisma.incident.count({ where: { ...where, status: 'RESOLVED' } }),
      prisma.incident.count({ where: { ...where, status: { in: ['OPEN', 'ACKNOWLEDGED'] } } }),
      prisma.incident.groupBy({
        by: ['priority'],
        where,
        _count: { id: true },
      }),
    ]);

    // Average resolution time for resolved incidents in range
    const resolvedIncidents = await prisma.incident.findMany({
      where: { ...where, status: 'RESOLVED', resolvedAt: { not: null } },
      select: { createdAt: true, resolvedAt: true, acknowledgedAt: true },
      take: 200,
    });

    let mttrMinutes: number | null = null;
    let mttaMinutes: number | null = null;

    if (resolvedIncidents.length > 0) {
      const totalResolveMs = resolvedIncidents.reduce((sum, inc) => {
        return sum + (inc.resolvedAt!.getTime() - inc.createdAt.getTime());
      }, 0);
      mttrMinutes = Math.round(totalResolveMs / resolvedIncidents.length / 60_000);

      const acked = resolvedIncidents.filter(inc => inc.acknowledgedAt !== null);
      if (acked.length > 0) {
        const totalAckMs = acked.reduce((sum, inc) => {
          return sum + (inc.acknowledgedAt!.getTime() - inc.createdAt.getTime());
        }, 0);
        mttaMinutes = Math.round(totalAckMs / acked.length / 60_000);
      }
    }

    const priorityCounts: Record<string, number> = {};
    for (const group of byPriority) {
      if (group.priority) {
        priorityCounts[group.priority] = group._count.id;
      }
    }

    const metrics = {
      windowDays: days,
      since: sinceDate.toISOString(),
      serviceId: serviceId ?? null,
      summary: {
        totalIncidents: total,
        resolvedIncidents: resolved,
        openIncidents: open,
        mttrMinutes,
        mttaMinutes,
      },
      incidentsByPriority: priorityCounts,
    };

    return apiV2Success(metrics, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
