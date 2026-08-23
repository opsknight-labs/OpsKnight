import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';
import type { ZabbixPayload } from './schemas';

export type ZabbixEvent = ZabbixPayload;

function resolveZabbixSeverity(
  rawSeverity?: string | number
): 'critical' | 'error' | 'warning' | 'info' {
  if (rawSeverity === undefined || rawSeverity === null) return 'warning';

  const sevStr = String(rawSeverity).trim().toLowerCase();

  // Zabbix severity levels: 0=Not classified, 1=Information, 2=Warning, 3=Average, 4=High, 5=Disaster
  if (sevStr === '5' || sevStr.includes('disaster') || sevStr.includes('critical')) {
    return 'critical';
  }
  if (sevStr === '4' || sevStr.includes('high') || sevStr.includes('error')) {
    return 'error';
  }
  if (
    sevStr === '3' ||
    sevStr === '2' ||
    sevStr.includes('average') ||
    sevStr.includes('warning')
  ) {
    return 'warning';
  }
  if (
    sevStr === '1' ||
    sevStr === '0' ||
    sevStr.includes('information') ||
    sevStr.includes('classified')
  ) {
    return 'info';
  }

  return normalizeSeverity(sevStr, 'warning');
}

function resolveZabbixAction(data: ZabbixPayload): 'trigger' | 'resolve' | 'acknowledge' {
  const status = firstString(
    data.event_status,
    data.eventStatus,
    data.trigger_status,
    data.status
  )?.toUpperCase();
  const value = firstString(data.event_value, data.eventValue, data.trigger_value);
  const action = firstString(data.action)?.toUpperCase();

  if (action?.includes('ACK') || action?.includes('UPDATE')) {
    return 'acknowledge';
  }

  if (status === 'RESOLVED' || status === 'OK' || status === 'RECOVERED' || value === '0') {
    return 'resolve';
  }

  if (status === 'PROBLEM' || value === '1') {
    return 'trigger';
  }

  return normalizeEventAction(status || action, 'trigger');
}

export function transformZabbixToEvent(data: ZabbixPayload): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const summary =
    firstString(
      data.event_name,
      data.eventName,
      data.trigger_name,
      data.triggerName,
      data.trigger_description,
      data.triggerDescription,
      data.subject,
      data.message
    ) || 'Zabbix Alert';

  const eventAction = resolveZabbixAction(data);
  const severity = resolveZabbixSeverity(
    data.event_severity || data.eventSeverity || data.severity
  );

  const host = firstString(
    data.host_name,
    data.hostName,
    data.host_ip,
    data.hostIp,
    'unknown-host'
  );

  // Prioritize event_id over trigger_id — recovery events reference original event/problem ID
  const eventOrTriggerId = firstString(
    data.event_id,
    data.eventId,
    (data as any).r_event_id, // eslint-disable-line @typescript-eslint/no-explicit-any
    (data as any).problem_id, // eslint-disable-line @typescript-eslint/no-explicit-any
    data.trigger_id,
    data.triggerId
  );

  const dedupKey = eventOrTriggerId
    ? `zabbix-${host}-${eventOrTriggerId}`
    : `zabbix-${host}-${summary.replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: eventAction,
    dedup_key: dedupKey,
    payload: {
      summary,
      source: 'Zabbix',
      severity,
      custom_details: {
        eventId: data.event_id || data.eventId,
        triggerId: data.trigger_id || data.triggerId,
        hostName: data.host_name || data.hostName,
        hostIp: data.host_ip || data.hostIp,
        itemName: data.item_name || data.itemName,
        itemKey: data.item_key || data.itemKey,
        itemValue: data.item_value || data.itemValue,
        eventDate: data.event_date,
        eventTime: data.event_time,
        eventTags: data.event_tags,
        eventUrl: data.event_url || data.eventUrl,
        eventOpdata: data.event_opdata || data.eventOpdata,
        ackUser: data.ack_user,
        ackMessage: data.ack_message,
        raw: data,
      },
    },
  };
}
