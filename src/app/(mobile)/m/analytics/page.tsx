import Link from 'next/link';
import MobileCard from '@/components/mobile/MobileCard';
import {
  MobileProgressBar,
  MobileStatusBadge,
  MobileUrgencyBadge,
} from '@/components/mobile/MobileUtils';
import MobileTime from '@/components/mobile/MobileTime';

export const dynamic = 'force-dynamic';

export default async function MobileAnalyticsPage() {
  const { calculateSLAMetrics } = await import('@/lib/sla-server');
  const metricsWindowDays = 90;
  const lastUpdated = new Date();
  const slaMetrics = await calculateSLAMetrics({
    windowDays: metricsWindowDays,
    includeAllTime: false,
    includeIncidents: true,
    incidentLimit: 15,
  });

  const dayMs = 24 * 60 * 60 * 1000;
  const effectiveWindowDays = Math.max(
    1,
    Math.ceil((slaMetrics.effectiveEnd.getTime() - slaMetrics.effectiveStart.getTime()) / dayMs)
  );
  const windowLabelDays = slaMetrics.isClipped ? effectiveWindowDays : metricsWindowDays;
  const windowLabelSuffix = slaMetrics.isClipped ? ' (retention limit)' : '';

  const activeIncidents = slaMetrics.activeIncidents;
  const incidentsInRange = slaMetrics.totalIncidents;
  const mtta = slaMetrics.mttd ?? null;
  const mttr = slaMetrics.mttr ?? null;
  const ackCompliance = slaMetrics.ackCompliance ?? null;
  const resolveCompliance = slaMetrics.resolveCompliance ?? null;

  const urgencyRows = [
    { label: 'High', value: slaMetrics.highUrgencyCount, tone: 'danger' as const },
    { label: 'Medium', value: slaMetrics.mediumUrgencyCount, tone: 'warning' as const },
    { label: 'Low', value: slaMetrics.lowUrgencyCount, tone: 'success' as const },
  ];
  const urgencyMax = Math.max(1, ...urgencyRows.map(row => row.value));

  const trendSeries = slaMetrics.trendSeries.slice(-7);
  const trendMax = Math.max(1, ...trendSeries.map(point => point.count));

  const topServices = slaMetrics.topServices.slice(0, 5);
  const assigneeLoad = slaMetrics.assigneeLoad.slice(0, 5);
  const onCallLoad = slaMetrics.onCallLoad.slice(0, 5);
  const recentIncidents = (slaMetrics.recentIncidents || []).slice(0, 8);

  const formatDuration = (minutes: number | null) => {
    if (!minutes || minutes <= 0) return '--';
    const mins = Math.round(minutes);
    if (mins < 60) return `${mins}m`;
    const hours = (mins / 60).toFixed(1);
    return `${hours}h`;
  };

  const formatPercent = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return '--';
    return `${Math.round(value)}%`;
  };

  const formatHours = (ms: number) => {
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = ms / 3600000;
    return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`;
  };

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[color:var(--text-primary)]">
          Analytics
        </h1>
        <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">
          Last {windowLabelDays} days{windowLabelSuffix}
        </p>
        <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">
          Last updated <MobileTime value={lastUpdated} format="time" />
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MobileCard className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-500 to-rose-500" />
          <div className="text-2xl font-bold text-[color:var(--text-primary)]">
            {activeIncidents}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            Active Incidents
          </div>
        </MobileCard>
        <MobileCard className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <div className="text-2xl font-bold text-[color:var(--text-primary)]">
            {incidentsInRange}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            New ({windowLabelDays}d)
          </div>
        </MobileCard>
        <MobileCard className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
          <div className="text-2xl font-bold text-[color:var(--text-primary)]">
            {formatDuration(mtta)}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            MTTA
          </div>
        </MobileCard>
        <MobileCard className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-500 to-green-500" />
          <div className="text-2xl font-bold text-[color:var(--text-primary)]">
            {formatDuration(mttr)}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
            MTTR
          </div>
        </MobileCard>
      </div>

      <MobileCard className="space-y-3">
        <div>
          <div className="text-sm font-semibold text-[color:var(--text-primary)]">
            SLA Compliance
          </div>
          <div className="text-[11px] text-[color:var(--text-muted)]">
            Targets met within the last {windowLabelDays} days{windowLabelSuffix}.
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-[color:var(--text-secondary)]">
              <span>Acknowledge SLA</span>
              <span>{formatPercent(ackCompliance)}</span>
            </div>
            <MobileProgressBar value={ackCompliance ?? 0} max={100} variant="primary" />
            <div className="mt-1 text-[11px] text-[color:var(--text-muted)]">
              Breaches: {slaMetrics.ackBreaches}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs font-semibold text-[color:var(--text-secondary)]">
              <span>Resolve SLA</span>
              <span>{formatPercent(resolveCompliance)}</span>
            </div>
            <MobileProgressBar value={resolveCompliance ?? 0} max={100} variant="success" />
            <div className="mt-1 text-[11px] text-[color:var(--text-muted)]">
              Breaches: {slaMetrics.resolveBreaches}
            </div>
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-3">
        <div className="text-sm font-semibold text-[color:var(--text-primary)]">Urgency Mix</div>
        <div className="space-y-3">
          {urgencyRows.map(row => (
            <div key={row.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
                <span>{row.label}</span>
                <span className="font-semibold">{row.value}</span>
              </div>
              <MobileProgressBar
                value={row.value}
                max={urgencyMax}
                variant={
                  row.tone === 'danger' ? 'danger' : row.tone === 'warning' ? 'warning' : 'success'
                }
              />
            </div>
          ))}
        </div>
      </MobileCard>

      <MobileCard className="space-y-3">
        <div className="text-sm font-semibold text-[color:var(--text-primary)]">Last 7 Days</div>
        <div className="space-y-3">
          {trendSeries.map(point => (
            <div key={point.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
                <span>{point.label}</span>
                <span className="font-semibold">{point.count}</span>
              </div>
              <MobileProgressBar value={point.count} max={trendMax} variant="primary" />
              <div className="text-[10px] text-[color:var(--text-muted)]">
                MTTA {formatDuration(point.mtta)} • MTTR {formatDuration(point.mttr)}
              </div>
            </div>
          ))}
        </div>
      </MobileCard>

      <MobileCard className="space-y-3">
        <div className="text-sm font-semibold text-[color:var(--text-primary)]">Top Services</div>
        {topServices.length === 0 ? (
          <div className="text-xs text-[color:var(--text-muted)]">No service data yet.</div>
        ) : (
          <div className="space-y-2">
            {topServices.map(service => (
              <div key={service.id} className="flex items-center justify-between text-xs">
                <span className="truncate text-[color:var(--text-secondary)]">{service.name}</span>
                <span className="font-semibold text-[color:var(--text-primary)]">
                  {service.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileCard>

      <MobileCard className="space-y-3">
        <div className="text-sm font-semibold text-[color:var(--text-primary)]">On-call Load</div>
        {onCallLoad.length === 0 ? (
          <div className="text-xs text-[color:var(--text-muted)]">No on-call data yet.</div>
        ) : (
          <div className="space-y-2">
            {onCallLoad.map(item => (
              <div key={item.id} className="flex items-center justify-between text-xs">
                <span className="truncate text-[color:var(--text-secondary)]">{item.name}</span>
                <span className="font-semibold text-[color:var(--text-primary)]">
                  {formatHours(item.hoursMs)} • {item.incidentCount} inc.
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileCard>

      <MobileCard className="space-y-3">
        <div className="text-sm font-semibold text-[color:var(--text-primary)]">Assignee Load</div>
        {assigneeLoad.length === 0 ? (
          <div className="text-xs text-[color:var(--text-muted)]">No assignee data yet.</div>
        ) : (
          <div className="space-y-2">
            {assigneeLoad.map(item => (
              <div key={item.id} className="flex items-center justify-between text-xs">
                <span className="truncate text-[color:var(--text-secondary)]">{item.name}</span>
                <span className="font-semibold text-[color:var(--text-primary)]">
                  {item.count} inc.
                </span>
              </div>
            ))}
          </div>
        )}
      </MobileCard>

      <MobileCard className="space-y-3">
        <div className="text-sm font-semibold text-[color:var(--text-primary)]">
          Recent Incidents
        </div>
        {recentIncidents.length === 0 ? (
          <div className="text-xs text-[color:var(--text-muted)]">No incidents found.</div>
        ) : (
          <div className="space-y-3">
            {recentIncidents.map(incident => (
              <Link
                key={incident.id}
                href={`/m/incidents/${incident.id}`}
                className="flex flex-col gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] px-3 py-2 text-left text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-[color:var(--text-primary)]">
                    {incident.title}
                  </span>
                  <MobileStatusBadge status={incident.status.toLowerCase() as any} size="sm" />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[color:var(--text-muted)]">
                  <span className="truncate">{incident.service.name}</span>
                  {incident.urgency && (
                    <MobileUrgencyBadge urgency={incident.urgency.toLowerCase() as any} size="sm" />
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </MobileCard>

      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg-secondary)] p-4 text-xs text-[color:var(--text-secondary)]">
        Metrics are calculated based on the last {windowLabelDays} days of activity.
        {slaMetrics.isClipped ? ' Data is limited by retention settings.' : ''} For detailed reports
        and custom ranges, please use the desktop dashboard.
      </div>
    </div>
  );
}
