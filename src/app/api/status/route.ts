import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeStatusApiRequest } from '@/lib/status-api-auth';
import { serializeRecentIncidents } from '@/lib/sla';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { getReportingWindowForDays } from '@/lib/retention-policy';
import {
  publicStatusVisibility,
  serializePublicStatusApiIncident,
} from '@/lib/status-page-public-data';

/**
 * Status Page API
 * Returns JSON data for status page integrations
 *
 * GET /api/status
 */
export async function GET(req: NextRequest) {
  try {
    const statusPage = await prisma.statusPage.findFirst({
      where: { enabled: true },
      select: {
        id: true,
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

    const { calculateSLAMetrics, calculateMultiServiceUptime, getExternalStatusLabel } =
      await import('@/lib/sla-server');

    // Optimized: Single call to get metrics and incidents for all services in scope
    const metrics = await calculateSLAMetrics({
      serviceId: serviceIds,
      includeIncidents: true,
      incidentLimit: 20,
      visibility: 'PUBLIC',
    });

    const recentIncidents = metrics.recentIncidents || [];

    const serviceStatusMap = new Map<string, string>();
    const serviceActiveCountMap = new Map<string, number>();

    metrics.serviceMetrics.forEach(m => {
      serviceStatusMap.set(m.id, getExternalStatusLabel(m.dynamicStatus));
      serviceActiveCountMap.set(m.id, m.activeCount);
    });

    const overallStatus =
      metrics.dynamicStatus === 'CRITICAL'
        ? 'outage'
        : metrics.dynamicStatus === 'DEGRADED'
          ? 'degraded'
          : 'operational';

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

    const uptimeWindow = await getReportingWindowForDays(30, 'incident');
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

    return jsonOk(
      {
        status: overallStatus,
        services: servicesData,
        incidents: visibility.showIncidents
          ? serializeRecentIncidents(recentIncidents).map(inc =>
              serializePublicStatusApiIncident(inc, statusPage)
            )
          : [],
        metrics: {
          uptime: uptimeMetrics,
        },
        retention: {
          effectiveStart: metrics.effectiveStart.toISOString(),
          effectiveEnd: metrics.effectiveEnd.toISOString(),
          isClipped: uptimeWindow.isClipped || metrics.isClipped,
        },
        updatedAt: new Date().toISOString(),
      },
      200,
      headers
    );
  } catch (error: any) {
    logger.error('api.status.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to fetch status', 500);
  }
}
