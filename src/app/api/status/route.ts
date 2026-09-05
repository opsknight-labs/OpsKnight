import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { getReportingWindowForDays } from '@/lib/retention-policy';
import {
  publicStatusVisibility,
  serializePublicStatusApiIncident,
} from '@/lib/status-page-public-data';
import { createHash } from 'node:crypto';
import {
  activeMaintenanceServiceIds,
  projectOverallStatus,
  projectServiceStatus,
} from '@/lib/status-page-projection';

/**
 * Status Page API
 * Returns JSON data for status page integrations
 *
 * GET /api/status
 */
export async function GET(req: NextRequest) {
  return getStatusResponse(req);
}

export async function getStatusResponse(req: NextRequest, slug?: string) {
  try {
    const statusPage = await prisma.statusPage.findFirst({
      where: { enabled: true, ...(slug ? { slug } : {}) },
      orderBy: slug ? undefined : [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        updatedAt: true,
        enabled: true,
        requireAuth: true,
        statusApiRequireToken: true,
        statusApiRateLimitEnabled: true,
        statusApiRateLimitMax: true,
        statusApiRateLimitWindowSec: true,
        showServices: true,
        showIncidents: true,
        showMetrics: true,
        showIncidentDetails: true,
        showIncidentTitles: true,
        showIncidentDescriptions: true,
        showAffectedServices: true,
        showIncidentTimestamps: true,
        showServiceMetrics: true,
        showServiceRegions: true,
        showServiceOwners: true,
        showServiceSlaTier: true,
        showTeamInformation: true,
        showIncidentUrgency: true,
        showUptimeHistory: true,
        showRecentIncidents: true,
        services: {
          select: {
            serviceId: true,
            showOnPage: true,
            order: true,
          },
          orderBy: { order: 'asc' },
        },
        announcements: {
          where: {
            isActive: true,
            type: 'MAINTENANCE',
            startDate: { lte: new Date() },
            OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
          },
          select: { affectedServiceIds: true, updatedAt: true },
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

    // Check if authentication is required
    if (statusPage.requireAuth) {
      const session = await getServerSession(await getAuthOptions());
      if (!session) {
        return jsonError('Authentication required', 401);
      }
    }

    const visibility = publicStatusVisibility(statusPage);

    const serviceIds = statusPage.services.filter(sp => sp.showOnPage).map(sp => sp.serviceId);

    if (serviceIds.length === 0) {
      return jsonOk(
        {
          status: 'operational',
          services: [],
          incidents: [],
          metrics: { uptime: [] },
          retention: null,
          updatedAt: new Date().toISOString(),
        },
        200
      );
    }

    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: {
        id: true,
        name: true,
        region: true,
        slaTier: true,
        status: true,
        team: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            incidents: {
              where: {
                status: { in: activeIncidentStatuses() },
                visibility: 'PUBLIC',
              },
            },
          },
        },
      },
    });

    const { calculateMultiServiceUptime, getExternalStatusLabel } =
      await import('@/lib/sla-server');
    const uptimeWindow = await getReportingWindowForDays(30, 'incident');
    const [activeGroups, recentIncidents] = await Promise.all([
      prisma.incident.groupBy({
        by: ['serviceId', 'urgency'],
        where: {
          serviceId: { in: serviceIds },
          visibility: 'PUBLIC',
          status: { in: activeIncidentStatuses() },
        },
        _count: { _all: true },
      }),
      visibility.showIncidents
        ? prisma.incident.findMany({
            where: {
              serviceId: { in: serviceIds },
              visibility: 'PUBLIC',
              createdAt: { gte: uptimeWindow.start, lte: uptimeWindow.end },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
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
        : Promise.resolve([]),
    ]);

    const serviceStatusMap = new Map<string, string>();
    const serviceActiveCountMap = new Map<string, number>();

    for (const serviceId of serviceIds) {
      const groups = activeGroups.filter(group => group.serviceId === serviceId);
      const activeCount = groups.reduce((sum, group) => sum + group._count._all, 0);
      const dynamicStatus = groups.some(group => group.urgency === 'HIGH')
        ? 'CRITICAL'
        : activeCount > 0
          ? 'DEGRADED'
          : 'OPERATIONAL';
      serviceStatusMap.set(serviceId, getExternalStatusLabel(dynamicStatus));
      serviceActiveCountMap.set(serviceId, activeCount);
    }

    const maintenanceServiceIds = activeMaintenanceServiceIds(statusPage.announcements, new Date());
    for (const serviceId of serviceIds) {
      serviceStatusMap.set(
        serviceId,
        projectServiceStatus(
          serviceId,
          serviceStatusMap.get(serviceId) ?? 'OPERATIONAL',
          maintenanceServiceIds
        )
      );
    }

    const overallStatus = projectOverallStatus(
      activeGroups.some(group => group.urgency === 'HIGH'),
      activeGroups.length > 0,
      maintenanceServiceIds
    );

    const servicesData = visibility.showServices
      ? services.map(service => ({
          id: service.id,
          name: service.name,
          ...(visibility.showServiceRegion ? { region: service.region ?? null } : {}),
          ...(visibility.showServiceSlaTier ? { slaTier: service.slaTier ?? null } : {}),
          ...(visibility.showTeam
            ? { ownerTeam: service.team ? { id: service.team.id, name: service.team.name } : null }
            : {}),
          status: serviceStatusMap.get(service.id) || service.status,
          ...(visibility.showMetrics
            ? { activeIncidents: serviceActiveCountMap.get(service.id) || 0 }
            : {}),
        }))
      : [];

    const uptimeMap = visibility.showUptime
      ? await calculateMultiServiceUptime(
          serviceIds,
          uptimeWindow.start,
          uptimeWindow.end,
          'PUBLIC'
        )
      : {};
    const uptimeMetrics = visibility.showUptime
      ? services.map(service => ({
          serviceId: service.id,
          uptime: parseFloat((uptimeMap[service.id] ?? 100).toFixed(3)),
        }))
      : [];

    // Never let a shared cache satisfy a request that is protected at the
    // origin. Public status payloads can absorb outage traffic at the edge;
    // token/session-protected payloads remain private.
    const headers: Record<string, string> = {
      'Cache-Control':
        statusPage.requireAuth || statusPage.statusApiRequireToken
          ? 'private, no-store'
          : 'public, s-maxage=15, stale-while-revalidate=120',
      Expires: '0',
    };
    const snapshotUpdatedAt = [
      statusPage.updatedAt,
      ...statusPage.announcements.map(item => item.updatedAt),
      ...recentIncidents.flatMap(
        item => [item.createdAt, item.resolvedAt].filter(Boolean) as Date[]
      ),
    ].reduce(
      (latest, candidate) => (candidate > latest ? candidate : latest),
      statusPage.updatedAt
    );

    const responseData = {
      status: overallStatus,
      services: servicesData,
      incidents: visibility.showIncidents
        ? recentIncidents.map(inc => serializePublicStatusApiIncident(inc, statusPage))
        : [],
      metrics: { uptime: uptimeMetrics },
      retention: {
        effectiveStart: uptimeWindow.start.toISOString(),
        effectiveEnd: uptimeWindow.end.toISOString(),
        isClipped: uptimeWindow.isClipped,
      },
      updatedAt: snapshotUpdatedAt.toISOString(),
    };
    if (!statusPage.requireAuth && !statusPage.statusApiRequireToken) {
      const etag = `"${createHash('sha256').update(JSON.stringify(responseData)).digest('base64url')}"`;
      if (req.headers.get('if-none-match') === etag) {
        return new NextResponse(null, { status: 304, headers: { ...headers, ETag: etag } });
      }
      headers.ETag = etag;
    }
    return jsonOk(responseData, 200, headers);
  } catch (error: any) {
    logger.error('api.status.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch status', 500);
  }
}
