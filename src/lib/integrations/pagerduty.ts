import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';
import type { PagerDutyEvent } from './schemas';

export function transformPagerDutyToEvent(data: PagerDutyEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const eventAction = (data.event_action || data.eventAction || data.action || 'trigger') as
    | 'trigger'
    | 'resolve'
    | 'acknowledge';

  const summary =
    firstString(
      data.payload?.summary,
      data.payload?.component,
      data.payload?.group,
      data.payload?.class,
      data.client
    ) || 'PagerDuty Alert';

  const severity = normalizeSeverity(data.payload?.severity, 'error');
  const source = firstString(data.payload?.source, data.client) || 'PagerDuty';

  const dedupKey =
    firstString(data.dedup_key, data.dedupKey) ||
    `pd-${summary.replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(eventAction, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source,
      severity,
      custom_details: {
        routingKey: data.routing_key || data.routingKey,
        component: data.payload?.component,
        group: data.payload?.group,
        class: data.payload?.class,
        timestamp: data.payload?.timestamp,
        client: data.client,
        clientUrl: data.client_url,
        images: data.images,
        links: data.links,
        customDetails: data.payload?.custom_details,
        raw: data,
      },
    },
  };
}
