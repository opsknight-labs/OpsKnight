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

type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'mttaVsMttr' | 'slaCompliance' | 'heatmap';

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
    [key: string]: any;
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

  // Calculate trend
  const trend = calculateTrend(chartData);

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
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-muted rounded-lg p-4">
             <span className="text-sm font-medium">Heatmap visualization</span>
             <span className="text-xs mt-1">Data points: {chartData.length}</span>
             {/* TODO: Implement HeatmapCalendar component */}
          </div>
        ) : chartType === 'pie' ? (
          <div className="h-full flex items-center justify-center">
            <PieChart
              data={chartData.map((d, i) => ({
                label: d.name || d.label || '',
                value: d.value ?? 0,
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
              label: d.label || d.name || '',
              count: d.value,
            }))}
            maxValue={
              Math.max(0, ...chartData.flatMap(d => (d.value === null ? [] : [d.value]))) * 1.1
            }
            height={height}
            showValues={chartData.length <= 7}
            showLabels={true}
            labelEvery={Math.ceil(chartData.length / 7)}
          />
        ) : (
          <LineChart
            data={chartData.map(d => ({
              label: d.label || d.name || '',
              value: d.value,
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
): Array<any> {
  switch (metricKey) {
    case 'incidentTrend':
    case 'trendSeries':
      if (config?.chartType === 'mttaVsMttr') {
        return (metrics.trendSeries || []).map(d => ({
          label: d.label,
          value: d.mtta ?? 0,
          value2: d.mttr ?? 0,
        }));
      }
      if (config?.chartType === 'slaCompliance') {
        return (metrics.trendSeries || []).map(d => ({
          label: d.label,
          value: d.ackCompliance ?? 0,
          value2: d.resolveCompliance ?? 0,
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
      // Create trend data from trendSeries
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.mtta,
      }));

    case 'resolutionTimesTrend':
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.mttr,
      }));

    case 'slaComplianceTrend':
    case 'ackComplianceTrend':
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.ackCompliance,
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
      // Try to use trendSeries as fallback
      if (metrics.trendSeries && metrics.trendSeries.length > 0) {
        return metrics.trendSeries.map(d => ({
          label: d.label,
          value: d.count,
        }));
      }
      return [];
  }
}

// Calculate trend percentage
export function calculateTrend(data: Array<{ value: number | null }>): number | null {
  const evaluable = data.filter(
    (entry): entry is { value: number } => typeof entry.value === 'number'
  );
  if (evaluable.length < 2) return null;

  const midpoint = Math.floor(evaluable.length / 2);
  const firstHalf = evaluable.slice(0, midpoint);
  const secondHalf = evaluable.slice(midpoint);

  const firstAvg = firstHalf.reduce((sum, d) => sum + d.value, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, d) => sum + d.value, 0) / secondHalf.length;

  if (firstAvg === 0) return secondAvg > 0 ? 100 : 0;
  return ((secondAvg - firstAvg) / firstAvg) * 100;
}
