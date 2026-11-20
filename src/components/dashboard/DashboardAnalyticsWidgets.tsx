'use client';

import { IncidentHeatmapWidget } from '@/components/dashboard/widgets/IncidentHeatmapWidget';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { useDashboardAnalytics } from './DashboardAnalyticsProvider';

export function DashboardAnalyticsHeatmap() {
  const { data, state } = useDashboardAnalytics();
  if (!data) {
    return state === 'loading' ? (
      <div
        role="status"
        aria-busy="true"
        className="rounded-lg border border-border bg-card p-4 shadow-sm"
      >
        <span className="sr-only">Loading incident history…</span>
        <Skeleton aria-hidden className="mb-3 h-4 w-32" />
        <Skeleton aria-hidden className="h-28 w-full" />
      </div>
    ) : (
      <p className="p-3 text-sm text-muted-foreground" role="status">
        Incident history is temporarily unavailable.
      </p>
    );
  }
  return <IncidentHeatmapWidget data={data.heatmapData} year={new Date().getFullYear()} />;
}
