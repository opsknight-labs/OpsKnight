import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getReportingWindowForDays } from '@/lib/retention-policy';
import {
  publicStatusVisibility,
  serializePublicStatusIncident,
} from '@/lib/status-page-public-data';

/**
 * Get Status Page Historical Data
 * GET /api/status/history?serviceId=xxx&days=90
 */
export async function GET(req: NextRequest) {
  return getStatusHistoryResponse(req);
}

export async function getStatusHistoryResponse(req: NextRequest, slug?: string) {
  try {
    const { searchParams } = new URL(req.url);
    const serviceId = searchParams.get('serviceId');
    const daysParam = searchParams.get('days');
    const parsedDays = daysParam ? Number.parseInt(daysParam, 10) : 90;
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 730) : 90;

    const statusPage = await prisma.statusPage.findFirst({
      where: slug ? { enabled: true, slug } : { enabled: true, isDefault: true },
      include: {
        services: {
          include: {
            service: true,
          },
        },
      },
    });

    if (!statusPage) {
      return jsonError('Status page not found or disabled', 404);
    }

    const authResult = await authorizeStatusApiRequest(req, statusPage.id, {
      requireToken: statusPage.statusApiRequireToken,
      rateLimitEnabled: statusPage.statusApiRateLimitEnabled,
      rateLimitMax: statusPage.statusApiRateLimitMax,
      rateLimitWindowSec: statusPage.statusApiRateLimitWindowSec,
    });
    if (!authResult.allowed) {
      if (authResult.status === 429) {
        return NextResponse.json(
          { error: authResult.error || 'Rate limit exceeded' },
          {
            status: 429,
            headers: authResult.retryAfter
              ? { 'Retry-After': String(authResult.retryAfter) }
              : undefined,
          }
        );
      }
      return jsonError(authResult.error || 'Unauthorized', authResult.status || 401);
    }

    if (statusPage.requireAuth) {
      const session = await getServerSession(await getAuthOptions());
      if (!session) {
        return jsonError('Authentication required', 401);
      }
    }

    const visibility = publicStatusVisibility(statusPage);

    const serviceIds = statusPage.services.filter(sp => sp.showOnPage).map(sp => sp.serviceId);

    if (serviceId && !serviceIds.includes(serviceId)) {
      return jsonError('Service is not available on this status page', 404);
    }

    const effectiveServiceIds = serviceId ? [serviceId] : serviceIds;

    if (effectiveServiceIds.length === 0) {
      return jsonOk({ incidents: [], services: [] }, 200);
    }

    const now = new Date();
    const window = await getReportingWindowForDays(days, 'incident', now);

    const incidents = visibility.showIncidents
      ? (
          await prisma.incident.findMany({
            where: {
              serviceId: { in: effectiveServiceIds },
              visibility: 'PUBLIC',
              createdAt: { gte: window.start, lte: window.end },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              urgency: true,
              createdAt: true,
              resolvedAt: true,
              service: { select: { name: true, region: true } },
            },
          })
        ).map(incident => serializePublicStatusIncident(incident, statusPage))
      : [];
    const services = visibility.showServices
      ? statusPage.services
          .filter(item => effectiveServiceIds.includes(item.serviceId))
          .map(item => ({ id: item.service.id, name: item.service.name }))
      : [];

    const response = jsonOk(
      {
        incidents,
        services,
        period: {
          days,
          startDate: window.start.toISOString(),
          endDate: window.end.toISOString(),
          // Retention info
          effectiveStart: window.start.toISOString(),
          effectiveEnd: window.end.toISOString(),
          isClipped: window.isClipped,
        },
      },
      200
    );
    if (statusPage.requireAuth || statusPage.statusApiRequireToken) {
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('Vary', 'Cookie, Authorization');
    } else {
      response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    }
    return response;
  } catch (error: any) {
    logger.error('api.status.history.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch history', 500);
  }
}
