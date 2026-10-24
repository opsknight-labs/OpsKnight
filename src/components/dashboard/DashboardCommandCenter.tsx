'use client';

import React from 'react';
import Link from 'next/link';
import DashboardRefresh from '../DashboardRefresh';
import DashboardExport from '../DashboardExport';
import MetricCard from './MetricCard';
import LiveClock from './LiveClock';
import { Badge } from '@/components/ui/shadcn/badge';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  INCIDENT_METRIC_DEFINITIONS,
  metricDefinitionTooltip,
  metricScopeLabel,
  type MetricDataState,
} from '@/lib/metric-contract';
import { useRealtime } from '@/hooks/useRealtime';

type SystemStatus = {
  label: string;
  color: string;
  bg: string;
};

type DashboardCommandCenterProps = {
  systemStatus: SystemStatus;
  visibilityScope?: 'GLOBAL' | 'SCOPED' | 'NONE';
  canExport?: boolean;
  allActiveIncidentsCount: number;
  totalInRange: number;
  currentActiveCount: number;
  currentTriggeredCount: number;
  currentMutedCount: number;
  currentSnoozedCount: number;
  currentSuppressedCount: number;
  metricsResolvedCount: number;
  unassignedCount: number;
  currentCriticalCount?: number;
  rangeLabel: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  incidents: any[];
  filters: Record<string, string | undefined>;
  currentAcknowledgedCount: number;
  userTimeZone?: string;
  isClipped?: boolean;
  retentionDays?: number;
  metricDataState?: MetricDataState;
  metricsAsOf?: string;
  totalHref?: string;
  activeHref?: string;
  mutedHref?: string;
  resolvedHref?: string;
  unassignedHref?: string;
  triggeredHref?: string;
  acknowledgedHref?: string;
  criticalHref?: string;
};

export default function DashboardCommandCenter({
  systemStatus,
  visibilityScope = 'GLOBAL',
  canExport = true,
  allActiveIncidentsCount,
  totalInRange,
  currentActiveCount,
  currentTriggeredCount,
  currentMutedCount,
  currentSnoozedCount,
  currentSuppressedCount,
  metricsResolvedCount,
  unassignedCount,
  currentCriticalCount = 0,
  rangeLabel,
  incidents,
  filters,
  currentAcknowledgedCount,
  userTimeZone = 'UTC',
  isClipped,
  retentionDays,
  metricDataState = 'available',
  metricsAsOf,
  totalHref,
  activeHref,
  mutedHref,
  resolvedHref,
  unassignedHref,
  triggeredHref,
  acknowledgedHref,
  criticalHref,
}: DashboardCommandCenterProps) {
  const { metrics: liveMetrics, recentIncidents } = useRealtime();
  const [filteredLiveMetrics, setFilteredLiveMetrics] = React.useState<typeof liveMetrics>(null);
  const hasPopulationFilter = Boolean(
    filters.service || filters.assignee !== undefined || filters.urgency || filters.search
  );
  const filteredMetricQuery = React.useMemo(() => {
    const params = new URLSearchParams();
    if (filters.service) params.set('service', filters.service);
    if (filters.assignee !== undefined) {
      params.set('assignee', filters.assignee === '' ? 'unassigned' : filters.assignee);
    }
    if (filters.urgency) params.set('urgency', filters.urgency);
    if (filters.search) params.set('search', filters.search);
    return params.toString();
  }, [filters.assignee, filters.search, filters.service, filters.urgency]);
  React.useEffect(() => {
    if (!hasPopulationFilter || !recentIncidents?.length) return;
    const controller = new AbortController();
    void fetch(`/api/dashboard/metrics?${filteredMetricQuery}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(response => (response.ok ? response.json() : Promise.reject(new Error('unavailable'))))
      .then((payload: { data: NonNullable<typeof liveMetrics> }) =>
        setFilteredLiveMetrics(payload.data)
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [filteredMetricQuery, hasPopulationFilter, recentIncidents, liveMetrics]);
  const applicableLiveMetrics = hasPopulationFilter ? filteredLiveMetrics : liveMetrics;
  currentTriggeredCount = applicableLiveMetrics?.open ?? currentTriggeredCount;
  currentAcknowledgedCount = applicableLiveMetrics?.acknowledged ?? currentAcknowledgedCount;
  currentActiveCount =
    applicableLiveMetrics?.active ?? currentTriggeredCount + currentAcknowledgedCount;
  allActiveIncidentsCount = applicableLiveMetrics?.active ?? allActiveIncidentsCount;
  currentSnoozedCount = applicableLiveMetrics?.snoozed ?? currentSnoozedCount;
  currentSuppressedCount = applicableLiveMetrics?.suppressed ?? currentSuppressedCount;
  currentMutedCount = currentSnoozedCount + currentSuppressedCount;
  unassignedCount = applicableLiveMetrics?.unassigned ?? unassignedCount;
  currentCriticalCount = applicableLiveMetrics?.highUrgency ?? currentCriticalCount;
  if (visibilityScope !== 'NONE' && (applicableLiveMetrics?.highUrgency ?? 0) > 0) {
    systemStatus = {
      label: 'CRITICAL',
      color: 'var(--color-danger)',
      bg: 'rgba(239, 68, 68, 0.1)',
    };
  } else if (visibilityScope !== 'NONE' && applicableLiveMetrics && currentActiveCount > 0) {
    systemStatus = {
      label: 'DEGRADED',
      color: 'var(--color-warning)',
      bg: 'rgba(245, 158, 11, 0.1)',
    };
  } else if (visibilityScope !== 'NONE' && applicableLiveMetrics) {
    systemStatus = {
      label: 'OPERATIONAL',
      color: 'var(--color-success)',
      bg: 'rgba(34, 197, 94, 0.1)',
    };
  }
  // Determine status badge color
  const statusVariant =
    systemStatus.label === 'CRITICAL'
      ? 'danger'
      : systemStatus.label === 'DEGRADED'
        ? 'warning'
        : systemStatus.label === 'OPERATIONAL'
          ? 'success'
          : 'neutral';
  const dataAsOfLabel = metricsAsOf
    ? new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        timeZone: userTimeZone,
        timeZoneName: 'short',
      }).format(new Date(metricsAsOf))
    : null;

  return (
    <div
      data-testid="command-center"
      className="relative overflow-hidden rounded-xl border border-zinc-800/80 bg-gradient-to-b from-[#121216] to-[#09090b] text-slate-100 p-3 md:p-4 shadow-xl ring-1 ring-white/5"
    >
      {/* Header */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-start md:justify-between gap-3 md:gap-6 mb-3">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-extrabold tracking-tight text-white">
              Command Center
            </h1>
            <LiveClock timeZone={userTimeZone} />
          </div>

          {/* System Status */}
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <span className="font-medium">
              {visibilityScope === 'GLOBAL' ? 'System Status:' : 'Your Operational Scope:'}
            </span>
            <Badge
              variant={statusVariant}
              size="xs"
              className={cn('font-bold uppercase tracking-wide border')}
              style={
                {
                  '--status-color-rgb':
                    systemStatus.label === 'CRITICAL'
                      ? '239, 68, 68'
                      : systemStatus.label === 'DEGRADED'
                        ? '245, 158, 11'
                        : '34, 197, 94',
                } as React.CSSProperties
              }
            >
              {systemStatus.label}
            </Badge>
            {allActiveIncidentsCount > 0 &&
              (activeHref ? (
                <Link
                  href={activeHref}
                  className="text-xs text-slate-300 underline-offset-2 hover:text-white hover:underline"
                >
                  ({allActiveIncidentsCount} active)
                </Link>
              ) : (
                <span className="text-xs text-slate-300">({allActiveIncidentsCount} active)</span>
              ))}
            <Badge
              variant="outline"
              size="xs"
              className="text-xs text-slate-300 border-zinc-700/80 bg-zinc-900/70"
            >
              Range {rangeLabel}
            </Badge>
            {metricDataState === 'unavailable' ? (
              <Badge variant="warning" size="xs" className="text-xs">
                Metric data unavailable
              </Badge>
            ) : dataAsOfLabel ? (
              <span className="text-xs text-slate-400">Updated {dataAsOfLabel}</span>
            ) : null}
            {/* Retention Warning */}
            {isClipped && (
              <Badge
                variant="warning"
                size="xs"
                className="text-xs flex items-center gap-1.5 cursor-help"
                title={`Data limited to ${retentionDays} days by retention policy`}
              >
                <AlertCircle className="h-3 w-3" />
                <span>Retention Limit: {retentionDays}d</span>
              </Badge>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <DashboardRefresh />
          {canExport && (
            <DashboardExport
              incidents={incidents}
              filters={filters}
              metrics={{
                totalActive: currentActiveCount,
                totalTriggered: currentTriggeredCount,
                totalMuted: currentMutedCount,
                totalSnoozed: currentSnoozedCount,
                totalSuppressed: currentSuppressedCount,
                totalResolved: metricsResolvedCount,
                totalAcknowledged: currentAcknowledgedCount,
                unassigned: unassignedCount,
                dataState: metricDataState,
              }}
            />
          )}
        </div>
      </div>

      <div
        className="relative z-10 grid grid-cols-6 sm:grid-cols-4 xl:grid-cols-7 gap-2 md:gap-3"
        data-testid="command-center-counters"
      >
        <div className="col-span-3 sm:col-span-1">
          <MetricCard
            label="TRIGGERED"
            value={currentTriggeredCount}
            rangeLabel={metricScopeLabel('current')}
            href={triggeredHref}
            variant="hero"
            density="compact"
            tone={currentTriggeredCount > 0 ? 'rose' : 'default'}
            tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.activeIncidents)}
            dataState={metricDataState}
            asOf={metricsAsOf}
          />
        </div>
        <div className="col-span-3 sm:col-span-1">
          <MetricCard
            label="CRITICAL"
            value={currentCriticalCount}
            rangeLabel={metricScopeLabel('current')}
            href={criticalHref}
            variant="hero"
            density="compact"
            tone={currentCriticalCount > 0 ? 'rose' : 'default'}
            tooltip="Active (triggered or acknowledged) high-urgency incidents."
            dataState={metricDataState}
            asOf={metricsAsOf}
          />
        </div>
        <div className="col-span-3 sm:col-span-1">
          <MetricCard
            label="ACKNOWLEDGED"
            value={currentAcknowledgedCount}
            rangeLabel={metricScopeLabel('current')}
            href={acknowledgedHref}
            variant="hero"
            density="compact"
            tone={currentAcknowledgedCount > 0 ? 'amber' : 'default'}
            tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.activeIncidents)}
            dataState={metricDataState}
            asOf={metricsAsOf}
          />
        </div>
        <div className="col-span-3 sm:col-span-1">
          <MetricCard
            label="UNASSIGNED"
            value={unassignedCount}
            rangeLabel={metricScopeLabel('current')}
            variant="hero"
            density="compact"
            tone={unassignedCount > 0 ? 'amber' : 'default'}
            href={unassignedHref}
            tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.unassignedActive)}
            dataState={metricDataState}
            asOf={metricsAsOf}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <MetricCard
            label="MUTED"
            value={currentMutedCount}
            rangeLabel={metricScopeLabel('current')}
            description={`${currentSnoozedCount.toLocaleString()} Snoozed · ${currentSuppressedCount.toLocaleString()} Suppressed`}
            href={mutedHref}
            variant="hero"
            density="compact"
            tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.mutedIncidents)}
            dataState={metricDataState}
            asOf={metricsAsOf}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <MetricCard
            label="TOTAL"
            value={totalInRange}
            rangeLabel={metricScopeLabel('selected_period', rangeLabel)}
            variant="hero"
            density="compact"
            href={totalHref}
            tooltip={metricDefinitionTooltip(
              INCIDENT_METRIC_DEFINITIONS.totalIncidents,
              rangeLabel
            )}
            dataState={metricDataState}
            asOf={metricsAsOf}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <MetricCard
            label="RESOLVED"
            value={metricsResolvedCount}
            rangeLabel={metricScopeLabel('selected_period', rangeLabel)}
            variant="hero"
            density="compact"
            tone={metricsResolvedCount > 0 ? 'emerald' : 'default'}
            href={resolvedHref}
            tooltip={metricDefinitionTooltip(
              INCIDENT_METRIC_DEFINITIONS.resolvedIncidents,
              rangeLabel
            )}
            dataState={metricDataState}
            asOf={metricsAsOf}
          />
        </div>
      </div>
    </div>
  );
}
