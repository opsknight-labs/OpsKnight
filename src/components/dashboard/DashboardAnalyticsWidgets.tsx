'use client';

import { TrendingUp, Users } from 'lucide-react';
import { IncidentHeatmapWidget } from '@/components/dashboard/widgets/IncidentHeatmapWidget';
import CompactPerformanceMetrics from '@/components/dashboard/compact/CompactPerformanceMetrics';
import CompactTeamLoad from '@/components/dashboard/compact/CompactTeamLoad';
import SidebarWidget, { WIDGET_ICON_BG } from '@/components/dashboard/SidebarWidget';
import { useDashboardAnalytics } from './DashboardAnalyticsProvider';

function AnalyticsStatus({ label }: { label: string }) {
  return <p className="p-3 text-sm text-muted-foreground" role="status">{label}</p>;
}

export function DashboardAnalyticsHeatmap() {
  const { data, state } = useDashboardAnalytics();
  if (!data) return <AnalyticsStatus label={state === 'loading' ? 'Loading incident history…' : 'Incident history is temporarily unavailable.'} />;
  return <IncidentHeatmapWidget data={data.heatmapData} year={new Date().getFullYear()} />;
}

export function DashboardPerformanceAnalytics() {
  const { data, state } = useDashboardAnalytics();
  return (
    <SidebarWidget title="Performance" iconBg={WIDGET_ICON_BG.blue} icon={<TrendingUp className="h-4 w-4" />}>
      {data ? (
        <>
          <CompactPerformanceMetrics
            mtta={data.mtta}
            mttr={data.mttr}
            ackSlaRate={data.ackCompliance}
            resolveSlaRate={data.resolveCompliance}
          />
          <p className="px-3 pb-2 text-[10px] text-muted-foreground">
            Updated {new Date(data.asOf).toLocaleTimeString()}{state === 'updating' ? ' · updating…' : ''}
          </p>
        </>
      ) : <AnalyticsStatus label={state === 'loading' ? 'Loading performance…' : 'Performance analytics are temporarily unavailable.'} />}
    </SidebarWidget>
  );
}

export function DashboardTeamLoadAnalytics() {
  const { data, state } = useDashboardAnalytics();
  return (
    <SidebarWidget title="Team Load" iconBg={WIDGET_ICON_BG.green} icon={<Users className="h-4 w-4" />}>
      {data ? <CompactTeamLoad assigneeLoad={data.assigneeLoad} /> : <AnalyticsStatus label={state === 'loading' ? 'Loading team load…' : 'Team-load analytics are temporarily unavailable.'} />}
    </SidebarWidget>
  );
}
