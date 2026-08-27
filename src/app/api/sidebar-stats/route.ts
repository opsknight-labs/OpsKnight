import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import type { Prisma } from '@prisma/client';
import { activeIncidentStatuses } from '@/lib/incident-status';

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

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        role: true,
        teamMemberships: { select: { teamId: true } },
      },
    });

    if (!user) {
      return jsonError('Unauthorized', 401);
    }

    // Build efficient Where clause for Active Incidents
    const where: Prisma.IncidentWhereInput = {
      status: { in: activeIncidentStatuses() },
    };

    // Apply Scope Permissions
    if (user.role !== 'ADMIN' && user.role !== 'RESPONDER') {
      const teamIds = user.teamMemberships.map(membership => membership.teamId);

      // Use OR scope: Assigned to user OR Assigned to user's teams OR Service owned by user's teams
      where.OR = [
        { assigneeId: user.id },
        { teamId: { in: teamIds } },
        { service: { teamId: { in: teamIds } } },
      ];
    }

    // Group by Urgency to get breakdown
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
