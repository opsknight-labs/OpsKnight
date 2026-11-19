import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type DynatraceEvent = {
  ProblemID?: string | number;
  ProblemTitle?: string;
  ProblemDetailsText?: string;
  State?: string;
  SeverityLevel?: string;
  ProblemSeverity?: string;
  ProblemImpact?: string;
  ProblemURL?: string;
  [key: string]: unknown;
};

const DYNATRACE_SEVERITY: Record<string, 'critical' | 'error' | 'warning' | 'info'> = {
  AVAILABILITY: 'critical',
  ERROR: 'error',
  PERFORMANCE: 'warning',
  RESOURCE_CONTENTION: 'warning',
  CUSTOM_ALERT: 'warning',
  MONITORING_UNAVAILABLE: 'warning',
  INFO: 'info',
};

export function transformDynatraceToEvent(data: DynatraceEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const safeData = data && typeof data === 'object' ? data : {};
  const summary =
    firstString(safeData.ProblemTitle, safeData.ProblemDetailsText) || 'Dynatrace Problem';
  const status = firstString(safeData.State);
  // Dynatrace ProblemSeverity values are categories, not levels, so map them explicitly.
  const problemSeverity = firstString(safeData.ProblemSeverity, safeData.SeverityLevel);
  const severity =
    DYNATRACE_SEVERITY[problemSeverity?.toUpperCase() ?? ''] ??
    normalizeSeverity(firstString(problemSeverity, safeData.ProblemImpact), 'warning');
  // Use ProblemID or create stable key from ProblemTitle (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(safeData.ProblemID) ||
    `dynatrace-${(safeData.ProblemTitle || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    // A MERGED problem lives on in another problem, so this one is closed.
    event_action:
      status?.toUpperCase() === 'MERGED' ? 'resolve' : normalizeEventAction(status, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'Dynatrace',
      severity,
      custom_details: {
        problemId: data.ProblemID,
        problemUrl: data.ProblemURL,
        raw: data,
      },
    },
  };
}
