import { getServerSession } from 'next-auth';
import { NextRequest } from 'next/server';
import { getAuthOptions } from '@/lib/auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { getWidgetData } from '@/lib/widget-data-provider';
import prisma from '@/lib/prisma';
import { buildRetainedDateFilter } from '@/lib/dashboard-utils';

/**
 * Unified Widget Data API
 * Single endpoint to fetch all dashboard widget data
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(await getAuthOptions());
    if (!session?.user?.email) {
      return jsonError('Unauthorized', 401);
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      return jsonError('User not found', 404);
    }

    const searchParams = new URL(req.url).searchParams;
    const range = searchParams.get('range') || '30';
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const assigneeParam = searchParams.get('assignee');
    const serviceParam = searchParams.get('service');

    const dateFilter = await buildRetainedDateFilter(range, startDate, endDate);

    const widgetData = await getWidgetData(user.id, user.role, {
      serviceId: serviceParam && serviceParam !== 'all' ? serviceParam : undefined,
      assigneeId: assigneeParam === null ? undefined : assigneeParam === '' ? null : assigneeParam,
      urgency: (searchParams.get('urgency') as 'HIGH' | 'MEDIUM' | 'LOW' | null) || undefined,
      status:
        (searchParams.get('status') as
          | 'OPEN'
          | 'ACKNOWLEDGED'
          | 'SNOOZED'
          | 'SUPPRESSED'
          | 'RESOLVED'
          | null) || undefined,
      startDate: dateFilter.createdAt.gte,
      endDate: dateFilter.createdAt.lte,
      includeAllTime: range === 'all',
    });

    return jsonOk(widgetData, 200, {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
  } catch (error) {
    logger.error('api.widgets.data.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch widget data', 500);
  }
}
