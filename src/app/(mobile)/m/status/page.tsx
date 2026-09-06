import prisma from '@/lib/prisma';
import MobileCard from '@/components/mobile/MobileCard';
import Link from 'next/link';
import MobileTime from '@/components/mobile/MobileTime';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';

export const dynamic = 'force-dynamic';

type ServiceStatus = {
  id: string;
  name: string;
  status: string;
  incidentCount: number;
};

type ActiveIncident = {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  createdAt: Date;
  updatedAt: Date;
};

type Announcement = {
  id: string;
  title: string;
  type: string;
  message: string;
  startDate: Date;
  endDate: Date | null;
};

export default async function MobileStatusPage() {
  const now = new Date();
  const metricsWindowDays = 90;
  const actor = await getCurrentAuthorizationActor();

  // Get status page config
  // Get status page config (optional for internal view)
  const statusPage = await prisma.statusPage.findFirst({
    where: { enabled: true },
    include: {
      announcements: {
        where: {
          isActive: true,
          OR: [{ endDate: null }, { endDate: { gte: now } }],
        },
        orderBy: { startDate: 'desc' },
        take: 5,
      },
    },
  });

  // Fetch ALL services for internal dashboard view
  const services = await prisma.service.findMany({
    where: serviceReadWhere(actor),
    orderBy: { name: 'asc' },
    select: { id: true, name: true, targetAckMinutes: true, targetResolveMinutes: true },
  });

  // Verify active incidents directly to ensure status accuracy
  const activeIncidentCounts = await prisma.incident.groupBy({
    by: ['serviceId', 'urgency'],
    where: {
      AND: [incidentReadWhere(actor), { status: { in: activeIncidentStatuses() } }],
    },
    _count: { id: true },
  });

  const verifiedCounts = new Map<string, { active: number; critical: number }>();
  for (const group of activeIncidentCounts) {
    const current = verifiedCounts.get(group.serviceId) || { active: 0, critical: 0 };
    current.active += group._count.id;
    if (group.urgency === 'HIGH') current.critical += group._count.id;
    verifiedCounts.set(group.serviceId, current);
  }

  const [{ calculateActorSLAMetrics }, { getExternalStatusLabel }] = await Promise.all([
    import('@/lib/actor-metrics'),
    import('@/lib/sla-server'),
  ]);
  const { getServiceDynamicStatus } = await import('@/lib/service-status');

  // Use all services for metrics
  const serviceIds = services.map(s => s.id);
  const metrics = await calculateActorSLAMetrics(actor, {
    serviceId: serviceIds,
    windowDays: metricsWindowDays,
    includeActiveIncidents: true,
    includeIncidents: true,
    incidentLimit: 50,
    visibility: 'ALL',
  });

  const dayMs = 24 * 60 * 60 * 1000;
  const effectiveWindowDays = Math.max(
    1,
    Math.ceil((metrics.effectiveEnd.getTime() - metrics.effectiveStart.getTime()) / dayMs)
  );
  const windowLabelDays = metrics.isClipped ? effectiveWindowDays : metricsWindowDays;
  const windowLabelSuffix = metrics.isClipped ? ' (retention limit)' : '';

  const serviceStatuses: ServiceStatus[] = services.map(service => {
    const serviceMetric = metrics.serviceMetrics.find(m => m.id === service.id);
    const verified = verifiedCounts.get(service.id) || { active: 0, critical: 0 };

    // Use the higher count between direct DB query and SLA metrics (safety net)
    const activeCount = Math.max(serviceMetric?.activeCount || 0, verified.active);
    const criticalCount = Math.max(serviceMetric?.criticalCount || 0, verified.critical);

    // Recalculate status based on verified counts
    const dynamicStatus = getServiceDynamicStatus({
      activeIncidentCount: activeCount,
      hasCritical: criticalCount > 0,
    });

    return {
      id: service.id,
      name: service.name,
      status: getExternalStatusLabel(dynamicStatus),
      incidentCount: activeCount,
    };
  });

  const operationalCount = serviceStatuses.filter(s => s.status === 'OPERATIONAL').length;
  const degradedCount = serviceStatuses.filter(s => s.status === 'PARTIAL_OUTAGE').length;
  const majorCount = serviceStatuses.filter(s => s.status === 'MAJOR_OUTAGE').length;
  const totalServices = serviceStatuses.length;

  // Overall status from aggregate metrics
  const overallStatus = getExternalStatusLabel(metrics.dynamicStatus);

  // Get active incidents with details
  const activeIncidents: ActiveIncident[] = (metrics.activeIncidentSummaries || [])
    .filter(incident => serviceIds.includes(incident.serviceId))
    .slice(0, 10)
    .map(incident => ({
      id: incident.id,
      title: incident.title,
      status: incident.status,
      urgency: incident.urgency ?? 'LOW',
      serviceName: incident.serviceName,
      createdAt: incident.createdAt,
      updatedAt: incident.createdAt,
    }));

  // Get recent resolved incidents (history)
  const recentHistory = (metrics.recentIncidents || [])
    .filter(
      incident =>
        incident.status === 'RESOLVED' &&
        incident.resolvedAt &&
        serviceIds.includes(incident.service.id)
    )
    .sort(
      (a, b) => new Date(b.resolvedAt as Date).getTime() - new Date(a.resolvedAt as Date).getTime()
    )
    .slice(0, 10);

  // Announcements
  const announcements: Announcement[] =
    statusPage?.announcements.map(a => ({
      id: a.id,
      title: a.title,
      type: a.type,
      message: a.message,
      startDate: a.startDate,
      endDate: a.endDate,
    })) || [];

  const getStatusTone = (status: string) => {
    switch (status) {
      case 'OPERATIONAL':
        return {
          border: 'border-emerald-500',
          bg: 'bg-emerald-50/70 dark:bg-emerald-950/40',
          text: 'text-emerald-700 dark:text-emerald-300',
          dot: 'bg-emerald-500',
        };
      case 'PARTIAL_OUTAGE':
        return {
          border: 'border-amber-500',
          bg: 'bg-amber-50/70 dark:bg-amber-950/40',
          text: 'text-amber-700 dark:text-amber-300',
          dot: 'bg-amber-500',
        };
      case 'MAJOR_OUTAGE':
        return {
          border: 'border-red-500',
          bg: 'bg-red-50/70 dark:bg-red-950/40',
          text: 'text-red-700 dark:text-red-300',
          dot: 'bg-red-500',
        };
      default:
        return {
          border: 'border-slate-400',
          bg: 'bg-slate-50/70 dark:bg-slate-900/50',
          text: 'text-slate-600 dark:text-slate-400',
          dot: 'bg-slate-400',
        };
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'OPERATIONAL':
        return 'Operational';
      case 'PARTIAL_OUTAGE':
        return 'Partial Outage';
      case 'MAJOR_OUTAGE':
        return 'Major Outage';
      default:
        return 'Unknown';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'OPERATIONAL':
        return '✅';
      case 'PARTIAL_OUTAGE':
        return '⚠️';
      case 'MAJOR_OUTAGE':
        return '❌';
      default:
        return '❓';
    }
  };

  const getUrgencyBadge = (urgency: string) => {
    if (urgency === 'HIGH') {
      return {
        label: 'High',
        classes: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      };
    }
    if (urgency === 'MEDIUM') {
      return {
        label: 'Medium',
        classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
      };
    }
    return {
      label: 'Low',
      classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    };
  };

  const getAnnouncementIcon = (type: string) => {
    switch (type) {
      case 'MAINTENANCE':
        return '🔧';
      case 'INCIDENT':
        return '🚨';
      case 'INFO':
        return 'ℹ️';
      default:
        return '📢';
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      {/* Page Title */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
          {statusPage?.name || 'System Health'}
        </h1>
        <div className="mt-2 text-[11px] text-[color:var(--text-muted)]">
          Metrics reflect the last {windowLabelDays} days{windowLabelSuffix}.
        </div>
      </div>

      {/* Overall Status Banner */}
      <MobileCard
        className={`relative overflow-hidden border-l-4 ${getStatusTone(overallStatus).border} ${getStatusTone(overallStatus).bg}`}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              overallStatus === 'OPERATIONAL'
                ? 'radial-gradient(circle at 20% 20%, rgba(16, 185, 129, 0.25), transparent 60%)'
                : overallStatus === 'PARTIAL_OUTAGE'
                  ? 'radial-gradient(circle at 20% 20%, rgba(245, 158, 11, 0.25), transparent 60%)'
                  : 'radial-gradient(circle at 20% 20%, rgba(239, 68, 68, 0.25), transparent 60%)',
          }}
        />
        <div className="flex items-center gap-3">
          <div className="text-3xl">{getStatusIcon(overallStatus)}</div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-[color:var(--text-primary)]">
              {overallStatus === 'OPERATIONAL'
                ? 'All Systems Operational'
                : getStatusLabel(overallStatus)}
            </h2>
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">
              {activeIncidents.length === 0
                ? 'No active incidents'
                : `${activeIncidents.length} active incident${activeIncidents.length > 1 ? 's' : ''}`}
            </p>
            <p className="mt-1 text-[11px] text-[color:var(--text-muted)]" suppressHydrationWarning>
              Updated <MobileTime value={now} format="time" />
            </p>
          </div>
        </div>
      </MobileCard>

      {/* Status Overview */}
      <section className="grid grid-cols-2 gap-3">
        <MobileCard className="space-y-1">
          <div className="text-xs font-semibold text-[color:var(--text-muted)]">Services</div>
          <div className="text-2xl font-bold text-[color:var(--text-primary)]">{totalServices}</div>
          <div className="text-[11px] text-[color:var(--text-muted)]">
            {operationalCount} ok · {degradedCount} degraded · {majorCount} major
          </div>
        </MobileCard>
        <MobileCard className="space-y-1">
          <div className="text-xs font-semibold text-[color:var(--text-muted)]">
            Active Incidents
          </div>
          <div className="text-2xl font-bold text-[color:var(--text-primary)]">
            {metrics.activeCount}
          </div>
          <div className="text-[11px] text-[color:var(--text-muted)]">
            {metrics.criticalCount} critical · {metrics.resolved24h} resolved 24h
          </div>
        </MobileCard>
      </section>

      {/* Announcements */}
      {announcements.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            📢 Announcements
          </h3>
          <div className="flex flex-col gap-3">
            {announcements.map(announcement => {
              const tone =
                announcement.type === 'MAINTENANCE'
                  ? 'border-blue-400'
                  : announcement.type === 'INCIDENT'
                    ? 'border-red-400'
                    : 'border-slate-400';
              return (
                <MobileCard key={announcement.id} padding="sm" className={`border-l-4 ${tone}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-lg">{getAnnouncementIcon(announcement.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-[color:var(--text-primary)]">
                        {announcement.title}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-[color:var(--text-muted)]">
                        {announcement.message}
                      </p>
                      <div className="mt-2 text-[11px] text-[color:var(--text-muted)]">
                        <MobileTime value={announcement.startDate} format="date" />
                        {announcement.endDate && (
                          <>
                            {' '}
                            - <MobileTime value={announcement.endDate} format="date" />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </MobileCard>
              );
            })}
          </div>
        </section>
      )}

      {/* Active Incidents */}
      {activeIncidents.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            🚨 Active Incidents
          </h3>
          <div className="flex flex-col gap-3">
            {activeIncidents.map(incident => {
              const urgencyBadge = getUrgencyBadge(incident.urgency);
              const urgencyBorder =
                incident.urgency === 'HIGH'
                  ? 'border-red-400'
                  : incident.urgency === 'MEDIUM'
                    ? 'border-amber-400'
                    : 'border-emerald-400';
              return (
                <Link
                  key={incident.id}
                  href={`/m/incidents/${incident.id}`}
                  className="no-underline"
                >
                  <MobileCard padding="sm" className={`border-l-4 ${urgencyBorder}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                          {incident.title}
                        </div>
                        <div className="text-xs text-[color:var(--text-muted)]">
                          {incident.serviceName}
                        </div>
                        <div className="mt-1 text-[11px] text-[color:var(--text-muted)]">
                          <MobileTime value={incident.createdAt} format="relative-short" />
                        </div>
                      </div>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${urgencyBadge.classes}`}
                      >
                        {urgencyBadge.label}
                      </span>
                    </div>
                  </MobileCard>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Services */}
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
          🖥️ Services ({serviceStatuses.length})
        </h3>
        <div className="flex flex-col gap-2">
          {serviceStatuses.map(service => {
            const tone = getStatusTone(service.status);
            return (
              <MobileCard
                key={service.id}
                padding="sm"
                className="flex items-center justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                  <span className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                    {service.name}
                  </span>
                </div>
                <span className={`text-[11px] font-semibold ${tone.text}`}>
                  {getStatusLabel(service.status)}
                </span>
              </MobileCard>
            );
          })}
          {serviceStatuses.length === 0 && (
            <MobileCard padding="sm">
              <div className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">
                No services configured
              </div>
            </MobileCard>
          )}
        </div>
      </section>

      {/* Recent History */}
      {recentHistory.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            📜 Recent History ({windowLabelDays} days{windowLabelSuffix})
          </h3>
          <div className="flex flex-col gap-2">
            {recentHistory.map(incident => (
              <Link key={incident.id} href={`/m/incidents/${incident.id}`} className="no-underline">
                <MobileCard padding="sm" className="opacity-90">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[color:var(--text-primary)]">
                        {incident.title}
                      </div>
                      <div className="mt-1 text-[11px] text-[color:var(--text-muted)]">
                        {incident.service.name} • Resolved{' '}
                        <MobileTime value={incident.resolvedAt!} format="relative-short" />
                      </div>
                    </div>
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      Resolved
                    </span>
                  </div>
                </MobileCard>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] p-3 text-center text-[11px] text-[color:var(--text-muted)]">
        For deep analysis, use the Analytics page.
      </div>
    </div>
  );
}
