'use client';

import { memo } from 'react';
import { formatTimeMinutesMs } from '@/lib/time-format';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { getMetricDefinition } from '@/lib/metric-contract';

type MetricWidgetProps = {
  value: number | null;
  metricKey: string;
  previousValue?: number | null;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  showTrend?: boolean;
};

/**
 * MetricWidget - Displays a single metric value with optional trend indicator
 *
 * Automatically formats values based on the metric type:
 * - Time metrics: displayed as duration (e.g., "1h 30m")
 * - Percentage metrics: displayed with % symbol
 * - Count metrics: displayed as numbers
 */
const MetricWidget = memo(function MetricWidget({
  value,
  metricKey,
  previousValue,
  variant = 'default',
  showTrend = true,
}: MetricWidgetProps) {
  // Determine if this is a time-based metric
  const isTimeMetric = ['mttr', 'mttd', 'mtta', 'mtbfMs'].includes(metricKey);

  // Determine if this is a percentage metric
  const isPercentMetric =
    metricKey.toLowerCase().includes('rate') ||
    metricKey.toLowerCase().includes('compliance') ||
    metricKey.toLowerCase().includes('percent');

  // Format the value based on metric type
  const formatValue = (val: number | null): string => {
    if (val === null || val === undefined) return '--';

    if (isTimeMetric) {
      // Convert minutes to ms for formatting, or if it's mtbfMs it's already in ms
      const ms = metricKey === 'mtbfMs' ? val : val * 60 * 1000;
      return formatTimeMinutesMs(ms);
    }

    if (isPercentMetric) {
      return `${val.toFixed(1)}%`;
    }

    // Count metrics
    return val.toLocaleString();
  };

  // Calculate trend (delta)
  const getDelta = (): number | null => {
    if (
      value === null ||
      previousValue === null ||
      previousValue === undefined ||
      previousValue === 0
    )
      return null;
    return ((value - previousValue) / previousValue) * 100;
  };

  const delta = getDelta();
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;

  // For time metrics, lower is better (so negative trend is good)
  // For count metrics like breaches, lower is also better
  const definition = getMetricDefinition(metricKey);
  const lowerIsBetter = definition
    ? definition.direction === 'lower_is_better'
    : isTimeMetric ||
      metricKey.includes('Breaches') ||
      metricKey === 'unassignedActive' ||
      metricKey === 'escalationRate' ||
      metricKey === 'coverageGapDays';

  const trendIsGood = lowerIsBetter ? isNegative : isPositive;
  const trendIsContextOnly = definition?.direction === 'context_only';

  // Variant colors
  const variantStyles = {
    default: 'text-foreground',
    success: 'text-green-500',
    warning: 'text-yellow-500',
    danger: 'text-red-500',
  };

  return (
    <div className="flex flex-col justify-center h-full">
      <div className={`text-3xl font-bold ${variantStyles[variant]}`}>{formatValue(value)}</div>

      {showTrend && delta !== null && (
        <div
          className={`flex items-center gap-1 mt-1 text-sm ${
            trendIsContextOnly
              ? 'text-muted-foreground'
              : trendIsGood
                ? 'text-green-500'
                : 'text-red-500'
          }`}
        >
          {isPositive ? (
            <TrendingUp className="h-3 w-3" />
          ) : isNegative ? (
            <TrendingDown className="h-3 w-3" />
          ) : (
            <Minus className="h-3 w-3" />
          )}
          <span>{Math.abs(delta).toFixed(1)}% vs prev</span>
        </div>
      )}
    </div>
  );
});

export default MetricWidget;
