'use client';

import { useSyncExternalStore, memo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { SerializedSLAMetrics } from '@/lib/sla';

const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

function useIsMounted() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Import chart components directly
import LineChart from '@/components/analytics/LineChart';
import BarChart from '@/components/analytics/BarChart';
import PieChart from '@/components/analytics/PieChart';
import HeatmapCalendar from '@/components/analytics/HeatmapCalendar';

export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'mttaVsMttr' | 'slaCompliance' | 'heatmap';
export type ChartDatum = Record<string, string | number | null | undefined>;

interface ChartWidgetProps {
  metricKey: string;
  metrics: SerializedSLAMetrics;
  config?: {
    chartType?: ChartType;
    title?: string;
    color?: string;
    height?: number;
    showLegend?: boolean;
    showTrend?: boolean;
    [key: string]: unknown;
  };
}

// Color palette for charts
const CHART_COLORS = {
  primary: '#8b5cf6',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',
  secondary: '#64748b',
};

const PIE_COLORS = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6b7280'];

const ChartWidget = memo(function ChartWidget({
  metricKey,
  metrics,
  config = {},
}: ChartWidgetProps) {
  const isMounted = useIsMounted();

  const {
    chartType = 'line',
    color = CHART_COLORS.primary,
    height = 160,
    showLegend = false,
    showTrend = true,
  } = config;

  // Map metricKey to chart data
  const chartData = getChartData(metricKey, metrics, config);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <span className="text-sm">No chart data available</span>
      </div>
    );
  }

  // Calculate trend only for temporal/time-series charts, not categorical or heatmap
  const isCategorical =
    chartType === 'pie' ||
    chartType === 'heatmap' ||
    metricKey === 'urgencyMix' ||
    metricKey === 'statusMix' ||
    metricKey === 'heatmapData' ||
    metricKey === 'incidentsByUrgency' ||
    metricKey === 'incidentsByStatus' ||
    metricKey === 'topServicesChart' ||
    metricKey === 'assigneeLoadChart';

  const trend = isCategorical ? null : calculateTrend(chartData);

  // Show loading state during hydration
  if (!isMounted) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Trend indicator */}
      {showTrend && trend !== null && (
        <div className="flex items-center gap-1 mb-2">
          {trend > 0 ? (
            <TrendingUp className="h-3 w-3 text-green-500" />
          ) : trend < 0 ? (
            <TrendingDown className="h-3 w-3 text-red-500" />
          ) : (
            <Minus className="h-3 w-3 text-muted-foreground" />
          )}
          <span
            className={`text-xs ${
              trend > 0 ? 'text-green-500' : trend < 0 ? 'text-red-500' : 'text-muted-foreground'
            }`}
          >
            {trend > 0 ? '+' : ''}
            {trend.toFixed(1)}% vs previous
          </span>
        </div>
      )}

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {chartType === 'heatmap' ? (
          <div className="h-full w-full overflow-hidden flex items-center justify-center p-1">
            <HeatmapCalendar
              data={(metrics.heatmapData || []).map(d => ({ date: d.date, count: d.count }))}
              fitWidth={true}
              days={(metrics.heatmapData || []).length || 30}
            />
          </div>
        ) : chartType === 'pie' ? (
          <div className="h-full flex items-center justify-center">
            <PieChart
              data={chartData.map((d, i) => ({
                label: String(d.name || d.label || ''),
                value: typeof d.value === 'number' ? d.value : 0,
                color: PIE_COLORS[i % PIE_COLORS.length],
              }))}
              size={Math.min(height, 160)}
              showLegend={showLegend}
            />
          </div>
        ) : chartType === 'mttaVsMttr' || chartType === 'slaCompliance' ? (
          <LineChart
            data={chartData}
            lines={[
              {
                key: 'value',
                color: CHART_COLORS.primary,
                label: chartType === 'mttaVsMttr' ? 'MTTA' : 'Ack Compliance',
              },
              {
                key: 'value2',
                color: CHART_COLORS.success,
                label: chartType === 'mttaVsMttr' ? 'MTTR' : 'Resolve Compliance',
              },
            ]}
            height={height}
            showLegend={showLegend || true}
          />
        ) : chartType === 'bar' ? (
          <BarChart
            data={chartData.map((d, i) => ({
              key: String(i),
              label: String(d.label || d.name || ''),
              count: typeof d.value === 'number' ? d.value : null,
            }))}
            maxValue={
              Math.max(
                0,
                ...chartData.flatMap(d => (typeof d.value === 'number' ? [d.value] : []))
              ) * 1.1
            }
            height={height}
            showValues={chartData.length <= 7}
            showLabels={true}
            labelEvery={Math.ceil(chartData.length / 7)}
          />
        ) : (
          <LineChart
            data={chartData.map(d => ({
              label: String(d.label || d.name || ''),
              value: typeof d.value === 'number' ? d.value : null,
            }))}
            lines={[{ key: 'value', color, label: metricKey }]}
            height={height}
            showLegend={showLegend}
          />
        )}
      </div>
    </div>
  );
});

export default ChartWidget;

// Extract chart data from metrics based on metricKey
export function getChartData(
  metricKey: string,
  metrics: SerializedSLAMetrics,
  config?: Record<string, unknown>
): ChartDatum[] {
  switch (metricKey) {
    case 'incidentTrend':
    case 'trendSeries':
      if (config?.chartType === 'mttaVsMttr') {
        return (metrics.trendSeries || []).map(d => ({
          label: d.label,
          value: d.mtta ?? null,
          value2: d.mttr ?? null,
        }));
      }
      if (config?.chartType === 'slaCompliance') {
        return (metrics.trendSeries || []).map(d => ({
          label: d.label,
          value: d.ackCompliance ?? null,
          value2: d.resolveCompliance ?? null,
        }));
      }
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.count,
      }));

    case 'heatmapData':
      return (metrics.heatmapData || []).map(d => ({
        label: d.date,
        value: d.count,
      }));

    case 'incidentsByUrgency':
    case 'urgencyDistribution':
    case 'urgencyMix':
      return (metrics.urgencyMix || []).map(d => ({
        name: d.urgency.charAt(0).toUpperCase() + d.urgency.slice(1),
        label: d.urgency.charAt(0).toUpperCase() + d.urgency.slice(1),
        value: d.count,
      }));

    case 'incidentsByStatus':
    case 'statusDistribution':
    case 'statusMix':
      return (metrics.statusMix || []).map(d => ({
        name: d.status.charAt(0).toUpperCase() + d.status.slice(1).toLowerCase(),
        label: d.status.charAt(0).toUpperCase() + d.status.slice(1).toLowerCase(),
        value: d.count,
      }));

    case 'responseTimesTrend':
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.mtta ?? null,
      }));

    case 'resolutionTimesTrend':
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.mttr ?? null,
      }));

    case 'slaComplianceTrend':
    case 'ackComplianceTrend':
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.ackCompliance ?? null,
      }));

    case 'topServicesChart':
      return (metrics.topServices || []).slice(0, 10).map(d => ({
        label: d.name,
        value: d.count,
      }));

    case 'assigneeLoadChart':
      return (metrics.assigneeLoad || []).slice(0, 10).map(d => ({
        label: d.name,
        value: d.count,
      }));

    default:
      return [];
  }
}

// Calculate percentage trend from first half to second half of data
export function calculateTrend(data: Array<Record<string, unknown>>): number | null {
  if (data.length < 2) return null;

  const validValues = data
    .map(d => (typeof d.value === 'number' ? d.value : null))
    .filter((v): v is number => v !== null);

  if (validValues.length < 2) return null;

  const mid = Math.floor(validValues.length / 2);
  const firstHalf = validValues.slice(0, mid);
  const secondHalf = validValues.slice(mid);

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / (firstHalf.length || 1);
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / (secondHalf.length || 1);

  if (firstAvg === 0) return secondAvg > 0 ? 100 : 0;
  return ((secondAvg - firstAvg) / firstAvg) * 100;
}
