import { calculateSLAMetrics } from '@/lib/sla-server';
import { formatTimeMinutesMs } from '@/lib/time-format';
import { smoothSeries } from '@/lib/analytics-metrics';
import { formatDateTime } from '@/lib/timezone';
import { buildIncidentListHref } from '@/lib/incident-links';
import { INCIDENT_METRIC_DEFINITIONS, metricDefinitionTooltip } from '@/lib/metric-contract';
import { logger } from '@/lib/logger';
import MetricCard from '@/components/analytics/MetricCard';
import MetricIcon from '@/components/analytics/MetricIcon';
import GaugeChart from '@/components/analytics/GaugeChart';
import LineChart from '@/components/analytics/LineChart';
import { IncidentHeatmapWidget } from '@/components/dashboard/widgets/IncidentHeatmapWidget';
import ServiceHealthTable from '@/components/analytics/ServiceHealthTable';
import {
  Shield,
  CheckCircle,
  AlertCircle,
  Zap,
  Users,
  TrendingUp,
  Moon,
  Bell,
  Activity,
  Sparkles,
  LayoutDashboard,
  BarChart3,
  AlertTriangle,
  Clock,
} from 'lucide-react';

type AllowedStatus = 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'SUPPRESSED' | 'RESOLVED';
type AllowedUrgency = 'HIGH' | 'MEDIUM' | 'LOW';

interface Props {
  teamId?: string;
  serviceId?: string;
  assigneeId?: string;
  statusFilter?: AllowedStatus;
  urgencyFilter?: AllowedUrgency;
  windowDays: number;
  userTimeZone: string;
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    OPEN: '#dc2626',
    ACKNOWLEDGED: '#2563eb',
    SNOOZED: '#ca8a04',
    SUPPRESSED: '#7c3aed',
    RESOLVED: '#16a34a',
  };
  return colors[status] || '#6b7280';
}

function buildSparklinePath(values: number[], width: number = 72, height: number = 24): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;

  if (values.length === 1) {
    const y = height - ((values[0] - min) / range) * height;
    return `M0,${y.toFixed(1)} L${width},${y.toFixed(1)}`;
  }

  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function buildSparklineAreaPath(values: number[], width: number = 72, height: number = 24): string {
  const linePath = buildSparklinePath(values, width, height);
  if (!linePath) return '';
  return `${linePath} L${width},${height} L0,${height} Z`;
}

export default async function AnalyticsContent({
  teamId,
  serviceId,
  assigneeId,
  statusFilter,
  urgencyFilter,
  windowDays,
  userTimeZone,
}: Props) {
  const metrics = await calculateSLAMetrics({
    teamId,
    serviceId,
    assigneeId,
    status: statusFilter,
    urgency: urgencyFilter,
    windowDays,
    userTimeZone,
  }).catch(error => {
    logger.error('analytics.metricsUnavailable', {
      component: 'AnalyticsContent',
      error,
    });
    return null;
  });

  if (!metrics) {
    return (
      <div className="analytics-content">
        <div
          className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
          role="alert"
        >
          <strong>Analytics data is unavailable.</strong>
          <p className="mt-1">
            OpsKnight could not calculate this metric set. Zero values are intentionally hidden so a
            database or aggregation failure cannot be mistaken for healthy performance.
          </p>
        </div>
      </div>
    );
  }
  const metricsAsOf = new Date();

  const formatMinutes = (val: number | null) =>
    val === null ? '--' : formatTimeMinutesMs(val * 60 * 1000);
  const formatPercent = (val: number | null) => (val === null ? '--' : `${val.toFixed(0)}%`);
  const formatPercentWidth = (val: number | null) => (val === null ? '0%' : `${val.toFixed(1)}%`);
  const toGaugeValue = (val: number | null) => val ?? 0;
  const formatHours = (ms: number) => `${(ms / 3600000).toFixed(1)}h`;
  const getComplianceStatus = (val: number | null) => {
    if (val === null) return 'default';
    return val >= 95 ? 'success' : val >= 80 ? 'warning' : 'danger';
  };
  const urgencyCounts = metrics.urgencyMix.reduce(
    (acc, entry) => {
      if (entry.urgency === 'HIGH') acc.high += entry.count;
      else if (entry.urgency === 'MEDIUM') acc.medium += entry.count;
      else if (entry.urgency === 'LOW') acc.low += entry.count;
      return acc;
    },
    { high: 0, medium: 0, low: 0 }
  );
  const highUrgencyCount = urgencyCounts.high;
  const mediumUrgencyCount = urgencyCounts.medium;
  const lowUrgencyCount = urgencyCounts.low;
  const highUrgencyPercent = metrics.totalIncidents
    ? (highUrgencyCount / metrics.totalIncidents) * 100
    : 0;
  const mediumUrgencyPercent = metrics.totalIncidents
    ? (mediumUrgencyCount / metrics.totalIncidents) * 100
    : 0;
  const lowUrgencyPercent = metrics.totalIncidents
    ? (lowUrgencyCount / metrics.totalIncidents) * 100
    : 0;
  const ackSlaBurnRate =
    metrics.ackCompliance === null ? null : Math.max(0, 100 - metrics.ackCompliance);
  const resolveSlaBurnRate =
    metrics.resolveCompliance === null ? null : Math.max(0, 100 - metrics.resolveCompliance);
  const dayMs = 24 * 60 * 60 * 1000;
  const effectiveWindowDays = Math.max(
    1,
    Math.ceil((metrics.effectiveEnd.getTime() - metrics.effectiveStart.getTime()) / dayMs)
  );
  const windowLabelDays = metrics.isClipped ? effectiveWindowDays : windowDays;
  const windowLabelSuffix = metrics.isClipped ? ' (retention limit)' : '';
  const formatDate = (date: Date) => formatDateTime(date, userTimeZone, { format: 'short' });
  const currentIncidentScope = {
    teamId,
    serviceId,
    assignee: assigneeId,
    status: statusFilter,
    urgency: urgencyFilter,
  };
  const periodIncidentScope = {
    ...currentIncidentScope,
    createdAfter: metrics.effectiveStart.toISOString(),
    createdBefore: metrics.effectiveEnd.toISOString(),
  };
  const currentIncidentHref = (
    overrides: NonNullable<Parameters<typeof buildIncidentListHref>[0]> = {}
  ) => buildIncidentListHref({ ...currentIncidentScope, ...overrides });
  const periodIncidentHref = (
    overrides: NonNullable<Parameters<typeof buildIncidentListHref>[0]> = {}
  ) => buildIncidentListHref({ ...periodIncidentScope, ...overrides });
  const hasActiveStatusFilter = statusFilter === 'OPEN' || statusFilter === 'ACKNOWLEDGED';
  const activeIncidentHref = statusFilter
    ? hasActiveStatusFilter
      ? currentIncidentHref({ status: statusFilter })
      : undefined
    : currentIncidentHref({ filter: 'all_open' });
  const highUrgencyIncidentHref =
    !urgencyFilter || urgencyFilter === 'HIGH'
      ? periodIncidentHref({ urgency: 'HIGH' })
      : undefined;
  const unassignedActiveIncidentHref = statusFilter
    ? hasActiveStatusFilter
      ? currentIncidentHref({ status: statusFilter, assignee: 'unassigned' })
      : undefined
    : currentIncidentHref({ filter: 'all_open', assignee: 'unassigned' });
  const triggeredIncidentHref =
    !statusFilter || statusFilter === 'OPEN' ? currentIncidentHref({ status: 'OPEN' }) : undefined;
  const currentAcknowledgedIncidentHref =
    !statusFilter || statusFilter === 'ACKNOWLEDGED'
      ? currentIncidentHref({ status: 'ACKNOWLEDGED' })
      : undefined;
  const mutedIncidentHref = statusFilter
    ? statusFilter === 'SNOOZED' || statusFilter === 'SUPPRESSED'
      ? currentIncidentHref({ status: statusFilter })
      : undefined
    : currentIncidentHref({ filter: 'muted' });

  const getDelta = (current: number | null, previous: number | null) => {
    if (current === null || previous === null || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  };

  const formatDelta = (delta: number | null) => {
    if (delta === null) return undefined;
    const prefix = delta > 0 ? '+' : '';
    return `${prefix}${delta.toFixed(1)}% vs prev`;
  };

  const getTrend = (delta: number | null) => {
    if (delta === null) return undefined;
    if (delta > 0) return 'up';
    if (delta < 0) return 'down';
    return 'neutral';
  };

  const lowerIsBetterIntent = (delta: number | null) => {
    if (delta === null || delta === 0) return 'neutral' as const;
    return delta < 0 ? ('positive' as const) : ('negative' as const);
  };

  const previousPeriodAvailable = metrics.previousPeriod.available !== false;
  const incidentDelta = previousPeriodAvailable
    ? getDelta(metrics.totalIncidents, metrics.previousPeriod.totalIncidents)
    : null;
  const mttaDelta = previousPeriodAvailable
    ? getDelta(metrics.mttd, metrics.previousPeriod.mtta)
    : null;
  const mttrDelta = previousPeriodAvailable
    ? getDelta(metrics.mttr, metrics.previousPeriod.mttr)
    : null;
  const smoothingWindow = windowDays <= 3 ? 1 : windowDays <= 14 ? 3 : 7;
  const countSeries = smoothSeries(
    metrics.trendSeries.map(entry => entry.count),
    smoothingWindow
  );
  const mttaSeries = smoothSeries(
    metrics.trendSeries.map(entry => entry.mtta),
    smoothingWindow
  );
  const mttrSeries = smoothSeries(
    metrics.trendSeries.map(entry => entry.mttr),
    smoothingWindow
  );
  const ackComplianceSeries = smoothSeries(
    metrics.trendSeries.map(entry => entry.ackCompliance),
    smoothingWindow
  );
  const resolveRateSeries = smoothSeries(
    metrics.trendSeries.map(entry => entry.resolveRate),
    smoothingWindow
  );
  const escalationRateSeries = smoothSeries(
    metrics.trendSeries.map(entry => entry.escalationRate),
    smoothingWindow
  );

  const showInsights = metrics.insights.length > 0;
  const insightCounts = metrics.insights.reduce(
    (acc, insight) => {
      if (insight.type === 'positive') acc.positive += 1;
      else if (insight.type === 'negative') acc.negative += 1;
      else acc.neutral += 1;
      return acc;
    },
    { positive: 0, negative: 0, neutral: 0 }
  );
  const statusTotal = metrics.statusMix.reduce((sum, entry) => sum + entry.count, 0);
  const statusMixWithPercent = metrics.statusMix.map(entry => ({
    ...entry,
    percent: statusTotal ? (entry.count / statusTotal) * 100 : 0,
  }));
  const topServiceMax = Math.max(1, ...metrics.topServices.map(entry => entry.count));
  const assigneeMax = Math.max(1, ...metrics.assigneeLoad.map(entry => entry.count));
  const statusAgeMax = Math.max(1, ...metrics.statusAges.map(entry => entry.avgMs ?? 0));
  const onCallMax = Math.max(1, ...metrics.onCallLoad.map(entry => entry.incidentCount));
  const resolvedTotal = metrics.autoResolvedCount + metrics.manualResolvedCount;
  const autoResolvedShare = resolvedTotal ? (metrics.autoResolvedCount / resolvedTotal) * 100 : 0;
  const manualResolvedShare = resolvedTotal
    ? (metrics.manualResolvedCount / resolvedTotal) * 100
    : 0;

  const serviceHealthCounts = metrics.serviceMetrics.reduce(
    (acc, service) => {
      if (service.status === 'Healthy') acc.healthy += 1;
      else if (service.status === 'Degraded') acc.degraded += 1;
      else if (service.status === 'Critical') acc.critical += 1;
      else acc.unknown += 1;
      return acc;
    },
    { total: metrics.serviceMetrics.length, healthy: 0, degraded: 0, critical: 0, unknown: 0 }
  );

  return (
    <>
      {metrics.isClipped && (
        <div
          className="analytics-retention-banner"
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '8px',
            color: 'var(--color-danger)',
            fontSize: 'var(--font-size-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <AlertCircle className="w-4 h-4" />
          <span>
            <strong>Retention Notice:</strong> Analysis limited to the last {metrics.retentionDays}{' '}
            days by data retention policy.
          </span>
        </div>
      )}
      {metrics.detailCoverage?.mode === 'bounded-detail' && (
        <div
          className="analytics-coverage-banner"
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: '8px',
            color: 'var(--color-warning)',
            fontSize: 'var(--font-size-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <AlertCircle className="w-4 h-4" />
          <span>
            <strong>Detail coverage:</strong> Detail charts cover{' '}
            {formatDate(metrics.detailCoverage.start)} -{' '}
            {formatDate(metrics.detailCoverage.end)}, using{' '}
            {(
              metrics.detailCoverage.sampledIncidents ?? metrics.detailCoverage.totalIncidents
            ).toLocaleString()}{' '}
            of {metrics.detailCoverage.totalIncidents.toLocaleString()} incidents in that interval.
            Headline metrics cover {formatDate(metrics.effectiveStart)} -{' '}
            {formatDate(metrics.effectiveEnd)} across {metrics.totalIncidents.toLocaleString()}{' '}
            incidents.
          </span>
        </div>
      )}

      <div className="analytics-context analytics-context-compact">
        <div className="analytics-context-row">
          <div className="analytics-context-inline">
            <span className="analytics-context-label">Window</span>
            <span className="analytics-context-pill">
              Last {windowLabelDays} days{windowLabelSuffix}
            </span>
            <span className="analytics-context-pill">
              Calculated {formatDateTime(metricsAsOf, userTimeZone, { format: 'datetime' })}
            </span>
            {metrics.isClipped ? (
              <span className="analytics-context-pill">
                Retention {formatDate(metrics.effectiveStart)} - {formatDate(metrics.effectiveEnd)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="v2-section-header v2-panel-heading">
        <h2 className="v2-section-title">
          <LayoutDashboard className="w-5 h-5" /> Executive Summary
        </h2>
        <span className="text-xs text-muted-foreground">Highlights vs previous period</span>
      </div>

      <section className="v2-grid-4 mb-4">
        <MetricCard
          label={`Incidents (${windowLabelDays}d)${windowLabelSuffix}`}
          value={metrics.totalIncidents.toLocaleString()}
          detail="New incidents"
          trend={getTrend(incidentDelta)}
          trendIntent={lowerIsBetterIntent(incidentDelta)}
          trendValue={formatDelta(incidentDelta)}
          variant={incidentDelta !== null && incidentDelta > 0 ? 'warning' : 'default'}
          icon={<MetricIcon type="incidents" />}
          href={periodIncidentHref()}
          tooltip={metricDefinitionTooltip(
            INCIDENT_METRIC_DEFINITIONS.totalIncidents,
            `Last ${windowLabelDays} days`
          )}
          className="analytics-card-large"
        >
          <div className="analytics-kpi-meta">
            <svg className="analytics-sparkline analytics-sparkline-blue" viewBox="0 0 72 24">
              <path className="analytics-sparkline-area" d={buildSparklineAreaPath(countSeries)} />
              <path className="analytics-sparkline-line" d={buildSparklinePath(countSeries)} />
            </svg>
          </div>
        </MetricCard>
        <MetricCard
          label="Active Incidents · Current"
          value={metrics.activeIncidents.toLocaleString()}
          detail="Current backlog"
          variant={metrics.activeIncidents > 5 ? 'danger' : 'default'}
          icon={<MetricIcon type="incidents" />}
          href={activeIncidentHref}
          tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.activeIncidents)}
          className="analytics-card-large"
        />
        <MetricCard
          label={`MTTA (${windowLabelDays}d)${windowLabelSuffix}`}
          value={formatMinutes(metrics.mttd)}
          detail="Avg response time"
          trend={getTrend(mttaDelta)}
          trendIntent={lowerIsBetterIntent(mttaDelta)}
          trendValue={formatDelta(mttaDelta)}
          variant="primary"
          icon={<MetricIcon type="MTTA" />}
          tooltip={metricDefinitionTooltip(
            INCIDENT_METRIC_DEFINITIONS.mtta,
            `Last ${windowLabelDays} days`
          )}
          className="analytics-card-large"
        >
          <div className="analytics-kpi-meta">
            <svg className="analytics-sparkline analytics-sparkline-amber" viewBox="0 0 72 24">
              <path className="analytics-sparkline-area" d={buildSparklineAreaPath(mttaSeries)} />
              <path className="analytics-sparkline-line" d={buildSparklinePath(mttaSeries)} />
            </svg>
          </div>
        </MetricCard>
        <MetricCard
          label={`MTTR (${windowLabelDays}d)${windowLabelSuffix}`}
          value={formatMinutes(metrics.mttr)}
          detail="Avg resolution time"
          trend={getTrend(mttrDelta)}
          trendIntent={lowerIsBetterIntent(mttrDelta)}
          trendValue={formatDelta(mttrDelta)}
          variant="primary"
          icon={<MetricIcon type="MTTR" />}
          tooltip={metricDefinitionTooltip(
            INCIDENT_METRIC_DEFINITIONS.mttr,
            `Last ${windowLabelDays} days`
          )}
          className="analytics-card-large"
        >
          <div className="analytics-kpi-meta">
            <svg className="analytics-sparkline analytics-sparkline-emerald" viewBox="0 0 72 24">
              <path className="analytics-sparkline-area" d={buildSparklineAreaPath(mttrSeries)} />
              <path className="analytics-sparkline-line" d={buildSparklinePath(mttrSeries)} />
            </svg>
          </div>
        </MetricCard>
        <MetricCard
          label="Resolution Compliance"
          value={formatPercent(metrics.resolveCompliance)}
          detail="SLA compliance"
          variant={
            getComplianceStatus(metrics.resolveCompliance) as
              | 'success'
              | 'warning'
              | 'danger'
              | 'default'
          }
          icon={<Shield className="w-5 h-5" />}
          tooltip={metricDefinitionTooltip(
            INCIDENT_METRIC_DEFINITIONS.resolveCompliance,
            `Last ${windowLabelDays} days`
          )}
          className="analytics-card-large"
        >
          <div className="analytics-kpi-meta">
            <svg
              className="analytics-sparkline analytics-sparkline-indigo"
              viewBox="0 0 72 24"
              aria-hidden="true"
            >
              <path className="analytics-sparkline-area" d={buildSparklineAreaPath(mttrSeries)} />
              <path className="analytics-sparkline-line" d={buildSparklinePath(mttrSeries)} />
            </svg>
          </div>
        </MetricCard>
        <MetricCard
          label="Ack SLA"
          value={formatPercent(metrics.ackCompliance)}
          detail="Within target"
          variant={
            getComplianceStatus(metrics.ackCompliance) as
              | 'success'
              | 'warning'
              | 'danger'
              | 'default'
          }
          icon={<Shield className="w-5 h-5" />}
          tooltip={metricDefinitionTooltip(
            INCIDENT_METRIC_DEFINITIONS.ackCompliance,
            `Last ${windowLabelDays} days`
          )}
          className="analytics-card-large"
        >
          <div className="analytics-kpi-meta">
            <svg
              className="analytics-sparkline analytics-sparkline-indigo"
              viewBox="0 0 72 24"
              aria-hidden="true"
            >
              <path
                className="analytics-sparkline-area"
                d={buildSparklineAreaPath(ackComplianceSeries)}
              />
              <path
                className="analytics-sparkline-line"
                d={buildSparklinePath(ackComplianceSeries)}
              />
            </svg>
          </div>
        </MetricCard>
        <MetricCard
          label="Resolve Rate"
          value={formatPercent(metrics.resolveRate)}
          detail="Completion"
          variant={metrics.resolveRate > 80 ? 'success' : 'default'}
          icon={<CheckCircle className="w-5 h-5 text-green-500" />}
          tooltip={metricDefinitionTooltip(
            INCIDENT_METRIC_DEFINITIONS.resolveRate,
            `Last ${windowLabelDays} days`
          )}
          className="analytics-card-large"
        >
          <div className="analytics-kpi-meta">
            <svg
              className="analytics-sparkline analytics-sparkline-emerald"
              viewBox="0 0 72 24"
              aria-hidden="true"
            >
              <path
                className="analytics-sparkline-area"
                d={buildSparklineAreaPath(resolveRateSeries)}
              />
              <path
                className="analytics-sparkline-line"
                d={buildSparklinePath(resolveRateSeries)}
              />
            </svg>
          </div>
        </MetricCard>
        <MetricCard
          label="Escalation Rate"
          value={formatPercent(metrics.escalationRate)}
          detail="Incidents escalated"
          variant={metrics.escalationRate > 20 ? 'warning' : 'default'}
          icon={<TrendingUp className="w-5 h-5" />}
          className="analytics-card-large"
        >
          <div className="analytics-kpi-meta">
            <svg
              className="analytics-sparkline analytics-sparkline-rose"
              viewBox="0 0 72 24"
              aria-hidden="true"
            >
              <path
                className="analytics-sparkline-area"
                d={buildSparklineAreaPath(escalationRateSeries)}
              />
              <path
                className="analytics-sparkline-line"
                d={buildSparklinePath(escalationRateSeries)}
              />
            </svg>
          </div>
        </MetricCard>
      </section>

      <section className="v2-grid-4 mb-8">
        <MetricCard
          className="analytics-card-compact"
          label="Triggered · Current"
          value={metrics.openCount.toLocaleString()}
          detail="Awaiting acknowledgment"
          variant={metrics.openCount > 0 ? 'warning' : 'success'}
          icon={<AlertCircle className="w-5 h-5 text-rose-500" />}
          href={triggeredIncidentHref}
          tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.triggeredIncidents)}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Acknowledged · Current"
          value={metrics.acknowledgedCount.toLocaleString()}
          detail="Work in progress"
          variant="default"
          icon={<CheckCircle className="w-5 h-5 text-blue-500" />}
          href={currentAcknowledgedIncidentHref}
          tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.acknowledgedIncidents)}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Muted · Current"
          value={(metrics.snoozedCount + metrics.suppressedCount).toLocaleString()}
          detail={`${metrics.snoozedCount.toLocaleString()} Snoozed · ${metrics.suppressedCount.toLocaleString()} Suppressed`}
          variant="default"
          icon={<Moon className="w-5 h-5 text-violet-500" />}
          href={mutedIncidentHref}
          tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.mutedIncidents)}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Ack Rate"
          value={formatPercent(metrics.ackRate)}
          detail="Acknowledgment"
          variant={metrics.ackRate > 90 ? 'success' : 'warning'}
          icon={<CheckCircle className="w-5 h-5 text-blue-500" />}
          tooltip={metricDefinitionTooltip(
            INCIDENT_METRIC_DEFINITIONS.ackRate,
            `Last ${windowLabelDays} days`
          )}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Resolve Breaches"
          value={metrics.resolveBreaches.toLocaleString()}
          detail="SLA misses"
          variant={metrics.resolveBreaches > 0 ? 'warning' : 'success'}
          icon={<AlertCircle className="w-5 h-5 text-rose-500" />}
        />
        <MetricCard
          className="analytics-card-compact"
          label="High Urgency"
          value={formatPercent(metrics.highUrgencyRate)}
          detail="Share of Total"
          variant={metrics.highUrgencyRate > 50 ? 'warning' : 'default'}
          icon={<AlertTriangle className="w-5 h-5 text-orange-500" />}
          href={highUrgencyIncidentHref}
          tooltip={metricDefinitionTooltip(
            INCIDENT_METRIC_DEFINITIONS.highUrgencyPeriod,
            `Last ${windowLabelDays} days`
          )}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Ack Breaches"
          value={metrics.ackBreaches.toLocaleString()}
          detail="SLA misses"
          variant={metrics.ackBreaches > 0 ? 'warning' : 'success'}
          icon={<AlertCircle className="w-5 h-5 text-orange-500" />}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Alerts"
          value={metrics.alertsCount.toLocaleString()}
          detail="Total Signals"
          variant="default"
          icon={<Bell className="w-5 h-5 text-gray-500" />}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Noise Ratio"
          value={metrics.alertsPerIncident.toFixed(1) + 'x'}
          detail="Alerts/Incident"
          variant="default"
          icon={<Zap className="w-5 h-5 text-yellow-500" />}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Unassigned · Current"
          value={metrics.unassignedActive.toLocaleString()}
          detail="Needs Owner"
          variant={metrics.unassignedActive > 0 ? 'warning' : 'success'}
          icon={<Users className="w-5 h-5" />}
          href={unassignedActiveIncidentHref}
          tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.unassignedActive)}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Coverage Gaps"
          value={metrics.coverageGapDays.toLocaleString()}
          detail="Days uncovered"
          variant={metrics.coverageGapDays > 0 ? 'warning' : 'success'}
          icon={<AlertTriangle className="w-5 h-5 text-orange-500" />}
          href="/schedules"
        />
        <MetricCard
          className="analytics-card-compact"
          label="After Hours"
          value={formatPercent(metrics.afterHoursRate)}
          detail="Off-Business Hours"
          variant="default"
          icon={<Moon className="w-5 h-5 text-indigo-500" />}
        />
        <MetricCard
          className="analytics-card-compact"
          label="Coverage"
          value={formatPercent(metrics.coveragePercent)}
          detail="On-Call Schedule"
          variant={metrics.coveragePercent > 95 ? 'success' : 'danger'}
          icon={<Shield className="w-5 h-5" />}
          href="/schedules"
        />
        <MetricCard
          className="analytics-card-compact"
          label="On-Call Hours"
          value={formatHours(metrics.onCallHoursMs)}
          detail="Total Scheduled"
          variant="primary"
          icon={<Clock className="w-5 h-5" />}
          href="/schedules"
        />
        <MetricCard
          className="analytics-card-compact"
          label="MTBF"
          value={metrics.mtbfMs ? formatHours(metrics.mtbfMs) : '--'}
          detail="Mean Time Between"
          variant="default"
          icon={<Activity className="w-5 h-5" />}
        />
      </section>

      <section className={`${showInsights ? 'v2-grid-split' : 'w-full'} mb-8 insights-trends`}>
        {showInsights && (
          <div className="insights-panel v2-panel-insights">
            <div className="insights-panel-header">
              <div className="insights-panel-title-row">
                <span className="insights-panel-icon">
                  <Sparkles className="w-4 h-4" />
                </span>
                <div>
                  <div className="insights-panel-kicker">Smart Insights</div>
                  <h3 className="insights-panel-title">
                    Key signals in the last {windowLabelDays} days{windowLabelSuffix}
                  </h3>
                </div>
              </div>
              <div className="insights-panel-badges">
                <span>Attention {insightCounts.negative}</span>
                <span>Opportunity {insightCounts.positive}</span>
                <span>Neutral {insightCounts.neutral}</span>
              </div>
            </div>
            <div className="insights-panel-body">
              {metrics.insights.slice(0, 5).map((insight, i) => (
                <div
                  className={`insights-panel-row ${insight.type === 'positive' ? 'is-positive' : insight.type === 'negative' ? 'is-negative' : ''}`}
                  key={i}
                >
                  <div className="insights-panel-row-tag">
                    {insight.type === 'positive'
                      ? 'Opportunity'
                      : insight.type === 'negative'
                        ? 'Attention'
                        : 'Insight'}
                  </div>
                  <div className="insights-panel-row-text">{insight.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="trends-panel v2-panel-trends">
          <div className="trends-panel-header">
            <div className="trends-panel-title-row">
              <span className="trends-panel-icon">
                <TrendingUp className="w-4 h-4" />
              </span>
              <div>
                <div className="trends-panel-kicker">Response Performance Trends</div>
                <h3 className="trends-panel-title">
                  MTTA vs MTTR · Last {windowLabelDays} days{windowLabelSuffix}
                </h3>
              </div>
            </div>
            <div className="trends-panel-badges">
              <span className="trends-badge trends-badge-mtta">
                MTTA avg {formatMinutes(metrics.mttd)}
              </span>
              <span className="trends-badge trends-badge-mttr">
                MTTR avg {formatMinutes(metrics.mttr)}
              </span>
            </div>
          </div>
          <div className="trends-panel-body">
            {metrics.totalIncidents === 0 ? (
              <div className="analytics-empty-state">
                <div className="analytics-empty-title">No incidents in this window</div>
              </div>
            ) : (
              <div className="trends-panel-grid">
                <div className="trends-panel-chart">
                  <LineChart
                    data={metrics.trendSeries}
                    lines={[
                      { key: 'mtta', color: '#f59e0b', label: 'MTTA' },
                      { key: 'mttr', color: '#10b981', label: 'MTTR' },
                    ]}
                    height={280}
                    valueFormatter={(v: number) => formatTimeMinutesMs(v * 60000)}
                  />
                </div>
                <div className="trends-panel-stats">
                  <div className="trends-panel-stat">
                    <span>MTTA delta</span>
                    <strong>
                      {mttaDelta !== null && (
                        <span
                          className={`analytics-trend-arrow ${mttaDelta > 0 ? 'trend-negative' : 'trend-positive'}`}
                        >
                          {mttaDelta > 0 ? '⬆' : '⬇'}
                        </span>
                      )}
                      {mttaDelta === null ? '--' : `${Math.abs(mttaDelta).toFixed(1)}%`}
                    </strong>
                  </div>
                  <div className="trends-panel-stat">
                    <span>MTTR delta</span>
                    <strong>
                      {mttrDelta !== null && (
                        <span
                          className={`analytics-trend-arrow ${mttrDelta > 0 ? 'trend-negative' : 'trend-positive'}`}
                        >
                          {mttrDelta > 0 ? '⬆' : '⬇'}
                        </span>
                      )}
                      {mttrDelta === null ? '--' : `${Math.abs(mttrDelta).toFixed(1)}%`}
                    </strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="glass-panel mb-8 analytics-narrative analytics-narrative-compact">
        <div className="analytics-narrative-header">
          <div className="analytics-narrative-title-block">
            <span className="analytics-narrative-kicker">Narrative</span>
            <h3 className="analytics-narrative-title">Key changes vs previous period</h3>
          </div>
          <a href={periodIncidentHref()} className="analytics-narrative-link">
            View incidents
          </a>
        </div>
        <div className="analytics-narrative-list">
          <div
            className={`analytics-narrative-item ${incidentDelta !== null && incidentDelta > 0 ? 'is-up' : incidentDelta !== null && incidentDelta < 0 ? 'is-down' : ''}`}
          >
            <span>Incident volume</span>
            <strong>
              {incidentDelta === null
                ? 'No prior data'
                : `${Math.abs(incidentDelta).toFixed(1)}% ${incidentDelta > 0 ? 'up' : 'down'}`}
            </strong>
          </div>
          <div
            className={`analytics-narrative-item ${mttaDelta !== null && mttaDelta > 0 ? 'is-up' : mttaDelta !== null && mttaDelta < 0 ? 'is-down' : ''}`}
          >
            <span>Response time (MTTA)</span>
            <strong>
              {mttaDelta === null
                ? 'No prior data'
                : `${Math.abs(mttaDelta).toFixed(1)}% ${mttaDelta > 0 ? 'slower' : 'faster'}`}
            </strong>
          </div>
          <div
            className={`analytics-narrative-item ${mttrDelta !== null && mttrDelta > 0 ? 'is-up' : mttrDelta !== null && mttrDelta < 0 ? 'is-down' : ''}`}
          >
            <span>Resolution time (MTTR)</span>
            <strong>
              {mttrDelta === null
                ? 'No prior data'
                : `${Math.abs(mttrDelta).toFixed(1)}% ${mttrDelta > 0 ? 'slower' : 'faster'}`}
            </strong>
          </div>
        </div>
      </section>

      <section className="operational-grid mb-8">
        <div className="operational-card">
          <div className="operational-card-header">
            <h3>Incident Volume Trend</h3>
            <span>
              Window {windowLabelDays} days{windowLabelSuffix}
            </span>
          </div>
          <div className="operational-card-body">
            <div className="operational-chart h-200 w-full pl-0 pr-0">
              {metrics.totalIncidents === 0 ? (
                <div className="analytics-empty-state">
                  <div className="analytics-empty-title">No incident volume yet</div>
                </div>
              ) : (
                <LineChart
                  data={metrics.trendSeries}
                  lines={[{ key: 'count', color: '#6366f1', label: 'Volume' }]}
                  height={180}
                  showLegend={false}
                  valueFormatter={v => v.toFixed(0)}
                />
              )}
            </div>
          </div>
        </div>
        <div className="operational-card">
          <div className="operational-card-header">
            <h3>Current Status Mix</h3>
            <span>{metrics.totalIncidents.toLocaleString()} incidents</span>
          </div>
          <div className="operational-card-body">
            <div className="operational-status-list">
              {statusMixWithPercent.map(entry => (
                <div key={entry.status} className="operational-status-row">
                  <div className="operational-status-head">
                    <span
                      className="operational-status-dot"
                      style={{ background: getStatusColor(entry.status) }}
                    />
                    <span className="operational-status-name">{entry.status}</span>
                    <span className="operational-status-count">{entry.count}</span>
                    <span className="operational-status-share">{entry.percent.toFixed(1)}%</span>
                  </div>
                  <div className="operational-status-bar">
                    <span
                      style={{
                        width: `${entry.percent.toFixed(1)}%`,
                        background: getStatusColor(entry.status),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="operational-card">
          <div className="operational-card-header">
            <h3>Assignee Load</h3>
            <span>{metrics.assigneeLoad.length} responders</span>
          </div>
          <div className="operational-card-body">
            {metrics.assigneeLoad.map((entry, index) => {
              const percent = (entry.count / assigneeMax) * 100;
              return (
                <div key={entry.id} className="operational-status-row operational-assignee-row">
                  <div className="operational-status-head">
                    <span className={`operational-rank ${index < 3 ? 'is-top' : ''}`}>
                      {index + 1}
                    </span>
                    <span className="operational-status-name">{entry.name}</span>
                    <span className="operational-status-count">{entry.count}</span>
                  </div>
                  <div className="operational-status-bar">
                    <span style={{ width: `${percent.toFixed(1)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="v2-section-header v2-panel-heading">
        <h2 className="v2-section-title">
          <BarChart3 className="w-5 h-5" /> Distribution &amp; Mix
        </h2>
        <span className="text-xs text-muted-foreground">Service, urgency, and status age</span>
      </div>

      <section className="distribution-grid mb-8">
        <div className="distribution-card">
          <div className="distribution-card-header">
            <h3>Top Services by Incidents</h3>
            <span>{metrics.topServices.length} services</span>
          </div>
          <div className="distribution-card-body">
            {metrics.topServices.length === 0 ? (
              <div className="distribution-empty">No incidents in this window.</div>
            ) : (
              metrics.topServices.map((service, index) => {
                const percent = (service.count / topServiceMax) * 100;
                const share = metrics.totalIncidents
                  ? (service.count / metrics.totalIncidents) * 100
                  : 0;
                return (
                  <div key={service.id} className="distribution-row">
                    <div className="distribution-row-head">
                      <span className={`distribution-rank ${index < 3 ? 'is-top' : ''}`}>
                        {index + 1}
                      </span>
                      <span className="distribution-name">{service.name}</span>
                      <span className="distribution-count">{service.count}</span>
                      <span className="distribution-share">{share.toFixed(1)}%</span>
                    </div>
                    <div className="distribution-bar">
                      <span style={{ width: `${percent.toFixed(1)}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="distribution-card">
          <div className="distribution-card-header">
            <h3>Urgency Mix</h3>
            <span>{metrics.totalIncidents.toLocaleString()} incidents</span>
          </div>
          <div className="distribution-card-body distribution-urgency">
            <div className="distribution-urgency-row">
              <span>High urgency</span>
              <strong>{highUrgencyCount.toLocaleString()}</strong>
              <em>{highUrgencyPercent.toFixed(1)}%</em>
              <div className="distribution-urgency-bar">
                <span style={{ width: `${highUrgencyPercent.toFixed(1)}%` }} />
              </div>
            </div>
            <div className="distribution-urgency-row is-medium">
              <span>Medium urgency</span>
              <strong>{mediumUrgencyCount.toLocaleString()}</strong>
              <em>{mediumUrgencyPercent.toFixed(1)}%</em>
              <div className="distribution-urgency-bar">
                <span style={{ width: `${mediumUrgencyPercent.toFixed(1)}%` }} />
              </div>
            </div>
            <div className="distribution-urgency-row is-low">
              <span>Low urgency</span>
              <strong>{lowUrgencyCount.toLocaleString()}</strong>
              <em>{lowUrgencyPercent.toFixed(1)}%</em>
              <div className="distribution-urgency-bar">
                <span style={{ width: `${lowUrgencyPercent.toFixed(1)}%` }} />
              </div>
            </div>
            <div className="distribution-urgency-footnote">
              Window: {windowLabelDays} days{windowLabelSuffix}
            </div>
          </div>
        </div>

        <div className="distribution-card">
          <div className="distribution-card-header">
            <h3>State Age Breakdown</h3>
            <span>Average time</span>
          </div>
          <div className="distribution-card-body">
            {metrics.statusAges.length === 0 ? (
              <div className="distribution-empty">No status age data available.</div>
            ) : (
              metrics.statusAges.map(entry => {
                const percent = statusAgeMax ? ((entry.avgMs ?? 0) / statusAgeMax) * 100 : 0;
                return (
                  <div key={entry.status} className="distribution-row">
                    <div className="distribution-row-head">
                      <span className="distribution-name">{entry.status}</span>
                      <span className="distribution-count">
                        {entry.avgMs === null ? '--' : formatHours(entry.avgMs)}
                      </span>
                    </div>
                    <div className="distribution-bar distribution-bar-muted">
                      <span style={{ width: `${percent.toFixed(1)}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <div className="v2-section-header v2-panel-heading">
        <h2 className="v2-section-title">
          <Users className="w-5 h-5" /> Ownership &amp; Reliability
        </h2>
        <span className="text-xs text-muted-foreground">On-call load and recurring incidents</span>
      </div>

      <section className="ownership-grid mb-8">
        <div className="ownership-card">
          <div className="ownership-card-header">
            <h3>On-Call Load</h3>
            <span>{metrics.onCallLoad.length} responders</span>
          </div>
          <div className="ownership-card-body">
            {metrics.onCallLoad.length === 0 ? (
              <div className="ownership-empty">No on-call shifts in this window.</div>
            ) : (
              metrics.onCallLoad.map((entry, index) => {
                const percent = onCallMax ? (entry.incidentCount / onCallMax) * 100 : 0;
                return (
                  <div key={entry.id} className="ownership-row">
                    <div className="ownership-row-top">
                      <span className={`ownership-rank ${index < 3 ? 'is-top' : ''}`}>
                        {index + 1}
                      </span>
                      <span className="ownership-name">{entry.name}</span>
                      <span className="ownership-meta">{formatHours(entry.hoursMs)}</span>
                      <span className="ownership-count">{entry.incidentCount}</span>
                    </div>
                    <div className="ownership-bar">
                      <span style={{ width: `${percent.toFixed(1)}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="ownership-card">
          <div className="ownership-card-header">
            <h3>Recurring Incident Titles</h3>
            <span>{metrics.recurringTitles.length} patterns</span>
          </div>
          <div className="ownership-card-body">
            {metrics.recurringTitles.length === 0 ? (
              <div className="ownership-empty">No recurring incidents in this window.</div>
            ) : (
              metrics.recurringTitles.map(entry => (
                <div key={entry.title} className="ownership-row ownership-row-compact">
                  <div>
                    <div className="ownership-name">{entry.title}</div>
                    <div className="ownership-meta">Recurring pattern</div>
                  </div>
                  <span className="ownership-count">{entry.count}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="ownership-card">
          <div className="ownership-card-header">
            <h3>Resolution Breakdown</h3>
            <span>{metrics.eventsCount.toLocaleString()} events logged</span>
          </div>
          <div className="ownership-card-body">
            <div className="ownership-kpi-grid">
              <div className="ownership-kpi">
                <span>Auto-resolved</span>
                <strong>{metrics.autoResolvedCount.toLocaleString()}</strong>
                <em>{formatPercent(autoResolvedShare)}</em>
              </div>
              <div className="ownership-kpi">
                <span>Manual resolved</span>
                <strong>{metrics.manualResolvedCount.toLocaleString()}</strong>
                <em>{formatPercent(manualResolvedShare)}</em>
              </div>
              <div className="ownership-kpi">
                <span>Reopen rate</span>
                <strong>{formatPercent(metrics.reopenRate)}</strong>
                <em>
                  Last {windowLabelDays} days{windowLabelSuffix}
                </em>
              </div>
              <div className="ownership-kpi">
                <span>Event volume</span>
                <strong>{metrics.eventsCount.toLocaleString()}</strong>
                <em>Incident events</em>
              </div>
            </div>
            <div className="ownership-share">
              <div className="ownership-share-track">
                <span style={{ width: `${manualResolvedShare.toFixed(1)}%` }} />
              </div>
              <div className="ownership-share-labels">
                <span>Auto</span>
                <span>Manual</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="service-health-section mb-8">
        <div className="service-health-shell">
          <header className="service-health-header">
            <div className="service-health-title">
              <span className="service-health-icon">
                <Activity className="w-5 h-5" />
              </span>
              <div>
                <span className="service-health-eyebrow">Service Health Matrix</span>
                <h3 className="service-health-heading">
                  Operational health across monitored services
                </h3>
              </div>
            </div>
            <div className="service-health-meta">
              <div className="service-health-meta-card">
                <span>Services monitored</span>
                <strong>{serviceHealthCounts.total.toLocaleString()}</strong>
                <em>Active catalog</em>
              </div>
              <div className="service-health-meta-card is-critical">
                <span>Critical</span>
                <strong>{serviceHealthCounts.critical.toLocaleString()}</strong>
                <em>Immediate focus</em>
              </div>
              <div className="service-health-meta-card is-degraded">
                <span>Degraded</span>
                <strong>{serviceHealthCounts.degraded.toLocaleString()}</strong>
                <em>Needs attention</em>
              </div>
              <div className="service-health-meta-card is-healthy">
                <span>Healthy</span>
                <strong>{serviceHealthCounts.healthy.toLocaleString()}</strong>
                <em>Stable</em>
              </div>
            </div>
          </header>
          <div className="service-health-body">
            <ServiceHealthTable services={metrics.serviceMetrics} />
          </div>
        </div>
      </section>

      <div className="v2-section-header v2-panel-heading">
        <h2 className="v2-section-title">
          <Shield className="w-5 h-5" /> SLA &amp; Coverage
        </h2>
        <span className="text-xs text-muted-foreground">Targets, breaches, and scheduling</span>
      </div>

      <section className="sla-coverage-panel mb-8">
        <div className="sla-coverage-header">
          <div className="sla-coverage-title">
            <span className="sla-coverage-icon">
              <Shield className="w-4 h-4" />
            </span>
            <div>
              <span className="sla-coverage-eyebrow">Coverage Outlook</span>
              <h3>Staffing readiness for the next 14 days</h3>
            </div>
          </div>
          <div className="sla-coverage-chips">
            <span>Coverage {formatPercent(metrics.coveragePercent)}</span>
            <span>{metrics.coverageGapDays.toLocaleString()} gap days</span>
            <span>{formatHours(metrics.onCallHoursMs)} scheduled</span>
          </div>
        </div>
        <div className="sla-coverage-body">
          <div className="sla-coverage-progress">
            <div className="sla-coverage-track">
              <span style={{ width: `${metrics.coveragePercent.toFixed(1)}%` }} />
            </div>
            <div className="sla-coverage-progress-meta">
              <span>Target 100%</span>
              <span>Current {formatPercent(metrics.coveragePercent)}</span>
            </div>
          </div>
          <div className="sla-coverage-stats">
            <div>
              <span>Coverage</span>
              <strong>{formatPercent(metrics.coveragePercent)}</strong>
              <em>Next 14 days</em>
            </div>
            <div>
              <span>Coverage gaps</span>
              <strong>{metrics.coverageGapDays.toLocaleString()}</strong>
              <em>Days without coverage</em>
            </div>
            <div>
              <span>Scheduled hours</span>
              <strong>{formatHours(metrics.onCallHoursMs)}</strong>
              <em>{metrics.onCallUsersCount.toLocaleString()} responders</em>
            </div>
            <div>
              <span>Active overrides</span>
              <strong>{metrics.activeOverrides.toLocaleString()}</strong>
              <em>Current</em>
            </div>
          </div>
        </div>
      </section>

      <section className="sla-summary-panel mb-8">
        <div className="sla-summary-header">
          <div className="sla-summary-title">
            <span className="sla-summary-icon">
              <Activity className="w-4 h-4" />
            </span>
            <div>
              <span className="sla-summary-eyebrow">SLA Summary</span>
              <h3>Latency distribution and SLA risk signals</h3>
            </div>
          </div>
          <div className="sla-summary-meta">
            <span>
              {windowLabelDays} day window{windowLabelSuffix}
            </span>
            <span>{metrics.eventsCount.toLocaleString()} events</span>
          </div>
        </div>
        <div className="sla-summary-body">
          <div className="sla-summary-columns">
            <div className="sla-summary-block">
              <div className="sla-summary-block-title">Latency percentiles</div>
              <div className="sla-summary-grid">
                <div>
                  <span>MTTA p50</span>
                  <strong>
                    {metrics.mttaP50 === null ? '--' : formatMinutes(metrics.mttaP50)}
                  </strong>
                </div>
                <div>
                  <span>MTTA p95</span>
                  <strong>
                    {metrics.mttaP95 === null ? '--' : formatMinutes(metrics.mttaP95)}
                  </strong>
                </div>
                <div>
                  <span>MTTR p50</span>
                  <strong>
                    {metrics.mttrP50 === null ? '--' : formatMinutes(metrics.mttrP50)}
                  </strong>
                </div>
                <div>
                  <span>MTTR p95</span>
                  <strong>
                    {metrics.mttrP95 === null ? '--' : formatMinutes(metrics.mttrP95)}
                  </strong>
                </div>
              </div>
            </div>
            <div className="sla-summary-block">
              <div className="sla-summary-block-title">Breaches &amp; burn</div>
              <div className="sla-summary-grid">
                <div>
                  <span>Ack SLA breaches</span>
                  <strong>{metrics.ackBreaches.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Resolve SLA breaches</span>
                  <strong>{metrics.resolveBreaches.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Ack SLA burn</span>
                  <strong>{formatPercent(ackSlaBurnRate)}</strong>
                </div>
                <div>
                  <span>Resolve SLA burn</span>
                  <strong>{formatPercent(resolveSlaBurnRate)}</strong>
                </div>
                <div>
                  <span>High urgency share</span>
                  <strong>{formatPercent(metrics.highUrgencyRate)}</strong>
                </div>
                <div>
                  <span>Unassigned active</span>
                  <strong>{metrics.unassignedActive.toLocaleString()}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sla-service-panel mb-8">
        <div className="sla-service-header">
          <div className="sla-service-title">
            <span className="sla-service-icon">
              <Shield className="w-4 h-4" />
            </span>
            <div>
              <span className="sla-service-eyebrow">SLA Compliance by Service</span>
              <h3>Response and resolve adherence per service</h3>
            </div>
          </div>
          <div className="sla-service-meta">
            <span>{metrics.serviceSlaTable.length} services</span>
            <span>
              Last {windowLabelDays} days{windowLabelSuffix}
            </span>
          </div>
        </div>

        <div className="sla-service-body">
          {metrics.serviceSlaTable.length === 0 ? (
            <div className="sla-service-empty">No SLA data in this window.</div>
          ) : (
            <div className="sla-service-list">
              {metrics.serviceSlaTable.map(entry => (
                <div key={entry.id} className="sla-service-row">
                  <div className="sla-service-row-name">{entry.name}</div>
                  <div className="sla-service-row-metrics">
                    <div className="sla-service-row-metric">
                      <div>
                        <span>Ack SLA</span>
                        <strong>{formatPercent(entry.ackRate)}</strong>
                      </div>
                      <div className="sla-service-row-bar">
                        <span style={{ width: `${entry.ackRate.toFixed(1)}%` }} />
                      </div>
                    </div>
                    <div className="sla-service-row-metric is-resolve">
                      <div>
                        <span>Resolve SLA</span>
                        <strong>{formatPercent(entry.resolveRate)}</strong>
                      </div>
                      <div className="sla-service-row-bar">
                        <span style={{ width: `${entry.resolveRate.toFixed(1)}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="sla-compliance-panel mb-8">
        <div className="sla-compliance-header">
          <div className="sla-compliance-title">
            <span className="sla-compliance-icon">
              <Shield className="w-4 h-4" />
            </span>
            <div>
              <span className="sla-compliance-eyebrow">SLA Compliance</span>
              <h3>Adherence across response, resolve, and coverage</h3>
            </div>
          </div>
          <div className="sla-compliance-meta">
            <span>Ack {formatPercent(metrics.ackCompliance)}</span>
            <span>Resolve {formatPercent(metrics.resolveCompliance)}</span>
            <span>Coverage {formatPercent(metrics.coveragePercent)}</span>
          </div>
        </div>
        <div className="sla-compliance-body">
          <div className="sla-compliance-grid">
            <div className="sla-compliance-card">
              <div className="sla-compliance-card-head">
                <span>Ack SLA</span>
                <strong>{formatPercent(metrics.ackCompliance)}</strong>
              </div>
              <GaugeChart value={toGaugeValue(metrics.ackCompliance)} label="Ack SLA" size={110} />
              <div className="sla-compliance-bar">
                <span style={{ width: formatPercentWidth(metrics.ackCompliance) }} />
              </div>
            </div>
            <div className="sla-compliance-card">
              <div className="sla-compliance-card-head">
                <span>Resolve SLA</span>
                <strong>{formatPercent(metrics.resolveCompliance)}</strong>
              </div>
              <GaugeChart
                value={toGaugeValue(metrics.resolveCompliance)}
                label="Resolve SLA"
                size={110}
              />
              <div className="sla-compliance-bar is-resolve">
                <span style={{ width: formatPercentWidth(metrics.resolveCompliance) }} />
              </div>
            </div>
            <div className="sla-compliance-card">
              <div className="sla-compliance-card-head">
                <span>Coverage</span>
                <strong>{formatPercent(metrics.coveragePercent)}</strong>
              </div>
              <GaugeChart value={metrics.coveragePercent} label="Coverage" size={110} />
              <div className="sla-compliance-bar is-coverage">
                <span style={{ width: `${metrics.coveragePercent.toFixed(1)}%` }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="activity-panel mb-8">
        <IncidentHeatmapWidget
          data={metrics.heatmapData}
          year={new Date().getFullYear()}
          variant="analytics"
        />
      </section>
    </>
  );
}
