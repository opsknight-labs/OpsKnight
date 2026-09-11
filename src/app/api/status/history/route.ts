import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { getReportingWindowForDays } from '@/lib/retention-policy';
import {
  incidentDetailCutoff,
  publicStatusVisibility,
  serializePublicStatusIncident,
} from '@/lib/status-page-public-data';
import { statusPagePublicationLimits } from '@/lib/status-pages/publication-policy';
import type { IncidentStatus } from '@prisma/client';
import {
  PRIVATE_STATUS_CACHE_CONTROL,
  PUBLIC_STATUS_CACHE_CONTROL,
} from '@/lib/status-pages/cache-policy';

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

    // Publication contract must be derived after the page is loaded — computing it before
    // would reference an undefined settings object and would let callers request history beyond
    // what the page actually publishes (e.g. 730 days when the page publishes 90).
    const daysParam = searchParams.get('days');
    const parsedDays = daysParam ? Number.parseInt(daysParam, 10) : 90;
    const requestedDays = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 730) : 90;
    const contract = statusPagePublicationLimits(statusPage);
    const days = Math.min(requestedDays, contract.historyDays);
    const isClippedByContract = requestedDays > contract.historyDays;

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

    const detailCutoffMs = incidentDetailCutoff(
      statusPage as unknown as Parameters<typeof incidentDetailCutoff>[0],
      now.getTime()
    );
    // Cursor pagination — prevents silently truncated history.
    const cursor = searchParams.get('cursor');
    const requestedLimitRaw = Number.parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(requestedLimitRaw) ? Math.max(1, Math.min(100, requestedLimitRaw)) : 50;
    // Overlap semantics: include incidents that were active at any point during the window,
    // not just those created inside it. An incident that started before the window but
    // resolved within it (or is still open) must be visible.
    const openStatuses: IncidentStatus[] = ['OPEN', 'ACKNOWLEDGED'];
    const incidentWhere = {
      serviceId: { in: effectiveServiceIds },
      visibility: 'PUBLIC' as const,
      OR: [
        // Created inside the window
        { createdAt: { gte: window.start, lte: window.end } },
        // Started before window, still overlapping (resolved inside or still open)
        {
          createdAt: { lt: window.start },
          OR: [{ resolvedAt: { gte: window.start } }, { resolvedAt: null, status: { in: openStatuses } }],
        },
      ],
    };
    const rawIncidents = visibility.showIncidents
      ? await prisma.incident.findMany({
          where: incidentWhere,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
      : [];
    const hasMore = rawIncidents.length > limit;
    const pageIncidents = hasMore ? rawIncidents.slice(0, limit) : rawIncidents;
    const nextCursor = hasMore ? pageIncidents.at(-1)?.id ?? null : null;
    const incidents = pageIncidents.map(incident =>
      serializePublicStatusIncident(
        incident,
        statusPage as unknown as Parameters<typeof serializePublicStatusIncident>[1],
        { pageId: statusPage.id, now, detailCutoffMs }
      )
    );
    const services = visibility.showServices
      ? statusPage.services
          .filter(item => effectiveServiceIds.includes(item.serviceId))
          .map(item => ({ id: item.service.id, name: item.service.name }))
      : [];

    const response = jsonOk(
      {
        incidents,
        services,
        pagination: hasMore ? { nextCursor, hasMore: true } : { hasMore: false },
        period: {
          requestedDays,
          days,
          startDate: window.start.toISOString(),
          endDate: window.end.toISOString(),
          effectiveStart: window.start.toISOString(),
          effectiveEnd: window.end.toISOString(),
          isClipped: window.isClipped || isClippedByContract,
          isClippedByContract,
        },
      },
      200
    );
    if (statusPage.requireAuth || statusPage.statusApiRequireToken) {
      response.headers.set('Cache-Control', PRIVATE_STATUS_CACHE_CONTROL);
      response.headers.set('Vary', 'Cookie, Authorization');
    } else {
      response.headers.set('Cache-Control', PUBLIC_STATUS_CACHE_CONTROL);
    }
    return response;
  } catch (error: unknown) {
    logger.error('api.status.history.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch history', 500);
  }
}
