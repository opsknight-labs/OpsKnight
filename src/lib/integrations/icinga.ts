import { normalizeSeverity, firstString } from './normalization';
import type { IcingaPayload } from './schemas';

export type IcingaEvent = IcingaPayload;

function sanitizeKey(val: string): string {
  return val.replace(/\s+/g, '-').toLowerCase().slice(0, 100);
}

function resolveAction(
  notificationType?: string,
  serviceState?: string,
  hostState?: string
): 'trigger' | 'resolve' | 'acknowledge' {
  const notif = (notificationType || '').toUpperCase();
  const sState = (serviceState || '').toUpperCase();
  const hState = (hostState || '').toUpperCase();

  if (notif.includes('RECOVERY')) {
    return 'resolve';
  }

  if (
    notif.includes('ACK') ||
    notif.includes('ACKNOWLEDGEMENT') ||
    notif.includes('DOWNTIME') ||
    notif.includes('FLAPPING') ||
    notif.includes('CUSTOM')
  ) {
    return 'acknowledge';
  }

  if (sState === 'OK' || (hState === 'UP' && !serviceState)) {
    return 'resolve';
  }

  return 'trigger';
}

function resolveSeverity(
  action: 'trigger' | 'resolve' | 'acknowledge',
  serviceState?: string,
  hostState?: string
): 'critical' | 'error' | 'warning' | 'info' {
  if (action === 'resolve') {
    return 'info';
  }

  const sState = (serviceState || '').toUpperCase();
  const hState = (hostState || '').toUpperCase();

  if (sState === 'CRITICAL' || hState === 'DOWN') {
    return 'critical';
  }
  if (sState === 'WARNING') {
    return 'warning';
  }
  if (sState === 'UNKNOWN' || hState === 'UNREACHABLE') {
    return 'error';
  }

  return normalizeSeverity(sState || hState, 'warning');
}

export function transformIcingaToEvent(data: IcingaPayload): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const notificationType = firstString(data.notification_type, data.notificationType, data.type);
  const hostName =
    firstString(data.host_name, data.hostName, data.host, data.host_display_name) || 'unknown-host';
  const hostState = firstString(data.host_state, data.hostState);
  const serviceName = firstString(
    data.service_name,
    data.serviceName,
    data.service,
    data.service_display_name
  );
  const serviceState = firstString(data.service_state, data.serviceState);
  const output = firstString(
    data.service_output,
    data.serviceOutput,
    data.host_output,
    data.hostOutput,
    data.output
  );

  const action = resolveAction(notificationType, serviceState, hostState);
  const severity = resolveSeverity(action, serviceState, hostState);

  // Construct deterministic dedup key
  const dedupKey = serviceName
    ? `icinga-${sanitizeKey(hostName)}-${sanitizeKey(serviceName)}`
    : `icinga-${sanitizeKey(hostName)}`;

  // Construct summary
  let summary: string;
  if (serviceName) {
    const stateLabel = serviceState || notificationType || 'ALERT';
    summary = output
      ? `${serviceName} on ${hostName} is ${stateLabel}: ${output}`
      : `${serviceName} on ${hostName} is ${stateLabel}`;
  } else {
    const stateLabel = hostState || notificationType || 'ALERT';
    summary = output
      ? `Host ${hostName} is ${stateLabel}: ${output}`
      : `Host ${hostName} is ${stateLabel}`;
  }

  return {
    event_action: action,
    dedup_key: dedupKey,
    payload: {
      summary,
      source: 'Icinga',
      severity,
      custom_details: {
        notificationType,
        hostname: hostName,
        hostState,
        service: serviceName,
        serviceState,
        output,
        checkCommand: firstString(data.check_command, data.checkCommand),
        author: data.author,
        comment: data.comment,
        timestamp: data.timestamp,
        raw: data,
      },
    },
  };
}
