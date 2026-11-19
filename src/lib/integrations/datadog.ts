/**
 * Datadog Integration Handler
 * Transforms Datadog webhooks to standard event format
 */

import { createHash } from 'crypto';
import { normalizeSeverity } from './normalization';

export type DatadogSingleEvent = {
  event_type?: string;
  title?: string;
  text?: string;
  alert_type?: 'error' | 'warning' | 'info' | 'success';
  date_happened?: number;
  tags?: string[];
  host?: string;
  aggregation_key?: string;
  source_type_name?: string;
  // Alert format
  alert?: {
    id?: string;
    title?: string;
    message?: string;
    status?: string;
    severity?: string;
  };
  // Monitor format
  monitor?: {
    id?: number;
    name?: string;
    status?: string;
    message?: string;
  };
};

export type DatadogEvent = DatadogSingleEvent | DatadogSingleEvent[];

const DATADOG_TRANSITIONS = new Set([
  'triggered',
  're-triggered',
  'recovered',
  'ok',
  'warn',
  'warning',
  'alert',
  'renotified',
  'renotify',
  'no data',
]);

export function transformDatadogToEvent(data: DatadogEvent): Array<{
  event_action: 'trigger' | 'resolve';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
}> {
  if (!data || typeof data !== 'object') {
    return [
      {
        event_action: 'trigger' as const,
        dedup_key: 'datadog-invalid-payload',
        payload: {
          summary: 'Invalid Datadog payload received',
          source: 'Datadog',
          severity: 'info' as const,
          custom_details: { raw: data },
        },
      },
    ];
  }

  const events = (Array.isArray(data) ? data : [data]).filter(Boolean);

  return events.map(eventData => {
    const title =
      eventData.title || eventData.alert?.title || eventData.monitor?.name || 'Datadog Alert';
    const text = eventData.text || eventData.alert?.message || eventData.monitor?.message || '';
    const alertType = eventData.alert_type || eventData.alert?.severity || 'warning';
    const status = eventData.alert?.status || eventData.monitor?.status || 'triggered';

    // $ALERT_TRANSITION sends 'Recovered'; titles carry '[Recovered]' or '[Recovered on {host:x}]'.
    const bracket = /^\[([^\]]*)\]\s*/.exec(title);
    const [transitionWord = '', ...scopeParts] = (bracket?.[1] ?? '').split(' on ');
    const transition = transitionWord.toLowerCase();
    const isResolved =
      ['resolved', 'ok', 'recovered'].includes(String(status).toLowerCase()) ||
      alertType === 'success' ||
      transition === 'recovered';
    // Build stable dedup key - avoid Date.now() which defeats deduplication
    // Priority: aggregation_key > alert.id > monitor.id > title-based hash
    // Strip the transition word but keep a multi-alert scope ('on {host:x}') so groups stay apart.
    const cleanTitle =
      bracket && DATADOG_TRANSITIONS.has(transition)
        ? `${scopeParts.length ? `on ${scopeParts.join(' on ')} ` : ''}${title.slice(bracket[0].length)}`
        : title;
    const titleKey = cleanTitle.replace(/\s+/g, '-').toLowerCase();
    const titleHash = createHash('sha256').update(titleKey).digest('hex').slice(0, 32);

    const dedupKey =
      (eventData.aggregation_key ? `datadog-${eventData.aggregation_key}` : null) ||
      (eventData.alert?.id
        ? `datadog-alert-${eventData.alert.id}`
        : eventData.monitor?.id
          ? `datadog-monitor-${eventData.monitor.id}`
          : `datadog-${titleHash}`);

    const mappedSeverity = normalizeSeverity(alertType, 'warning');

    return {
      event_action: isResolved ? 'resolve' : 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: title,
        source: 'Datadog',
        severity: mappedSeverity,
        custom_details: {
          title,
          text,
          alertType,
          status,
          dateHappened: eventData.date_happened,
          tags: eventData.tags,
          host: eventData.host,
          sourceType: eventData.source_type_name,
          alert: eventData.alert,
          monitor: eventData.monitor,
          eventType: eventData.event_type,
        },
      },
    };
  });
}
