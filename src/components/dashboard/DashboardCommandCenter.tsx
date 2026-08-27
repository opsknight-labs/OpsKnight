'use client';

import React, { Suspense } from 'react';
import DashboardRefresh from '../DashboardRefresh';
import DashboardExport from '../DashboardExport';
import MetricCard from './MetricCard';
import LiveClock from './LiveClock';
import { Badge } from '@/components/ui/shadcn/badge';
import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

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

  return (
    <div className="relative overflow-hidden rounded-lg bg-gradient-to-r from-primary to-primary/80 text-primary-foreground p-4 md:p-6 mb-6 shadow-lg">
      {/* Header */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-start md:justify-between gap-4 md:gap-6 mb-6">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-primary-foreground">
              Command Center
            </h1>
            <LiveClock timeZone={userTimeZone} />
          </div>

          {/* System Status */}
          <div className="flex flex-wrap items-center gap-2 text-sm text-primary-foreground/80">
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
              <span className="text-xs text-primary-foreground/80">
                ({allActiveIncidentsCount} active)
              </span>
            )}
            <Badge
              variant="outline"
              size="xs"
              className="text-xs text-primary-foreground/80 border-white/30"
            >
              Range {rangeLabel}
            </Badge>
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
          <Suspense fallback={<div className="h-9 w-20 bg-white/20 rounded-md animate-pulse" />}>
            <DashboardRefresh />
          </Suspense>
          <Suspense fallback={<div className="h-9 w-24 bg-white/20 rounded-md animate-pulse" />}>
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
              }}
            />
          </Suspense>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 md:gap-4">
        <MetricCard label="TOTAL" value={totalInRange} rangeLabel={rangeLabel} variant="hero" />
        <MetricCard
          label="ACTIVE"
          value={currentActiveCount}
          rangeLabel="(CURRENT)"
          description={`${currentTriggeredCount.toLocaleString()} Triggered · ${currentAcknowledgedCount.toLocaleString()} Acknowledged`}
          href="/incidents?filter=all_open"
          variant="hero"
        />
        <MetricCard
          label="MUTED"
          value={currentMutedCount}
          rangeLabel="(CURRENT)"
          description={`${currentSnoozedCount.toLocaleString()} Snoozed · ${currentSuppressedCount.toLocaleString()} Suppressed`}
          href="/incidents?filter=muted"
          variant="hero"
        />
        <MetricCard
          label="RESOLVED"
          value={metricsResolvedCount}
          rangeLabel={rangeLabel}
          variant="hero"
        />
        <MetricCard
          label="UNASSIGNED"
          value={unassignedCount}
          rangeLabel="(CURRENT)"
          variant="hero"
        />
      </div>
    </div>
  );
}
