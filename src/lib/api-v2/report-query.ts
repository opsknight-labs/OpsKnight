import { z } from 'zod/v3';
import { INCIDENT_METRIC_DEFINITIONS } from '@/lib/metric-contract';
import type { SLAMetrics } from '@/lib/sla';

export const ReportMetricKeySchema = z.enum([
  'totalIncidents',
  'activeIncidents',
  'triggeredIncidents',
  'acknowledgedIncidents',
  'mutedIncidents',
  'resolvedIncidents',
  'unassignedActive',
  'highUrgencyPeriod',
  'resolved24h',
  'ackRate',
  'resolveRate',
  'ackCompliance',
  'resolveCompliance',
  'mtta',
  'mttr',
  'onCallCoverage',
]);

export const ReportQueryV2Schema = z
  .object({
    metrics: z
      .array(ReportMetricKeySchema)
      .min(1)
      .max(16)
      .refine(keys => new Set(keys).size === keys.length, 'Metric keys must be unique.'),
    windowDays: z.number().int().min(1).max(90).default(30),
    serviceId: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const REPORT_METRIC_CATALOG = ReportMetricKeySchema.options.map(key => ({
  key,
  // eslint-disable-next-line security/detect-object-injection -- key is a closed Zod enum, not user-controlled indexing
  ...INCIDENT_METRIC_DEFINITIONS[key],
}));

export function projectReportMetric(
  key: z.infer<typeof ReportMetricKeySchema>,
  metrics: SLAMetrics
): number | null {
  switch (key) {
    case 'triggeredIncidents':
      return metrics.openCount;
    case 'acknowledgedIncidents':
      return metrics.acknowledgedCount;
    case 'mutedIncidents':
      return metrics.snoozedCount + metrics.suppressedCount;
    case 'resolvedIncidents':
      return (
        metrics.resolvedIncidents ??
        metrics.statusMix.find(item => item.status === 'RESOLVED')?.count ??
        0
      );
    case 'highUrgencyPeriod':
      return metrics.highUrgencyRate;
    case 'mtta':
      return metrics.mttd;
    case 'onCallCoverage':
      return metrics.coveragePercent;
    default:
      // eslint-disable-next-line security/detect-object-injection -- exhaustive enum leaves only numeric SLAMetrics keys
      return metrics[key];
  }
}
