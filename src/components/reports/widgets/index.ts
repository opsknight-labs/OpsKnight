/**
 * Widget Components Index
 *
 * Export all widget components and provide a factory function
 * for rendering widgets based on their type.
 */

export { default as MetricWidget } from './MetricWidget';
export { default as GaugeWidget } from './GaugeWidget';
export { default as TableWidget } from './TableWidget';
export { default as InsightsWidget } from './InsightsWidget';
export { default as ChartWidget } from './ChartWidget';

import type { SerializedSLAMetrics } from '@/lib/sla';
import type { WidgetType } from '@/lib/reports/widget-registry';

/**
 * Get the data for a specific metric key from the metrics object
 */
export function getMetricData(metrics: SerializedSLAMetrics, metricKey: string): any {
  // Handle nested keys like 'user.name'
  if (metricKey.includes('.')) {
    return metricKey.split('.').reduce((obj, key) => obj?.[key], metrics as any);
  }

  return (metrics as any)[metricKey];
}

/**
 * Get previous period data for trend calculation
 */
export function getPreviousPeriodValue(
  metrics: SerializedSLAMetrics,
  metricKey: string
): number | null {
  const previousPeriod = metrics.previousPeriod;
  if (!previousPeriod || previousPeriod.available === false) return null;

  // Keep this allowlist explicit so user-controlled report keys never become
  // dynamic object-property lookups.
  const value = (() => {
    switch (metricKey) {
      case 'totalIncidents':
        return previousPeriod.totalIncidents;
      case 'highUrgencyCount':
        return previousPeriod.highUrgencyCount;
      case 'mttd':
        return previousPeriod.mtta;
      case 'mttr':
        return previousPeriod.mttr;
      case 'ackRate':
        return previousPeriod.ackRate;
      case 'resolveRate':
        return previousPeriod.resolveRate;
      default:
        return null;
    }
  })();

  return typeof value === 'number' ? value : null;
}

/**
 * Determine the appropriate widget type for auto-detection
 */
export function getWidgetTypeForMetric(metricKey: string): WidgetType {
  // Percentage/compliance metrics → gauge
  if (
    metricKey.includes('Compliance') ||
    metricKey.includes('Rate') ||
    metricKey.includes('Percent')
  ) {
    return 'gauge';
  }

  // Array data → table or chart
  if (
    metricKey === 'trendSeries' ||
    metricKey === 'heatmapData' ||
    metricKey === 'urgencyMix' ||
    metricKey === 'statusMix'
  ) {
    return 'chart';
  }

  if (
    metricKey === 'topServices' ||
    metricKey === 'assigneeLoad' ||
    metricKey === 'serviceMetrics' ||
    metricKey === 'onCallLoad' ||
    metricKey === 'recurringTitles' ||
    metricKey === 'serviceSlaTable' ||
    metricKey === 'currentShifts'
  ) {
    return 'table';
  }

  if (metricKey === 'insights') {
    return 'insights';
  }

  // Default to metric card
  return 'metric';
}
