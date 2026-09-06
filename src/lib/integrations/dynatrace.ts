import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type DynatraceEvent = {
  ProblemID?: string | number;
  ProblemTitle?: string;
  ProblemDetailsText?: string;
  State?: string;
  SeverityLevel?: string;
  ProblemImpact?: string;
  ProblemURL?: string;
  [key: string]: unknown;
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
  const severity = normalizeSeverity(
    firstString(safeData.SeverityLevel, safeData.ProblemImpact),
    'warning'
  );
  // Use ProblemID or create stable key from ProblemTitle (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(safeData.ProblemID) ||
    `dynatrace-${(safeData.ProblemTitle || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(status, 'trigger'),
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
