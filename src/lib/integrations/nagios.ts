import { normalizeSeverity, firstString } from './normalization';
import type { NagiosPayload } from './schemas';

export type NagiosEvent = NagiosPayload;

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

export function transformNagiosToEvent(data: NagiosPayload): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const notificationType = firstString(data.notificationtype, data.NOTIFICATIONTYPE);
  const hostName =
    firstString(data.hostname, data.HOSTNAME, data.hostalias, data.HOSTALIAS) || 'unknown-host';
  const hostAddress = firstString(data.hostaddress, data.HOSTADDRESS);
  const hostState = firstString(data.hoststate, data.HOSTSTATE);
  const serviceDesc = firstString(data.servicedesc, data.SERVICEDESC, data.service, data.SERVICE);
  const serviceState = firstString(data.servicestate, data.SERVICESTATE);
  const output = firstString(
    data.serviceoutput,
    data.SERVICEOUTPUT,
    data.hostoutput,
    data.HOSTOUTPUT,
    data.longserviceoutput,
    data.LONGSERVICEOUTPUT,
    data.longhostoutput,
    data.LONGHOSTOUTPUT
  );

  const action = resolveAction(notificationType, serviceState, hostState);
  const severity = resolveSeverity(action, serviceState, hostState);

  // Construct deterministic dedup key
  const dedupKey = serviceDesc
    ? `nagios-${sanitizeKey(hostName)}-${sanitizeKey(serviceDesc)}`
    : `nagios-${sanitizeKey(hostName)}`;

  // Construct human-readable summary
  let summary: string;
  if (serviceDesc) {
    const stateLabel = serviceState || notificationType || 'ALERT';
    summary = output
      ? `${serviceDesc} on ${hostName} is ${stateLabel}: ${output}`
      : `${serviceDesc} on ${hostName} is ${stateLabel}`;
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
      source: 'Nagios',
      severity,
      custom_details: {
        notificationType,
        hostname: hostName,
        hostAddress,
        hostState,
        service: serviceDesc,
        serviceState,
        output,
        author: firstString(
          data.author,
          data.AUTHOR,
          data.serviceackauthor,
          data.SERVICEACKAUTHOR,
          data.hostackauthor,
          data.HOSTACKAUTHOR
        ),
        comment: firstString(
          data.comment,
          data.COMMENT,
          data.serviceackcomment,
          data.SERVICEACKCOMMENT,
          data.hostackcomment,
          data.HOSTACKCOMMENT
        ),
        raw: data,
      },
    },
  };
}
