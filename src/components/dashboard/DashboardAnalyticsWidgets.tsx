'use client';

import { IncidentHeatmapWidget } from '@/components/dashboard/widgets/IncidentHeatmapWidget';
import { useDashboardAnalytics } from './DashboardAnalyticsProvider';

function AnalyticsStatus({ label }: { label: string }) {
  return <p className="p-3 text-sm text-muted-foreground" role="status">{label}</p>;
}

export function DashboardAnalyticsHeatmap() {
  const { data, state } = useDashboardAnalytics();
  if (!data) return <AnalyticsStatus label={state === 'loading' ? 'Loading incident history…' : 'Incident history is temporarily unavailable.'} />;
  return <IncidentHeatmapWidget data={data.heatmapData} year={new Date().getFullYear()} />;
}
