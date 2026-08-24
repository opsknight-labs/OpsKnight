import prisma from '@/lib/prisma';
import { Metadata } from 'next';
import {
  Shield,
  AlertTriangle,
  Globe,
  Key,
  UserCheck,
  Database,
  Activity,
  Info,
  ArrowRight,
  Mail,
} from 'lucide-react';
import { getBaseUrl } from '@/lib/env-validation';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { logger } from '@/lib/logger';
import StatusPageHeader from '@/components/status-page/StatusPageHeader';
import StatusPageServices from '@/components/status-page/StatusPageServices';
import StatusPageIncidents from '@/components/status-page/StatusPageIncidents';
import StatusPageAnnouncements from '@/components/status-page/StatusPageAnnouncements';
import StatusPageSubscribe from '@/components/status-page/StatusPageSubscribe';
import StatusPageMetrics from '@/components/status-page/StatusPageMetrics';
import StatusPageAutoRefresh from '@/components/status-page/StatusPageAutoRefresh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const statusPage = await prisma.statusPage.findFirst({
    where: { enabled: true },
  });

  if (!statusPage) {
    return {
      title: 'Status Page',
      description: 'Service status and incident information',
    };
  }

  const branding =
    statusPage.branding &&
    typeof statusPage.branding === 'object' &&
    !Array.isArray(statusPage.branding)
      ? (statusPage.branding as Record<string, any>)
      : {};
  const metaTitle = (branding.metaTitle as string) || statusPage.name;
  const metaDescription =
    (branding.metaDescription as string) || `Status page for ${statusPage.name}`;
  const baseUrl = getBaseUrl();

  return {
    title: metaTitle,
    description: metaDescription,
    openGraph: {
      title: metaTitle,
      description: metaDescription,
      url: `${baseUrl}/status`,
      siteName: statusPage.name,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: metaTitle,
      description: metaDescription,
    },
    alternates: {
      types: {
        'application/rss+xml': `${baseUrl}/api/status/rss`,
      },
    },
  };
}

export default async function PublicStatusPage() {
  // Get the status page configuration
  const statusPage = await prisma.statusPage.findFirst({
    include: {
      services: {
        include: {
          service: true,
        },
        orderBy: { order: 'asc' },
      },
      announcements: {
        where: {
          isActive: true,
          OR: [{ type: 'UPDATE' }, { endDate: null }, { endDate: { gte: new Date() } }],
        },
        orderBy: { startDate: 'desc' },
        take: 3,
      },
    },
  });

  // Check if status page is disabled
  if (statusPage && !statusPage.enabled) {
    return (
      <div
        style={{ padding: '4rem 2rem', textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}
      >
        <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>??</div>
        <h1 style={{ fontSize: '2rem', fontWeight: '700', marginBottom: '1rem', color: '#111827' }}>
          Status Page Disabled
        </h1>
        <p style={{ fontSize: '1.1rem', color: '#6b7280', lineHeight: 1.6 }}>
          The status page is currently disabled by the administrator.
        </p>
      </div>
    );
  }

  // Check if authentication is required
  if (statusPage?.requireAuth) {
    const session = await getServerSession(await getAuthOptions());
    if (!session) {
      redirect('/login?callbackUrl=/status');
    }
  }

  // If no status page exists, create a default one
  if (!statusPage) {
    try {
      const newStatusPage = await prisma.statusPage.create({
        data: {
          name: 'Status Page',
          enabled: true,
          showServices: true,
          showIncidents: true,
          showMetrics: true,
        },
        include: {
          services: {
            include: {
              service: true,
            },
            orderBy: { order: 'asc' },
          },
          announcements: {
            where: {
              isActive: true,
              OR: [{ endDate: null }, { endDate: { gte: new Date() } }],
            },
            orderBy: { startDate: 'desc' },
            take: 10,
          },
        },
      });
      return renderStatusPage(newStatusPage);
    } catch (error: any) {
      logger.error('Status page creation error', { component: 'status-page', error });
      const isTableMissing =
        error.message?.includes('does not exist') ||
        error.code === '42P01' ||
        error.message?.includes('StatusPage');

      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            background: '#f9fafb',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              maxWidth: '600px',
              background: 'white',
              padding: '3rem',
              borderRadius: '0.5rem',
              boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            }}
          >
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>!</div>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 'bold',
                marginBottom: '1rem',
                color: '#111827',
              }}
            >
              Status Page Not Available
            </h1>
            {isTableMissing ? (
              <>
                <p style={{ color: '#6b7280', marginBottom: '1.5rem', lineHeight: '1.6' }}>
                  The database tables for the status page haven't been created yet. Please run the
                  database migration.
                </p>
                <div
                  style={{
                    background: '#f3f4f6',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    marginBottom: '1.5rem',
                    textAlign: 'left',
                  }}
                >
                  <p
                    style={{
                      fontSize: '0.875rem',
                      color: '#374151',
                      marginBottom: '0.5rem',
                      fontWeight: '600',
                    }}
                  >
                    Run this command:
                  </p>
                  <code
                    style={{
                      background: '#1f2937',
                      color: '#f9fafb',
                      padding: '0.75rem 1rem',
                      borderRadius: '0.25rem',
                      display: 'block',
                      fontSize: '0.875rem',
                      fontFamily: 'monospace',
                    }}
                  >
                    npx prisma db push
                  </code>
                </div>
                <p style={{ fontSize: '0.875rem', color: '#9ca3af' }}>
                  After running the migration, refresh this page.
                </p>
              </>
            ) : (
              <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
                An error occurred while setting up the status page. Please check the server logs or
                contact support.
              </p>
            )}
          </div>
        </div>
      );
    }
  }

  return renderStatusPage(statusPage);
}

async function renderStatusPage(statusPage: any) {
  // Parse branding
  const branding =
    statusPage.branding &&
    typeof statusPage.branding === 'object' &&
    !Array.isArray(statusPage.branding)
      ? (statusPage.branding as Record<string, any>) // eslint-disable-line @typescript-eslint/no-explicit-any
      : {};

  const backgroundColor = branding.backgroundColor || '#ffffff';
  const textColor = branding.textColor || 'var(--status-text, #111827)';
  const customCss = branding.customCss || '';
  const layout = branding.layout || 'default';
  const showHeader = branding.showHeader !== false;
  const showFooter = branding.showFooter !== false;
  const showRssLink = branding.showRssLink !== false;
  const showApiLink = branding.showApiLink !== false;
  const autoRefresh = branding.autoRefresh !== false;
  const refreshInterval = Number(branding.refreshInterval) || 60;
  const showSubscribe = statusPage.showSubscribe !== false;
  const showUptimeExports = statusPage.enableUptimeExports === true;

  // Get current service statuses
  const serviceIds = statusPage.services
    .filter((sp: any) => sp.showOnPage) // eslint-disable-line @typescript-eslint/no-explicit-any
    .map((sp: any) => sp.serviceId); // eslint-disable-line @typescript-eslint/no-explicit-any

  // If no services are configured, get all services (or show empty state)
  let services: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (serviceIds.length > 0) {
    services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      include: {
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
                status: { in: ['OPEN', 'ACKNOWLEDGED'] },
                visibility: 'PUBLIC',
              },
            },
          },
        },
        incidents: {
          where: {
            status: { in: ['OPEN', 'ACKNOWLEDGED'] },
            visibility: 'PUBLIC',
          },
          select: {
            urgency: true,
            status: true,
          },
        },
      },
    });
  } else {
    // If no services configured, show empty state (do not fetch all services)
    services = [];
  }

  // Calculate actual status based on active incidents
  // Get recent incidents (last 90 days) with events
  // Use all services if none configured, or specific service IDs
  const incidentServiceIds = serviceIds.length > 0 ? serviceIds : services.map(s => s.id);
  const recentIncidents = statusPage.showIncidents
    ? await prisma.incident.findMany({
        where: {
          serviceId: { in: incidentServiceIds },
          createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          visibility: 'PUBLIC',
        },
        include: {
          service: true,
          events: {
            orderBy: { createdAt: 'asc' },
            take: 50, // Get recent events for timeline
          },
          postmortem: {
            select: {
              id: true,
              status: true,
              isPublic: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
    : [];

  // Calculate uptime metrics for last 30 and 90 days
  const { calculateSLAMetrics, calculateMultiServiceUptime, getExternalStatusLabel } =
    await import('@/lib/sla-server');

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  ninetyDaysAgo.setUTCHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  thirtyDaysAgo.setUTCHours(0, 0, 0, 0);
  const serviceIdsForSLA = statusPage.services.map((sp: any) => sp.serviceId);

  // Optimized: Single call to get metrics for all services
  const [uptime90, metrics] = await Promise.all([
    calculateMultiServiceUptime(serviceIdsForSLA, ninetyDaysAgo, now, 'PUBLIC'),
    calculateSLAMetrics({ serviceId: serviceIdsForSLA, visibility: 'PUBLIC' }),
  ]);

  const serviceStatusMap = new Map<string, string>();
  metrics.serviceMetrics.forEach((m: any) => {
    serviceStatusMap.set(m.id, getExternalStatusLabel(m.dynamicStatus));
  });

  // Re-map services to include SLA-derived status and incident counts
  services = statusPage.services.map((sp: any) => {
    const serviceMetric = metrics.serviceMetrics.find((m: any) => m.id === sp.serviceId);
    return {
      ...sp.service,
      status: serviceStatusMap.get(sp.serviceId) || sp.service.status,
      _count: {
        incidents: serviceMetric?.activeCount || 0,
      },
    };
  });

  // Get incidents for status history and uptime calculation
  const allIncidents = await prisma.incident.findMany({
    where: {
      serviceId: { in: incidentServiceIds },
      visibility: 'PUBLIC',
      OR: [
        { createdAt: { gte: ninetyDaysAgo } },
        { resolvedAt: { gte: ninetyDaysAgo } },
        { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      ],
    },
    select: {
      id: true,
      serviceId: true,
      createdAt: true,
      resolvedAt: true,
      status: true,
      urgency: true,
    },
  });

  const activeIncidents = allIncidents.filter(
    (
      inc: any // eslint-disable-line @typescript-eslint/no-explicit-any
    ) => inc.status !== 'RESOLVED' && inc.status !== 'SNOOZED' && inc.status !== 'SUPPRESSED'
  );
  const hasOutage = activeIncidents.some((inc: any) => inc.urgency === 'HIGH'); // eslint-disable-line @typescript-eslint/no-explicit-any
  const hasDegraded = activeIncidents.some(
    (inc: any) => inc.urgency === 'MEDIUM' || inc.urgency === 'LOW'
  );
  const overallStatus = hasOutage ? 'outage' : hasDegraded ? 'degraded' : 'operational';
  const affectedServices = services.filter(
    service => service.status && service.status !== 'OPERATIONAL'
  ).length;
  const activeIncidentCount = activeIncidents.length;
  const statusSummary =
    overallStatus === 'outage'
      ? { label: 'Major Outage', color: '#be123c', background: '#fef2f2', border: '#fecaca' }
      : overallStatus === 'degraded'
        ? {
            label: 'Degraded Performance',
            color: '#d97706',
            background: '#fffbeb',
            border: '#fde68a',
          }
        : {
            label: 'All Systems Operational',
            color: '#059669',
            background: '#f0fdf4',
            border: '#d1fae5',
          };
  const lastUpdatedLabel = now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  const serviceUptime90 = uptime90;
  const incidentsForHistory = allIncidents.map(incident => ({
    serviceId: incident.serviceId,
    createdAt: incident.createdAt.toISOString(),
    resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
    status: incident.status,
    urgency: incident.urgency,
  }));

  const normalizeAffectedServiceIds = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    return value.map(id => (typeof id === 'string' ? id.trim() : '')).filter(Boolean);
  };

  const serviceLookup = new Map(services.map(service => [service.id, service] as const));
  const announcementsWithServices = statusPage.announcements.map((announcement: any) => {
    const affectedServiceIds = normalizeAffectedServiceIds(announcement.affectedServiceIds).filter(
      id => serviceLookup.has(id)
    );
    const affectedServices = affectedServiceIds
      .map(serviceId => {
        const service = serviceLookup.get(serviceId);
        if (!service) return null;
        return {
          id: service.id,
          name: service.name,
          region: service.region ?? null,
        };
      })
      .filter(Boolean);
    return {
      ...announcement,
      affectedServiceIds,
      affectedServices,
    };
  });

  const activeMaintenanceServiceIds = new Set<string>();
  announcementsWithServices.forEach((announcement: any) => {
    if (announcement.type !== 'MAINTENANCE' || !announcement.isActive) {
      return;
    }
    const startDate = new Date(announcement.startDate);
    const endDate = announcement.endDate ? new Date(announcement.endDate) : null;
    if (startDate > now) return;
    if (endDate && endDate < now) return;
    (announcement.affectedServiceIds || []).forEach((serviceId: string) =>
      activeMaintenanceServiceIds.add(serviceId)
    );
  });

  const normalizeRegions = (region?: string | null) => {
    if (!region) return [];
    return region
      .split(',')
      .map(entry => entry.trim())
      .filter(Boolean);
  };

  const regionSummaries = (() => {
    const severityRank: Record<string, number> = {
      OPERATIONAL: 0,
      MAINTENANCE: 1,
      DEGRADED: 2,
      PARTIAL_OUTAGE: 2,
      MAJOR_OUTAGE: 3,
    };
    const summaryMap = new Map<
      string,
      { total: number; impacted: number; maintenance: number; severity: number }
    >();

    services.forEach(service => {
      const regions = normalizeRegions(service.region);
      if (regions.length === 0) return;
      const status = service.status || 'OPERATIONAL';
      const impacted = status !== 'OPERATIONAL' && status !== 'MAINTENANCE';
      const isMaintenance = activeMaintenanceServiceIds.has(service.id) && status === 'OPERATIONAL';
      const severity = Math.max(
        severityRank[status] ?? 0,
        isMaintenance ? severityRank.MAINTENANCE : 0
      );

      regions.forEach(region => {
        const entry = summaryMap.get(region) || {
          total: 0,
          impacted: 0,
          maintenance: 0,
          severity: 0,
        };
        entry.total += 1;
        if (impacted) {
          entry.impacted += 1;
        }
        if (isMaintenance) {
          entry.maintenance += 1;
        }
        entry.severity = Math.max(entry.severity, severity);
        summaryMap.set(region, entry);
      });
    });

    const summaries = Array.from(summaryMap.entries()).map(([region, summary]) => ({
      region,
      ...summary,
    }));

    summaries.sort((a, b) => {
      if (a.impacted !== b.impacted) return b.impacted - a.impacted;
      return a.region.localeCompare(b.region);
    });

    return summaries;
  })();

  // Determine max width based on layout
  const maxWidth = layout === 'wide' ? '1600px' : layout === 'compact' ? '900px' : '1280px';

  // Structured data for SEO
  const baseUrl = getBaseUrl();
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: statusPage.name,
    description: branding.metaDescription || `Status page for ${statusPage.name}`,
    url: `${baseUrl}/status`,
    serviceStatus:
      overallStatus === 'operational'
        ? 'https://schema.org/ServiceAvailable'
        : overallStatus === 'degraded'
          ? 'https://schema.org/ServiceTemporarilyUnavailable'
          : 'https://schema.org/ServiceUnavailable',
    areaServed: 'Worldwide',
  };
  const contactUrlLabel = statusPage.contactUrl
    ? statusPage.contactUrl.replace(/^https?:\/\//, '')
    : null;

  return (
    <>
      {/* Structured Data (JSON-LD) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* Custom CSS */}
      {customCss && <style dangerouslySetInnerHTML={{ __html: customCss }} />}

      <StatusPageAutoRefresh enabled={autoRefresh} intervalSeconds={refreshInterval} />

      <div
        className="status-page-container"
        style={{
          minHeight: '100vh',
          background: backgroundColor,
        }}
      >
        {/* Header */}
        {showHeader && (
          <StatusPageHeader
            statusPage={statusPage}
            overallStatus={overallStatus}
            branding={branding}
            lastUpdated={now.toISOString()}
          />
        )}

        {/* Main Content */}
        <main
          style={{
            width: '100%',
            maxWidth: maxWidth,
            margin: '0 auto',
            padding: layout === 'compact' ? '1.5rem' : '2rem',
            paddingLeft: 'clamp(1rem, 4vw, 2rem)',
            paddingRight: 'clamp(1rem, 4vw, 2rem)',
            paddingTop: 'clamp(1.5rem, 4vw, 2rem)',
            paddingBottom: 'clamp(1.5rem, 4vw, 2rem)',
            boxSizing: 'border-box',
            ['--status-card-shadow' as any]: '0 6px 16px rgba(15, 23, 42, 0.05)', // eslint-disable-line @typescript-eslint/no-explicit-any
          }}
        >
          <section style={{ marginBottom: 'clamp(2rem, 6vw, 3rem)' }}>
            <div
              style={{
                display: 'grid',
                gap: '1rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                padding: 'clamp(1rem, 3vw, 1.5rem)',
                background: 'var(--status-panel-bg, #ffffff)',
                border: '1px solid var(--status-panel-border, #e2e8f0)',
                borderRadius: '0.875rem',
                boxShadow: '0 4px 12px rgba(15, 23, 42, 0.05)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--status-text-muted, #64748b)',
                    fontWeight: '600',
                  }}
                >
                  Overall Status
                </div>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.4rem 0.75rem',
                    borderRadius: '999px',
                    background: statusSummary.background,
                    color: statusSummary.color,
                    border: `1px solid ${statusSummary.border}`,
                    fontWeight: '700',
                    fontSize: '0.8125rem',
                  }}
                >
                  {statusSummary.label}
                </span>
                <div style={{ fontSize: '0.8125rem', color: 'var(--status-text-muted, #6b7280)' }}>
                  Last updated: {lastUpdatedLabel}
                </div>
              </div>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--status-text-muted, #64748b)',
                    fontWeight: '600',
                  }}
                >
                  Services
                </div>
                <div
                  style={{
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    color: 'var(--status-text, #111827)',
                  }}
                >
                  {services.length}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--status-text-muted, #6b7280)' }}>
                  {affectedServices} affected
                </div>
              </div>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div
                  style={{
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--status-text-muted, #64748b)',
                    fontWeight: '600',
                  }}
                >
                  Active Incidents
                </div>
                <div
                  style={{
                    fontSize: '1.5rem',
                    fontWeight: '700',
                    color: 'var(--status-text, #111827)',
                  }}
                >
                  {activeIncidentCount}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--status-text-muted, #6b7280)' }}>
                  Excludes snoozed/suppressed incidents.
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--status-text-muted, #6b7280)' }}>
                  Last 90 days: {recentIncidents.length}
                </div>
              </div>
            </div>
          </section>
          {statusPage.showRegionHeatmap &&
            statusPage.showServiceRegions !== false &&
            regionSummaries.length > 0 && (
              <section style={{ marginBottom: 'clamp(2rem, 6vw, 3rem)' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 'clamp(1rem, 3vw, 1.5rem)',
                    flexWrap: 'wrap',
                    gap: '1rem',
                  }}
                >
                  <div>
                    <h2
                      style={{
                        fontSize: 'clamp(1.5rem, 4vw, 1.875rem)',
                        fontWeight: '800',
                        color: 'var(--status-text-strong, #0f172a)',
                        margin: 0,
                        marginBottom: '0.25rem',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      Regions
                    </h2>
                    <p
                      style={{
                        fontSize: 'clamp(0.8125rem, 2vw, 0.875rem)',
                        color: 'var(--status-text-muted, #64748b)',
                        margin: 0,
                      }}
                    >
                      Service health by hosting region
                    </p>
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gap: '1rem',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  }}
                >
                  {regionSummaries.map(region => {
                    const severityStyle =
                      region.severity >= 3
                        ? {
                            label: 'Outage',
                            color: '#be123c',
                            background: '#fef2f2',
                            border: '#fecaca',
                          }
                        : region.severity >= 2
                          ? {
                              label: 'Degraded',
                              color: '#d97706',
                              background: '#fffbeb',
                              border: '#fde68a',
                            }
                          : region.severity >= 1
                            ? {
                                label: 'Maintenance',
                                color: 'var(--status-primary, #3b82f6)',
                                background: 'rgba(59, 130, 246, 0.05)',
                                border: 'rgba(59, 130, 246, 0.2)',
                              }
                            : {
                                label: 'Operational',
                                color: '#059669',
                                background: '#f0fdf4',
                                border: '#d1fae5',
                              };
                    const secondaryCounts =
                      region.maintenance > 0 && region.impacted === 0
                        ? `${region.maintenance} maintenance`
                        : region.maintenance > 0
                          ? `${region.impacted} impacted � ${region.maintenance} maintenance`
                          : `${region.impacted} impacted`;
                    return (
                      <div
                        key={region.region}
                        style={{
                          padding: '1rem 1.25rem',
                          background: 'var(--status-panel-bg, #ffffff)',
                          border: '1px solid var(--status-panel-border, #e5e7eb)',
                          borderRadius: '0.875rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.6rem',
                          boxShadow: 'var(--status-card-shadow, 0 6px 16px rgba(15, 23, 42, 0.05))',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.75rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '1rem',
                              fontWeight: '700',
                              color: 'var(--status-text, #111827)',
                            }}
                          >
                            {region.region}
                          </div>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              padding: '0.25rem 0.6rem',
                              borderRadius: '999px',
                              background: severityStyle.background,
                              color: severityStyle.color,
                              border: `1px solid ${severityStyle.border}`,
                              fontSize: '0.7rem',
                              fontWeight: '700',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            {severityStyle.label}
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            fontSize: '0.8125rem',
                            color: 'var(--status-text-muted, #64748b)',
                          }}
                        >
                          <span>
                            {region.total} service{region.total !== 1 ? 's' : ''}
                          </span>
                          <span>�</span>
                          <span>{secondaryCounts}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

          {statusPage.showChangelog &&
            announcementsWithServices.some((item: any) => item.type === 'UPDATE') && ( // eslint-disable-line @typescript-eslint/no-explicit-any
              <section style={{ marginBottom: 'clamp(2rem, 6vw, 4rem)' }}>
                <div style={{ marginBottom: 'clamp(1rem, 3vw, 1.5rem)' }}>
                  <h2
                    style={{
                      fontSize: 'clamp(1.5rem, 4vw, 1.875rem)',
                      fontWeight: '800',
                      marginBottom: '0.25rem',
                      color: 'var(--status-text-strong, #0f172a)',
                      letterSpacing: '-0.02em',
                    }}
                  >
                    Recent Updates
                  </h2>
                  <p
                    style={{
                      fontSize: 'clamp(0.8125rem, 2vw, 0.875rem)',
                      color: 'var(--status-text-muted, #64748b)',
                      margin: 0,
                    }}
                  >
                    Release notes and service improvements
                  </p>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'clamp(0.75rem, 2vw, 1rem)',
                  }}
                >
                  {announcementsWithServices
                    .filter((item: any) => item.type === 'UPDATE') // eslint-disable-line @typescript-eslint/no-explicit-any
                    .slice(0, 6)
                    .map(
                      (
                        update: any // eslint-disable-line @typescript-eslint/no-explicit-any
                      ) => (
                        <div
                          key={update.id}
                          style={{
                            padding: 'clamp(1rem, 3vw, 1.25rem)',
                            background: 'var(--status-panel-bg, #ffffff)',
                            border: '1px solid var(--status-panel-border, #e5e7eb)',
                            borderRadius: '0.875rem',
                            boxShadow:
                              'var(--status-card-shadow, 0 4px 12px rgba(15, 23, 42, 0.05))',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '1rem',
                              flexWrap: 'wrap',
                              marginBottom: '0.5rem',
                            }}
                          >
                            <div
                              style={{ fontWeight: '700', color: 'var(--status-text, #111827)' }}
                            >
                              {update.title}
                            </div>
                            <div
                              style={{
                                fontSize: '0.8rem',
                                color: 'var(--status-text-muted, #6b7280)',
                              }}
                            >
                              {new Date(update.startDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: '0.9rem',
                              color: 'var(--status-text-muted, #4b5563)',
                              whiteSpace: 'pre-wrap',
                            }}
                          >
                            {update.message}
                          </div>
                        </div>
                      )
                    )}
                </div>
              </section>
            )}

          {/* Announcements */}
          {announcementsWithServices.length > 0 && (
            <StatusPageAnnouncements
              announcements={announcementsWithServices}
              showServiceRegions={statusPage.showServiceRegions !== false}
            />
          )}

          {/* Services */}
          {statusPage.showServices && (
            <>
              {services.length > 0 ? (
                <StatusPageServices
                  services={services}
                  statusPageServices={statusPage.services}
                  uptime90={serviceUptime90}
                  incidents={incidentsForHistory}
                  privacySettings={{
                    showServiceMetrics: statusPage.showServiceMetrics !== false,
                    showServiceDescriptions: statusPage.showServiceDescriptions !== false,
                    showServiceRegions: statusPage.showServiceRegions !== false,
                    showUptimeHistory: statusPage.showUptimeHistory !== false,
                    showTeamInformation: statusPage.showTeamInformation === true,
                  }}
                  groupByRegionDefault={statusPage.showServicesByRegion}
                  showServiceOwners={statusPage.showServiceOwners === true}
                  showServiceSlaTier={statusPage.showServiceSlaTier === true}
                />
              ) : (
                <section style={{ marginBottom: '3rem' }}>
                  <h2
                    style={{
                      fontSize: '1.5rem',
                      fontWeight: '700',
                      marginBottom: '1.5rem',
                      color: textColor,
                    }}
                  >
                    Services
                  </h2>
                  <div
                    style={{
                      padding: '3rem',
                      background: backgroundColor,
                      border: '1px solid var(--status-panel-border, #e5e7eb)',
                      borderRadius: '0.75rem',
                      textAlign: 'center',
                      color: 'var(--status-text-muted, #6b7280)',
                    }}
                  >
                    <p>No services configured for this status page.</p>
                    <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                      Configure services in the status page settings.
                    </p>
                  </div>
                </section>
              )}
            </>
          )}

          {/* Metrics */}
          {statusPage.showMetrics && services.length > 0 && (
            <StatusPageMetrics
              services={services.map(s => ({ id: s.id, name: s.name }))}
              incidents={allIncidents.map(inc => ({
                id: inc.id,
                serviceId: inc.serviceId,
                createdAt: inc.createdAt,
                resolvedAt: inc.resolvedAt,
                status: inc.status,
                urgency: inc.urgency,
              }))}
              thirtyDaysAgo={thirtyDaysAgo}
              ninetyDaysAgo={ninetyDaysAgo}
              uptimeExcellentThreshold={statusPage.uptimeExcellentThreshold ?? 99.9}
              uptimeGoodThreshold={statusPage.uptimeGoodThreshold ?? 99.0}
            />
          )}

          {/* Recent Incidents */}
          {statusPage.showIncidents && (
            <>
              {recentIncidents.length > 0 ? (
                <div id="incidents">
                  <StatusPageIncidents
                    incidents={recentIncidents}
                    privacySettings={{
                      showIncidentTitles: statusPage.showIncidentTitles !== false,
                      showIncidentDescriptions: statusPage.showIncidentDescriptions !== false,
                      showAffectedServices: statusPage.showAffectedServices !== false,
                      showServiceRegions: statusPage.showServiceRegions !== false,
                      showIncidentTimestamps: statusPage.showIncidentTimestamps !== false,
                      showIncidentUrgency: statusPage.showIncidentUrgency !== false,
                      showIncidentDetails: statusPage.showIncidentDetails !== false,
                    }}
                    showPostIncidentReview={statusPage.showPostIncidentReview === true}
                  />
                </div>
              ) : (
                <section style={{ marginBottom: '3rem' }}>
                  <h2
                    style={{
                      fontSize: '1.5rem',
                      fontWeight: '700',
                      marginBottom: '1.5rem',
                      color: textColor,
                    }}
                  >
                    Recent Incidents
                    {metrics.isClipped && (
                      <span
                        style={{
                          fontSize: '0.875rem',
                          fontWeight: '400',
                          marginLeft: '0.75rem',
                          color: 'var(--status-text-muted, #6b7280)',
                          verticalAlign: 'middle',
                        }}
                      >
                        (retention limit: {metrics.retentionDays} days)
                      </span>
                    )}
                  </h2>
                  <div
                    style={{
                      padding: '3rem',
                      background: backgroundColor,
                      border: '1px solid var(--status-panel-border, #e5e7eb)',
                      borderRadius: '0.75rem',
                      textAlign: 'center',
                      color: 'var(--status-text-muted, #6b7280)',
                    }}
                  >
                    <p>No incidents in the last {metrics.retentionDays} days.</p>
                    <p style={{ fontSize: '0.875rem', marginTop: '0.5rem', color: '#10b981' }}>
                      All systems operational
                    </p>
                  </div>
                </section>
              )}
            </>
          )}

          {showSubscribe && (
            <>
              {/* Subscription */}
              <section style={{ marginBottom: 'clamp(2.5rem, 7vw, 5rem)' }}>
                <div
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    borderRadius: '0.875rem',
                    border: '1px solid var(--status-panel-border, #e5e7eb)',
                    borderTop: '3px solid var(--status-primary, var(--primary-color))',
                    background: 'var(--status-panel-bg, #ffffff)',
                    padding: 'clamp(1.5rem, 4vw, 2.5rem)',
                    boxShadow: 'var(--status-card-shadow, 0 6px 16px rgba(15, 23, 42, 0.05))',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '-60px',
                      right: '-60px',
                      width: '180px',
                      height: '180px',
                      background:
                        'radial-gradient(circle, rgba(148, 163, 184, 0.14) 0%, transparent 70%)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '-80px',
                      left: '-80px',
                      width: '220px',
                      height: '220px',
                      background:
                        'radial-gradient(circle, rgba(148, 163, 184, 0.12) 0%, transparent 70%)',
                      pointerEvents: 'none',
                    }}
                  />
                  <div
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'clamp(1.5rem, 4vw, 2.5rem)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div
                      style={{
                        flex: '1 1 260px',
                        minWidth: '240px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.75rem',
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          color: 'var(--status-primary, var(--primary-color))',
                          fontWeight: '700',
                          marginBottom: '0.5rem',
                        }}
                      >
                        Stay in the loop
                      </div>
                      <h2
                        style={{
                          fontSize: 'clamp(1.35rem, 3vw, 1.75rem)',
                          fontWeight: '700',
                          marginBottom: '0.75rem',
                          color: textColor,
                        }}
                      >
                        Subscribe to Updates
                      </h2>
                      <p
                        style={{
                          fontSize: 'clamp(0.9rem, 2.2vw, 1rem)',
                          color: 'var(--status-text-muted, #4b5563)',
                          marginBottom: '1rem',
                          lineHeight: 1.6,
                        }}
                      >
                        Get incident alerts, maintenance notices, and recovery updates the moment
                        they happen.
                      </p>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.35rem 0.75rem',
                          borderRadius: '999px',
                          background: 'var(--status-panel-bg, #ffffff)',
                          border: '1px solid var(--status-panel-border, #e5e7eb)',
                          color: 'var(--status-text, #374151)',
                          fontSize: '0.8125rem',
                          fontWeight: '600',
                        }}
                      >
                        Email notifications only
                      </div>
                    </div>
                    <div
                      style={{
                        flex: '1 1 320px',
                        minWidth: '280px',
                      }}
                    >
                      <div
                        style={{
                          padding: 'clamp(1rem, 3vw, 1.5rem)',
                          background: 'var(--status-panel-bg, #ffffff)',
                          border: '1px solid var(--status-panel-border, #e5e7eb)',
                          borderRadius: '0.875rem',
                          boxShadow: '0 12px 25px rgba(15, 23, 42, 0.12)',
                        }}
                      >
                        <StatusPageSubscribe statusPageId={statusPage.id} />
                      </div>
                      <p
                        style={{
                          marginTop: '0.75rem',
                          fontSize: '0.8125rem',
                          color: 'var(--status-text-muted, #6b7280)',
                          textAlign: 'center',
                        }}
                      >
                        We'll never share your email. Unsubscribe anytime.
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
          {/* Footer */}
          {showFooter && (statusPage.footerText || showRssLink || showApiLink) && (
            <footer
              style={{
                marginTop: '4rem',
                color: 'var(--status-text-muted, #6b7280)',
                fontSize: '0.9rem',
              }}
            >
              <div
                style={{
                  padding: '1rem 0',
                  borderTop: '1px solid var(--status-panel-border, #e5e7eb)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  textAlign: 'center',
                  flexDirection: 'column',
                }}
              >
                <div
                  style={{
                    width: '56px',
                    height: '2px',
                    borderRadius: '999px',
                    background: 'var(--status-primary, var(--primary-color))',
                    opacity: 0.6,
                  }}
                />
                {statusPage.footerText && (
                  <p
                    style={{
                      margin: 0,
                      color: 'var(--status-text-muted, #6b7280)',
                      fontWeight: '600',
                    }}
                  >
                    {statusPage.footerText}
                  </p>
                )}
                {(statusPage.contactEmail || statusPage.contactUrl) && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      fontSize: '0.8125rem',
                      color: 'var(--status-text-muted, #6b7280)',
                      fontWeight: '600',
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                    }}
                  >
                    {statusPage.contactEmail && (
                      <a
                        href={`mailto:${statusPage.contactEmail}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.2rem 0.4rem',
                          borderRadius: '6px',
                          color: 'var(--status-text, #111827)',
                          textDecoration: 'none',
                          fontWeight: '600',
                        }}
                        aria-label={`Email ${statusPage.contactEmail}`}
                      >
                        <Mail size={14} />
                        {statusPage.contactEmail}
                      </a>
                    )}
                    {statusPage.contactUrl && (
                      <a
                        href={statusPage.contactUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          padding: '0.2rem 0.4rem',
                          borderRadius: '6px',
                          color: 'var(--status-text, #111827)',
                          textDecoration: 'none',
                          fontWeight: '600',
                        }}
                        aria-label={`Open ${contactUrlLabel || statusPage.contactUrl}`}
                      >
                        <Globe size={14} />
                        {contactUrlLabel || statusPage.contactUrl}
                      </a>
                    )}
                  </div>
                )}
                {(showRssLink || showApiLink) && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                    }}
                  >
                    {showRssLink && (
                      <a
                        href="/api/status/rss"
                        className="status-footer-link"
                        style={{
                          color: 'var(--status-text-muted, #6b7280)',
                          textDecoration: 'none',
                          fontWeight: '600',
                        }}
                      >
                        RSS Feed
                      </a>
                    )}
                    {showRssLink && showApiLink && (
                      <span style={{ color: 'var(--status-text-subtle, #94a3b8)' }}>�</span>
                    )}
                    {showApiLink && (
                      <a
                        href="/api/status"
                        className="status-footer-link"
                        style={{
                          color: 'var(--status-text-muted, #6b7280)',
                          textDecoration: 'none',
                          fontWeight: '600',
                        }}
                      >
                        JSON API
                      </a>
                    )}
                    {showUptimeExports && (
                      <>
                        {(showRssLink || showApiLink) && (
                          <span style={{ color: 'var(--status-text-subtle, #94a3b8)' }}>�</span>
                        )}
                        <a
                          href="/api/status/uptime-export?format=csv"
                          className="status-footer-link"
                          style={{
                            color: 'var(--status-text-muted, #6b7280)',
                            textDecoration: 'none',
                            fontWeight: '600',
                          }}
                        >
                          Uptime CSV
                        </a>
                        <a
                          href="/api/status/uptime-export?format=pdf"
                          className="status-footer-link"
                          style={{
                            color: 'var(--status-text-muted, #6b7280)',
                            textDecoration: 'none',
                            fontWeight: '600',
                          }}
                        >
                          Uptime PDF
                        </a>
                      </>
                    )}
                  </div>
                )}
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.8125rem',
                    color: 'var(--status-text-subtle, #94a3b8)',
                    fontWeight: '600',
                    letterSpacing: '0.02em',
                    textDecoration: 'none',
                  }}
                  aria-label="OpsKnight GitHub Repository"
                >
                  <span
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '4px',
                      background: 'var(--status-panel-muted-bg, #f8fafc)',
                      border: '1px solid var(--status-panel-border, #e5e7eb)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      src="/logo.svg"
                      alt="OpsKnight"
                      style={{ width: '16px', height: '16px', display: 'block' }}
                    />
                  </span>
                  Powered by{' '}
                  <strong style={{ fontWeight: '700', color: 'var(--status-text, #111827)' }}>
                    OpsKnight
                  </strong>
                </a>
              </div>
              <style
                dangerouslySetInnerHTML={{
                  __html: `
                                .status-footer-link:hover {
                                    text-decoration: underline;
                                    text-decoration-thickness: 2px;
                                    text-underline-offset: 3px;
                                }
                            `,
                }}
              />
            </footer>
          )}
        </main>
      </div>
    </>
  );
}
