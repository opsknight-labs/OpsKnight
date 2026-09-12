import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { resolveStatusPage } from '@/lib/status-page-resolver';
import { publicStatusVisibility } from '@/lib/status-page-public-data';
import {
  buildEnhancedUptimeCsv,
  buildEnhancedUptimePdf,
  StatusPageReportData,
  StatusPageReportIncident,
} from '@/lib/status-pages/reports/uptime-report-generator';

export async function GET(req: NextRequest) {
  return getUptimeExportResponse(req);
}

export async function getUptimeExportResponse(req: NextRequest, slug?: string) {
  const { searchParams } = new URL(req.url);
  const statusPageId = searchParams.get('statusPageId');

  let isAdmin = false;
  try {
    await assertAdmin();
    isAdmin = true;
  } catch (_error) {
    isAdmin = false;
  }

  const resolvedPage = await resolveStatusPage(
    slug ? { slug } : statusPageId ? { id: statusPageId } : { default: true }
  );

  let targetPage = resolvedPage;
  // If an admin requests a draft/disabled status page by ID, resolve it directly
  if (!targetPage && isAdmin && statusPageId) {
    targetPage = await prisma.statusPage.findUnique({
      where: { id: statusPageId },
    });
  }

  if (!targetPage) return new NextResponse('Status page not found', { status: 404 });

  if (!isAdmin) {
    if (!targetPage.enableUptimeExports) {
      return new NextResponse('Unauthorized', { status: 403 });
    }
    if (targetPage.requireAuth || targetPage.privacyMode === 'PRIVATE') {
      const session = await getServerSession(await getAuthOptions());
      if (!session) {
        return new NextResponse('Authentication required', {
          status: 401,
          headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
        });
      }
    }
  }

  try {
    const format = (searchParams.get('format') || 'csv').toLowerCase();
    const monthParam = searchParams.get('month');
    const monthMatch = monthParam?.match(/^(\d{4})-(\d{2})$/);
    const now = new Date();
    let year = monthMatch ? Number(monthMatch[1]) : now.getUTCFullYear();
    let monthIndex = monthMatch ? Number(monthMatch[2]) - 1 : now.getUTCMonth();

    if (isNaN(year) || year < 2000 || year > 2100) {
      year = now.getUTCFullYear();
    }
    if (isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
      monthIndex = now.getUTCMonth();
    }

    const periodStart = new Date(Date.UTC(year, monthIndex, 1));
    const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 1));

    const statusPage = await prisma.statusPage.findUnique({
      where: { id: targetPage.id },
      include: {
        services: {
          include: { service: true },
          where: { showOnPage: true },
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!statusPage) {
      return new NextResponse('Status page not found', { status: 404 });
    }

    if (!statusPage.enableUptimeExports && !isAdmin) {
      return new NextResponse('Uptime exports are disabled', { status: 403 });
    }

    const serviceIds = statusPage.services.map(sp => sp.serviceId);
    if (serviceIds.length === 0) {
      return new NextResponse('No services configured', { status: 400 });
    }

    // Enforce strict public boundary projection
    const visibility = publicStatusVisibility({
      showServices: statusPage.showServices,
      showIncidents: statusPage.showIncidents,
      showMetrics: statusPage.showMetrics,
      showIncidentDetails: statusPage.showIncidentDetails,
      showIncidentTitles: statusPage.showIncidentTitles,
      showIncidentDescriptions: statusPage.showIncidentDescriptions,
      showAffectedServices: statusPage.showAffectedServices,
      showIncidentTimestamps: statusPage.showIncidentTimestamps,
      showServiceMetrics: statusPage.showServiceMetrics,
      showServiceRegions: statusPage.showServiceRegions,
      showServiceOwners: statusPage.showServiceOwners,
      showServiceSlaTier: statusPage.showServiceSlaTier,
      showTeamInformation: statusPage.showTeamInformation,
      showIncidentUrgency: statusPage.showIncidentUrgency,
      showUptimeHistory: statusPage.showUptimeHistory,
      showRecentIncidents: statusPage.showRecentIncidents,
      showPostIncidentReview: statusPage.showPostIncidentReview,
      showIncidentHistoryDetails: statusPage.showIncidentHistoryDetails,
      incidentHistoryDetailDays: statusPage.incidentHistoryDetailDays,
    });

    // Compute uptime in PUBLIC mode
    const { calculateMultiServiceUptime } = await import('@/lib/sla-server');
    const uptimeMap = await calculateMultiServiceUptime(
      serviceIds,
      periodStart,
      periodEnd,
      'PUBLIC'
    );

    const totalPeriodMinutes = (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60);
    const excellentThreshold = statusPage.uptimeExcellentThreshold || 99.9;
    const goodThreshold = statusPage.uptimeGoodThreshold || 99.0;

    const reportServices = statusPage.services.map(sp => {
      const uptime = Math.max(0, Math.min(100, uptimeMap[sp.service.id] ?? 100));
      const downtimeMinutes = Math.max(0, ((100 - uptime) / 100) * totalPeriodMinutes);
      return {
        id: sp.service.id,
        name: sp.displayName || sp.service.name,
        region: visibility.showServiceRegion ? sp.service.region : null,
        description: statusPage.showServiceDescriptions ? sp.service.description : null,
        uptime,
        slaTarget: excellentThreshold,
        downtimeMinutes,
      };
    });

    // Fetch public incidents for reporting period if incidents are enabled for public
    let reportIncidents: StatusPageReportIncident[] = [];
    if (visibility.showIncidents && serviceIds.length > 0) {
      const incidents = await prisma.incident.findMany({
        where: {
          serviceId: { in: serviceIds },
          visibility: 'PUBLIC',
          createdAt: { gte: periodStart, lt: periodEnd },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          createdAt: true,
          resolvedAt: true,
          status: true,
          service: { select: { id: true, name: true } },
        },
      });

      reportIncidents = incidents.map(inc => {
        const resolved = inc.resolvedAt || (inc.status === 'RESOLVED' ? periodEnd : null);
        const end = resolved ? Math.min(resolved.getTime(), periodEnd.getTime()) : now.getTime();
        const durationMinutes = Math.max(1, (end - inc.createdAt.getTime()) / (1000 * 60));
        return {
          id: inc.id,
          title: visibility.showIncidentTitle ? inc.title : 'Service Disruption',
          serviceName: visibility.showAffectedService ? inc.service?.name : null,
          startedAt: inc.createdAt,
          resolvedAt: inc.resolvedAt,
          durationMinutes,
          status: inc.status,
        };
      });
    }

    const overallAvailability =
      reportServices.length > 0
        ? reportServices.reduce((acc, s) => acc + s.uptime, 0) / reportServices.length
        : 100;

    const compliantCount = reportServices.filter(s => s.uptime >= s.slaTarget).length;
    const slaComplianceRate =
      reportServices.length > 0 ? (compliantCount / reportServices.length) * 100 : 100;

    // Resolve Branding Details
    const branding = (statusPage.branding as Record<string, unknown>) || {};
    const primaryColor =
      typeof branding.primaryColor === 'string' && branding.primaryColor.trim().length > 0
        ? branding.primaryColor.trim()
        : null;

    const pageUrl = statusPage.customDomain
      ? `https://${statusPage.customDomain}`
      : statusPage.subdomain
        ? `https://${statusPage.subdomain}.opsknight.com`
        : null;

    const reportData: StatusPageReportData = {
      pageId: statusPage.id,
      pageName: statusPage.name,
      organizationName: statusPage.organizationName || statusPage.name,
      url: pageUrl,
      primaryColor,
      periodStart,
      periodEnd,
      generatedAt: now,
      uptimeExcellentThreshold: excellentThreshold,
      uptimeGoodThreshold: goodThreshold,
      visibility: {
        showServices: visibility.showServices,
        showServiceRegion: visibility.showServiceRegion,
        showServiceDescription: statusPage.showServiceDescriptions,
        showIncidents: visibility.showIncidents,
        showIncidentTitle: visibility.showIncidentTitle,
        showIncidentDescription: visibility.showIncidentDescription,
        showAffectedService: visibility.showAffectedService,
        showIncidentTimestamp: visibility.showIncidentTimestamp,
      },
      services: reportServices,
      incidents: reportIncidents,
      overallAvailability,
      slaComplianceRate,
    };

    if (format === 'pdf') {
      const pdf = buildEnhancedUptimePdf(reportData);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="uptime-${statusPage.slug || 'report'}-${year}-${String(monthIndex + 1).padStart(2, '0')}.pdf"`,
        },
      });
    }

    const csv = buildEnhancedUptimeCsv(reportData);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="uptime-${statusPage.slug || 'report'}-${year}-${String(monthIndex + 1).padStart(2, '0')}.csv"`,
      },
    });
  } catch (error: unknown) {
    logger.error('api.status.uptime_export_error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse('Failed to export uptime report', { status: 500 });
  }
}
