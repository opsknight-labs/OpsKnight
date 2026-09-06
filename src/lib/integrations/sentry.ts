/**
 * Sentry Integration Handler
 * Transforms Sentry webhook events to standard event format
 */

export type SentryEvent = {
  action?: 'created' | 'resolved' | 'assigned' | 'unassigned' | 'ignored';
  issue?: {
    id: string;
    shortId: string;
    title: string;
    culprit: string;
    level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
    status: 'unresolved' | 'resolved' | 'ignored';
    assignedTo?: {
      name: string;
      email: string;
    };
    metadata?: {
      type?: string;
      value?: string;
    };
    permalink: string;
  };
  // Legacy format
  event?: {
    event_id: string;
    message?: string;
    level: string;
    timestamp: number;
    platform: string;
    tags?: Record<string, string>;
    contexts?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  project?: {
    name: string;
    slug: string;
  };
};

export function transformSentryToEvent(payload: SentryEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
} {
  // Handle new issue format
  if (payload.issue) {
    const issue = payload.issue;
    const action = payload.action || 'created';
    let eventAction: 'trigger' | 'resolve' | 'acknowledge' = 'trigger';
    if (action === 'resolved' || issue.status === 'resolved') {
      eventAction = 'resolve';
    } else if (
      action === 'ignored' ||
      issue.status === 'ignored' ||
      action === 'assigned' ||
      action === 'unassigned'
    ) {
      eventAction = 'acknowledge';
    } else if (action === 'created' || action === 'reopened' || action === 'triggered') {
      eventAction = 'trigger';
    }

    const severityMap: Record<string, 'critical' | 'error' | 'warning' | 'info'> = {
      fatal: 'critical',
      error: 'error',
      warning: 'warning',
      info: 'info',
      debug: 'info',
    };
    const severity = severityMap[issue.level] || 'error';

    return {
      event_action: eventAction,
      dedup_key: `sentry-${issue.id}`,
      payload: {
        summary: issue.title,
        source: `Sentry${payload.project ? ` - ${payload.project.name}` : ''}`,
        severity,
        custom_details: {
          action,
          issue: {
            id: issue.id,
            shortId: issue.shortId,
            title: issue.title,
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

  // Handle legacy event format
  if (payload.event) {
    const event = payload.event;
    const severityMap: Record<string, 'critical' | 'error' | 'warning' | 'info'> = {
      fatal: 'critical',
      error: 'error',
      warning: 'warning',
      info: 'info',
      debug: 'info',
    };
    const severity = severityMap[event.level?.toLowerCase() || 'error'] || 'error';

    const groupKey =
      (event as { issue_id?: string; group_id?: string; fingerprint?: string[] }).issue_id ||
      (event as { issue_id?: string; group_id?: string; fingerprint?: string[] }).group_id ||
      (event as { issue_id?: string; group_id?: string; fingerprint?: string[] })
        .fingerprint?.[0] ||
      event.event_id;

    return {
      event_action: 'trigger',
      dedup_key: `sentry-${groupKey}`,
      payload: {
        summary: event.message || 'Sentry Error',
        source: `Sentry${payload.project ? ` - ${payload.project.name}` : ''}`,
        severity,
        custom_details: {
          event_id: event.event_id,
          message: event.message,
          level: event.level,
          timestamp: event.timestamp,
          platform: event.platform,
          tags: event.tags,
          contexts: event.contexts,
          project: payload.project,
        },
      },
    };
  }
  // Fallback for unsupported payload formats - return acknowledge instead of throwing
  // Use project name for stable dedup key (avoids Date.now() which defeats dedup)
  return {
    event_action: 'acknowledge' as const,
    dedup_key: `sentry-unknown-${payload.project?.slug || payload.project?.name || 'fallback'}`,
    payload: {
      summary: 'Sentry event received: unknown format',
      source: `Sentry${payload.project ? ` - ${payload.project.name}` : ''}`,
      severity: 'info' as const,
      custom_details: payload,
    },
  };
}
