'use client';

import { ImpactMetrics } from './PostmortemImpactInput';
import BarChart from '@/components/analytics/BarChart';
import PieChart from '@/components/analytics/PieChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { cn } from '@/lib/utils';

interface PostmortemImpactMetricsProps {
  metrics: ImpactMetrics;
}

const METRIC_COLORS = {
  usersAffected: { color: 'text-blue-500', border: 'border-blue-500/40' },
  downtime: { color: 'text-amber-500', border: 'border-amber-500/40' },
  errorRate: { color: 'text-red-500', border: 'border-red-500/40' },
  slaBreaches: { color: 'text-red-600', border: 'border-red-600/40' },
};

export default function PostmortemImpactMetrics({ metrics }: PostmortemImpactMetricsProps) {
  if (!metrics || Object.keys(metrics).length === 0) {
    return (
      <Card className="bg-gradient-to-br from-white to-slate-50">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No impact metrics recorded</p>
        </CardContent>
      </Card>
    );
  }

  const metricCards = [
    metrics.usersAffected && {
      label: 'Users Affected',
      value: metrics.usersAffected.toLocaleString(),
      colorClass: 'text-blue-500',
      borderClass: 'border-blue-500/40',
    },
    metrics.downtimeMinutes && {
      label: 'Downtime',
      value: `${Math.floor(metrics.downtimeMinutes / 60)}h ${metrics.downtimeMinutes % 60}m`,
      colorClass: 'text-amber-500',
      borderClass: 'border-amber-500/40',
    },
    metrics.errorRate && {
      label: 'Error Rate',
      value: `${metrics.errorRate.toFixed(1)}%`,
      colorClass: 'text-red-500',
      borderClass: 'border-red-500/40',
    },
    metrics.slaBreaches && {
      label: 'SLA Breaches',
      value: metrics.slaBreaches.toString(),
      colorClass: 'text-red-600',
      borderClass: 'border-red-600/40',
    },
  ].filter(Boolean) as Array<{
    label: string;
    value: string;
    colorClass: string;
    borderClass: string;
  }>;

  const servicesData =
    metrics.servicesAffected && metrics.servicesAffected.length > 0
      ? metrics.servicesAffected.map((service, index) => ({
          key: `service-${index}`,
          label: service,
          count: 1,
        }))
      : [];

  const impactDistribution = [
    metrics.usersAffected && { label: 'Users', value: metrics.usersAffected, color: '#3b82f6' },
    metrics.downtimeMinutes && {
      label: 'Downtime (min)',
      value: metrics.downtimeMinutes,
      color: '#f59e0b',
    },
    metrics.errorRate && { label: 'Error Rate', value: metrics.errorRate * 10, color: '#ef4444' },
  ].filter(Boolean) as Array<{ label: string; value: number; color: string }>;

  return (
    <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
      <CardHeader>
        <CardTitle className="text-xl">Impact Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Key Metrics Cards */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-6">
          {metricCards.map((card, index) => (
            <div
              key={index}
              className={cn('p-4 bg-white rounded-md shadow-sm border-2', card.borderClass)}
            >
              <div className="text-xs text-muted-foreground mb-1">{card.label}</div>
              <div className={cn('text-2xl font-bold', card.colorClass)}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-2 gap-4">
          {servicesData.length > 0 && (
            <div className="p-4 bg-white border border-slate-200 rounded-md">
              <h4 className="text-base font-semibold mb-3">Services Affected</h4>
              <BarChart data={servicesData} maxValue={1} height={120} showValues={true} />
            </div>
          )}

          {impactDistribution.length > 0 && (
            <div className="p-4 bg-white border border-slate-200 rounded-md">
              <h4 className="text-base font-semibold mb-3">Impact Distribution</h4>
              <PieChart data={impactDistribution} size={150} showLegend={true} />
            </div>
          )}
        </div>

        {/* Additional Metrics */}
        {(metrics.apiErrors || metrics.performanceDegradation || metrics.revenueImpact) && (
          <div className="mt-4 p-4 bg-white border border-slate-200 rounded-md">
            <h4 className="text-base font-semibold mb-3">Additional Metrics</h4>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
              {metrics.apiErrors && (
                <div>
                  <div className="text-xs text-muted-foreground">API Errors</div>
                  <div className="text-lg font-semibold">{metrics.apiErrors.toLocaleString()}</div>
                </div>
              )}
              {metrics.performanceDegradation && (
                <div>
                  <div className="text-xs text-muted-foreground">Performance Impact</div>
                  <div className="text-lg font-semibold text-red-500">
                    {metrics.performanceDegradation.toFixed(1)}%
                  </div>
                </div>
              )}
              {metrics.revenueImpact && (
                <div>
                  <div className="text-xs text-muted-foreground">Revenue Impact</div>
                  <div className="text-lg font-semibold text-red-600">
                    ${metrics.revenueImpact.toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
