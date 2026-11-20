import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { incidentReadWhere } from '@/lib/authorization-filters';

const RATE_LIMIT_MAX = 30; // 30 requests per minute
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

export async function GET() {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) {
      return jsonError('Unauthorized', 401);
    }

    // Rate limiting to prevent abuse
    const rateKey = `api:sidebar-stats:${session.user.email}`;
    const rate = await checkRateLimit(rateKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return jsonError('Rate limit exceeded', 429, { retryAfter });
    }

    const actor = await getCurrentAuthorizationActor();
    const where = {
      AND: [incidentReadWhere(actor), { status: { in: activeIncidentStatuses() } }],
    };

    // Group by Urgency to get breakdown
    const [urgencyCounts, enabledStatusPages] = await Promise.all([
      prisma.incident.groupBy({
        by: ['urgency'],
        where,
        _count: { _all: true },
      }),
      // Lightweight piggyback: fetch enabled status page metadata for sidebar nav.
      // Indexed on `enabled` field — negligible cost. Avoids a separate API call per page render.
      prisma.statusPage.findMany({
        where: { enabled: true },
        select: { id: true, name: true, slug: true, isDefault: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);

    const activeIncidentsCount = urgencyCounts.reduce((acc, curr) => acc + curr._count._all, 0);
    const criticalIncidentsCount = urgencyCounts.find(u => u.urgency === 'HIGH')?._count._all || 0;
    const mediumIncidentsCount = urgencyCounts.find(u => u.urgency === 'MEDIUM')?._count._all || 0;
    const lowIncidentsCount = urgencyCounts.find(u => u.urgency === 'LOW')?._count._all || 0;
    const isStatusPageAdmin = hasCapability(actor.role, CAPABILITIES.ADMIN_MANAGE);

    return jsonOk(
      {
        activeIncidentsCount,
        criticalIncidentsCount,
        mediumIncidentsCount,
        lowIncidentsCount,
        statusPages: enabledStatusPages,
        isStatusPageAdmin,
        scope: 'current',
        dataState: 'available',
        calculatedAt: new Date().toISOString(),
      },
      200,
      {
        // Safe caching: 10 second browser cache, allows stale for 30 seconds while revalidating
        'Cache-Control': 'private, max-age=10, stale-while-revalidate=30',
      }
    );
  } catch (error) {
    logger.error('api.sidebar_stats.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch stats', 500);
  }
}
