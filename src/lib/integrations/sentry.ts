/**
 * Sentry Integration Handler
 * Transforms Sentry webhook events to standard event format.
 *
 * Accepted shapes:
 * - issue webhook: { action, issue: {...} } or integration platform { action, data: { issue } }
 * - issue alert:   { action: 'triggered', data: { event: {..., issue_id} } }
 * - metric alert:  { action: 'critical' | 'warning' | 'resolved', data: { metric_alert, description_title } }
 * - legacy plugin: { id, project: 'slug', message, level, event: {...} }
 */
import type { SentryEvent } from './schemas';

export type { SentryEvent };

type Severity = 'critical' | 'error' | 'warning' | 'info';
type EventAction = 'trigger' | 'resolve' | 'acknowledge';
type SentryIssue = NonNullable<SentryEvent['issue']>;
type SentryLegacyEvent = NonNullable<SentryEvent['event']>;

const SEVERITY_MAP: Record<string, Severity> = {
  fatal: 'critical',
  error: 'error',
  warning: 'warning',
  info: 'info',
  debug: 'info',
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function projectName(project: SentryEvent['project']): string | undefined {
  if (typeof project === 'string') return project;
  return project?.name || project?.slug || undefined;
}

function sourceFor(payload: SentryEvent): string {
  const name = projectName(payload.project) || str(payload.project_name);
  return `Sentry${name ? ` - ${name}` : ''}`;
}

function issueAction(action: string, status: string | undefined): EventAction {
  if (action === 'resolved' || status === 'resolved') return 'resolve';
  // An ignored (archived) issue no longer alerts, so the incident is done.
  if (action === 'ignored' || action === 'archived' || status === 'ignored') return 'resolve';
  if (action === 'assigned') return 'acknowledge';
  // created, unresolved, reopened, unassigned: the issue is (still) open.
  return 'trigger';
}

export function transformSentryToEvent(payload: SentryEvent): {
  event_action: EventAction;
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: Severity;
    custom_details: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
} {
  const action = payload.action || 'created';
  const data = asRecord(payload.data);
  const source = sourceFor(payload);

  // Metric alert (integration platform)
  const metricAlert = asRecord(data?.metric_alert);
  if (metricAlert) {
    const rule = asRecord(metricAlert.alert_rule);
    const id = str(metricAlert.id) || str(rule?.id) || str(rule?.name) || 'unknown';
    return {
      event_action: action === 'resolved' ? 'resolve' : 'trigger',
      dedup_key: `sentry-metric-${id}`,
      payload: {
        summary:
          str(data?.description_title) ||
          str(metricAlert.title) ||
          str(rule?.name) ||
          'Sentry Metric Alert',
        source,
        severity: action === 'critical' ? 'critical' : 'warning',
        custom_details: {
          action,
          description: str(data?.description_text),
          url: str(data?.web_url),
          metric_alert: metricAlert,
        },
      },
    };
  }

  const issue = (payload.issue || asRecord(data?.issue)) as SentryIssue | undefined;
  if (issue) {
    const issueId = str(issue.id) || str(issue.shortId) || 'unknown';
    const title =
      str(issue.title) ||
      str(issue.metadata?.value) ||
      str(issue.culprit) ||
      `Sentry issue ${issueId}`;
    return {
      event_action: issueAction(action, issue.status),
      dedup_key: `sentry-${issueId}`,
      payload: {
        summary: title,
        source,
        severity: SEVERITY_MAP[issue.level?.toLowerCase() || ''] || 'error',
        custom_details: {
          action,
          issue: {
            id: issue.id,
            shortId: issue.shortId,
            title,
            culprit: issue.culprit,
            level: issue.level,
            status: issue.status,
            assignedTo: issue.assignedTo,
            metadata: issue.metadata,
            permalink: issue.permalink,
          },
          project: payload.project,
        },
      },
    };
  }

  // Issue alert (data.event) or legacy plugin (top-level event)
  const event = (asRecord(data?.event) || payload.event) as SentryLegacyEvent | undefined;
  if (event) {
    const level = event.level || str(payload.level);
    // Group events by their Sentry issue so repeat occurrences dedup into one incident.
    const groupKey =
      str(event.issue_id) ||
      str(event.group_id) ||
      (data ? undefined : str(payload.id)) ||
      event.fingerprint?.[0] ||
      event.event_id ||
      'unknown';

    return {
      event_action: 'trigger',
      dedup_key: `sentry-${groupKey}`,
      payload: {
        summary: event.title || event.message || str(payload.message) || 'Sentry Error',
        source,
        severity: SEVERITY_MAP[level?.toLowerCase() || 'error'] || 'error',
        custom_details: {
          event_id: event.event_id,
          message: event.message,
          level,
          timestamp: event.timestamp,
          platform: event.platform,
          tags: event.tags,
          contexts: event.contexts,
          url: str(payload.url) || str(asRecord(data?.event)?.web_url),
          project: payload.project,
        },
      },
    };
  }

  // Fallback for unsupported payload formats - return acknowledge instead of throwing
  // Use project name for stable dedup key (avoids Date.now() which defeats dedup)
  return {
    event_action: 'acknowledge' as const,
    dedup_key: `sentry-unknown-${projectName(payload.project) || 'fallback'}`,
    payload: {
      summary: 'Sentry event received: unknown format',
      source,
      severity: 'info' as const,
      custom_details: payload,
    },
  };
}
