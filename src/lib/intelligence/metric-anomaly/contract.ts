import { z } from 'zod/v4';

/**
 * Metric anomaly evidence: administrator-configured, per-service metric queries that the intelligence lane
 * evaluates against a seasonal baseline. Dependency-free so the settings UI can import the bounds.
 */

export const METRIC_DIRECTIONS = ['BOTH', 'UP', 'DOWN'] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export const METRIC_TEMPLATE_BOUNDS = {
  maxTemplates: 500,
  maxTemplatesPerService: 10,
  queryLength: 1_000,
  thresholdMad: { min: 2, max: 50, default: 5 },
  baselineWeeks: { min: 2, max: 8, default: 4 },
  windowMinutes: { min: 15, max: 360, default: 60 },
  stepSeconds: { min: 15, max: 3_600, default: 60 },
  intervalMinutes: { min: 5, max: 1_440, default: 15 },
  /** Series per query that are evaluated; the rest are ignored (and reported). */
  maxSeries: 10,
  /** Points per series that are read; anything beyond is ignored. */
  maxPointsPerSeries: 2_000,
  /** Deviations kept per evaluation, strongest first. */
  maxDeviationsPerEvaluation: 10,
} as const;

/** How often the lane checks which templates are due; each template has its own interval. */
export const METRIC_SCHEDULE_CHECK_INTERVAL_MS = 60_000;
/** Templates enqueued per scheduling check, oldest evaluation first. */
export const METRIC_SCHEDULE_BATCH = 100;
/** Connector requests in flight per evaluation, and evaluations in flight per process. */
export const METRIC_FETCH_CONCURRENCY = 2;
export const METRIC_EVALUATION_CONCURRENCY = 2;
/** The lane's per-item budget for one evaluation (several connector round trips at most). */
export const METRIC_EVALUATION_BUDGET_MS = 60_000;
/** An anomaly this long after onset still counts as evidence: metrics and alerts move together. */
export const METRIC_EVIDENCE_GRACE_MINUTES = 10;

export const metricTemplateInputSchema = z
  .object({
    serviceId: z.string().trim().min(1).max(64),
    connectionId: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(80),
    query: z.string().trim().min(1).max(METRIC_TEMPLATE_BOUNDS.queryLength),
    enabled: z.boolean().default(false),
    direction: z.enum(METRIC_DIRECTIONS).default('BOTH'),
    thresholdMad: z
      .number()
      .min(METRIC_TEMPLATE_BOUNDS.thresholdMad.min)
      .max(METRIC_TEMPLATE_BOUNDS.thresholdMad.max)
      .default(METRIC_TEMPLATE_BOUNDS.thresholdMad.default),
    baselineWeeks: z
      .number()
      .int()
      .min(METRIC_TEMPLATE_BOUNDS.baselineWeeks.min)
      .max(METRIC_TEMPLATE_BOUNDS.baselineWeeks.max)
      .default(METRIC_TEMPLATE_BOUNDS.baselineWeeks.default),
    windowMinutes: z
      .number()
      .int()
      .min(METRIC_TEMPLATE_BOUNDS.windowMinutes.min)
      .max(METRIC_TEMPLATE_BOUNDS.windowMinutes.max)
      .default(METRIC_TEMPLATE_BOUNDS.windowMinutes.default),
    stepSeconds: z
      .number()
      .int()
      .min(METRIC_TEMPLATE_BOUNDS.stepSeconds.min)
      .max(METRIC_TEMPLATE_BOUNDS.stepSeconds.max)
      .default(METRIC_TEMPLATE_BOUNDS.stepSeconds.default),
    intervalMinutes: z
      .number()
      .int()
      .min(METRIC_TEMPLATE_BOUNDS.intervalMinutes.min)
      .max(METRIC_TEMPLATE_BOUNDS.intervalMinutes.max)
      .default(METRIC_TEMPLATE_BOUNDS.intervalMinutes.default),
    minDeviation: z.number().min(0).max(1e12).default(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    // At least four samples per window, or a two-sample run could never be seen inside it.
    if (value.windowMinutes * 60 < value.stepSeconds * 4)
      ctx.addIssue({
        code: 'custom',
        path: ['stepSeconds'],
        message: 'The step must fit at least four times into the window',
      });
  });
export type MetricTemplateInput = z.infer<typeof metricTemplateInputSchema>;

export interface MetricTemplateView {
  id: string;
  serviceId: string;
  serviceName: string;
  connectionId: string | null;
  connectionName: string | null;
  name: string;
  query: string;
  enabled: boolean;
  direction: MetricDirection;
  thresholdMad: number;
  baselineWeeks: number;
  windowMinutes: number;
  stepSeconds: number;
  intervalMinutes: number;
  minDeviation: number;
  lastEvaluatedAt: string | null;
  lastStatus: string | null;
}

/** Outcome codes stored on the template after each evaluation; shown to administrators as-is. */
export const METRIC_EVALUATION_STATUS = {
  OK: 'OK',
  NO_DATA: 'NO_DATA',
  THIN_BASELINE: 'THIN_BASELINE',
  NO_CONNECTION: 'NO_CONNECTION',
  CONNECTION_DISABLED: 'CONNECTION_DISABLED',
  CONNECTION_NOT_ALLOWED: 'CONNECTION_NOT_ALLOWED',
  UNSUPPORTED: 'UNSUPPORTED',
  CONNECTOR_ERROR: 'CONNECTOR_ERROR',
} as const;

export const METRIC_STATUS_LABELS: Readonly<Record<string, string>> = {
  OK: 'Evaluated',
  NO_DATA: 'The query returned no data',
  THIN_BASELINE: 'Not enough history yet for a baseline',
  NO_CONNECTION: 'The connection was removed',
  CONNECTION_DISABLED: 'The connection is disabled',
  CONNECTION_NOT_ALLOWED: "The connection is not allowed for this service's team",
  UNSUPPORTED: 'The connection cannot answer metric queries',
  CONNECTOR_ERROR: 'The connection did not answer',
};

/** "OK", or "CONNECTOR_ERROR:TIMEOUT": the code before the colon is one of METRIC_EVALUATION_STATUS. */
export function describeMetricStatus(status: string | null): string {
  if (!status) return 'Not evaluated yet';
  const [code, detail] = status.split(':', 2);
  // eslint-disable-next-line security/detect-object-injection -- read-only lookup in a frozen label table
  const label = METRIC_STATUS_LABELS[code] ?? code;
  return detail ? `${label} (${detail.toLowerCase().replace(/_/g, ' ')})` : label;
}
