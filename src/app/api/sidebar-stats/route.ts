import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import type { Prisma } from '@prisma/client';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { getCurrentUser } from '@/lib/rbac';
import { resolveUserActor } from '@/lib/authorization-actors';
import { incidentReadWhere } from '@/lib/authorization-filters';

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function GET() {
  try {
    const user = await getCurrentUser();

    const rateKey = `api:sidebar-stats:${user.id}`;
    const rate = await checkRateLimit(rateKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return jsonError('Rate limit exceeded', 429, { retryAfter });
    }

    const actor = await resolveUserActor(user.id);
    if (!actor) return jsonError('Unauthorized', 401);

    const where: Prisma.IncidentWhereInput = {
      status: { in: activeIncidentStatuses() },
      ...incidentReadWhere(actor),
    };

    const urgencyCounts = await prisma.incident.groupBy({
      by: ['urgency'],
      where,
      _count: { _all: true },
    });

    const activeIncidentsCount = urgencyCounts.reduce((acc, curr) => acc + curr._count._all, 0);
    const criticalIncidentsCount = urgencyCounts.find(u => u.urgency === 'HIGH')?._count._all || 0;
    const mediumIncidentsCount = urgencyCounts.find(u => u.urgency === 'MEDIUM')?._count._all || 0;
    const lowIncidentsCount = urgencyCounts.find(u => u.urgency === 'LOW')?._count._all || 0;

    return jsonOk(
      {
        activeIncidentsCount,
        criticalIncidentsCount,
        mediumIncidentsCount,
        lowIncidentsCount,
        scope: 'current',
        dataState: 'available',
        calculatedAt: new Date().toISOString(),
      },
      200,
      {
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
      }
    );
  } catch (error) {
    const unauthorized = error instanceof Error && error.message.includes('Unauthorized');
    if (unauthorized) return jsonError('Unauthorized', 401);
    logger.error('api.sidebar_stats.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch stats', 500);
  }
}
