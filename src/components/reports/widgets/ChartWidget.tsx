'use client';

import { useState, useEffect, memo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { SerializedSLAMetrics } from '@/lib/sla';

// Import chart components directly
import LineChart from '@/components/analytics/LineChart';
import BarChart from '@/components/analytics/BarChart';

type ChartType = 'line' | 'bar' | 'area';

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

const ChartWidget = memo(function ChartWidget({
  metricKey,
  metrics,
  config = {},
}: ChartWidgetProps) {
  const [isMounted, setIsMounted] = useState(false);

  // Handle client-side mounting to avoid hydration issues
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const {
    chartType = 'line',
    color = CHART_COLORS.primary,
    height = 160,
    showLegend = false,
    showTrend = true,
  } = config;

  // Map metricKey to chart data
  const chartData = getChartData(metricKey, metrics);

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
        {chartType === 'bar' ? (
          <BarChart
            data={chartData.map((d, i) => ({
              key: String(i),
              label: d.label || '',
              count: d.value || 0,
            }))}
            maxValue={Math.max(...chartData.map(d => d.value || 0)) * 1.1}
            height={height}
            showValues={chartData.length <= 7}
            showLabels={true}
            labelEvery={Math.ceil(chartData.length / 7)}
          />
        ) : (
          <LineChart
            data={chartData.map(d => ({
              label: d.label || '',
              value: d.value || 0,
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
function getChartData(
  metricKey: string,
  metrics: SerializedSLAMetrics
): Array<{ label: string; value: number }> {
  switch (metricKey) {
    case 'incidentTrend':
    case 'trendSeries':
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
        label: d.urgency.charAt(0).toUpperCase() + d.urgency.slice(1),
        value: d.count,
      }));

    case 'incidentsByStatus':
    case 'statusDistribution':
    case 'statusMix':
      return (metrics.statusMix || []).map(d => ({
        label: d.status.charAt(0).toUpperCase() + d.status.slice(1).toLowerCase(),
        value: d.count,
      }));

    case 'responseTimesTrend':
      // Create trend data from trendSeries
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.mtta || 0,
      }));

    case 'resolutionTimesTrend':
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.mttr || 0,
      }));

    case 'slaComplianceTrend':
    case 'ackComplianceTrend':
      return (metrics.trendSeries || []).map(d => ({
        label: d.label,
        value: d.ackCompliance || 0,
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
function calculateTrend(data: Array<{ value: number }>): number | null {
  if (data.length < 2) return null;

  const midpoint = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, midpoint);
  const secondHalf = data.slice(midpoint);

  const firstAvg = firstHalf.reduce((sum, d) => sum + d.value, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, d) => sum + d.value, 0) / secondHalf.length;

  if (firstAvg === 0) return secondAvg > 0 ? 100 : 0;
  return ((secondAvg - firstAvg) / firstAvg) * 100;
}
