'use client';

import React, { Suspense } from 'react';
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

type SystemStatus = {
  label: string;
  color: string;
  bg: string;
};

type DashboardCommandCenterProps = {
  systemStatus: SystemStatus;
  allActiveIncidentsCount: number;
  totalInRange: number;
  currentActiveCount: number;
  currentTriggeredCount: number;
  currentMutedCount: number;
  currentSnoozedCount: number;
  currentSuppressedCount: number;
  metricsResolvedCount: number;
  unassignedCount: number;
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
};

export default function DashboardCommandCenter({
  systemStatus,
  allActiveIncidentsCount,
  totalInRange,
  currentActiveCount,
  currentTriggeredCount,
  currentMutedCount,
  currentSnoozedCount,
  currentSuppressedCount,
  metricsResolvedCount,
  unassignedCount,
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
}: DashboardCommandCenterProps) {
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
    <div className="relative overflow-hidden rounded-xl border border-slate-800/90 bg-[#0b1120] text-slate-100 p-4 md:p-6 mb-6 shadow-xl ring-1 ring-white/5">
      {/* Header */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-start md:justify-between gap-4 md:gap-6 mb-6">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              Command Center
            </h1>
            <LiveClock timeZone={userTimeZone} />
          </div>

          {/* System Status */}
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <span className="font-medium">System Status:</span>
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
            {allActiveIncidentsCount > 0 && (
              <span className="text-xs text-slate-300">({allActiveIncidentsCount} active)</span>
            )}
            <Badge
              variant="outline"
              size="xs"
              className="text-xs text-slate-300 border-slate-700/80 bg-slate-900/70"
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
          <Suspense
            fallback={<div className="h-8 w-20 bg-slate-800/60 rounded-lg animate-pulse" />}
          >
            <DashboardRefresh />
          </Suspense>
          <Suspense
            fallback={<div className="h-8 w-24 bg-slate-800/60 rounded-lg animate-pulse" />}
          >
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
          </Suspense>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4">
        <MetricCard
          label="TOTAL"
          value={totalInRange}
          rangeLabel={metricScopeLabel('selected_period', rangeLabel)}
          variant="hero"
          href={totalHref}
          tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.totalIncidents, rangeLabel)}
          dataState={metricDataState}
          asOf={metricsAsOf}
        />
        <MetricCard
          label="ACTIVE"
          value={currentActiveCount}
          rangeLabel={metricScopeLabel('current')}
          description={`${currentTriggeredCount.toLocaleString()} Triggered · ${currentAcknowledgedCount.toLocaleString()} Acknowledged`}
          href={activeHref}
          variant="hero"
          tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.activeIncidents)}
          dataState={metricDataState}
          asOf={metricsAsOf}
        />
        <MetricCard
          label="MUTED"
          value={currentMutedCount}
          rangeLabel={metricScopeLabel('current')}
          description={`${currentSnoozedCount.toLocaleString()} Snoozed · ${currentSuppressedCount.toLocaleString()} Suppressed`}
          href={mutedHref}
          variant="hero"
          tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.mutedIncidents)}
          dataState={metricDataState}
          asOf={metricsAsOf}
        />
        <MetricCard
          label="RESOLVED"
          value={metricsResolvedCount}
          rangeLabel={metricScopeLabel('selected_period', rangeLabel)}
          variant="hero"
          href={resolvedHref}
          tooltip={metricDefinitionTooltip(
            INCIDENT_METRIC_DEFINITIONS.resolvedIncidents,
            rangeLabel
          )}
          dataState={metricDataState}
          asOf={metricsAsOf}
        />
        <MetricCard
          label="UNASSIGNED"
          value={unassignedCount}
          rangeLabel={metricScopeLabel('current')}
          variant="hero"
          href={unassignedHref}
          tooltip={metricDefinitionTooltip(INCIDENT_METRIC_DEFINITIONS.unassignedActive)}
          dataState={metricDataState}
          asOf={metricsAsOf}
        />
      </div>
    </div>
  );
}
