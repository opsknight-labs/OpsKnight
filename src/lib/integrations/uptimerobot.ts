import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';

export type UptimeRobotEvent = {
  alertType?: string | number;
  alertTypeFriendlyName?: string;
  monitorID?: string | number;
  monitorFriendlyName?: string;
  alertDetails?: string;
  alertDateTime?: string;
  [key: string]: unknown;
};

function toStatus(alertType?: string | number): string | undefined {
  if (alertType === undefined || alertType === null) return undefined;
  const normalized = String(alertType).toLowerCase();
  if (normalized === '2' || normalized.includes('up')) return 'resolved';
  if (normalized === '1' || normalized.includes('down')) return 'triggered';
  if (normalized.includes('pause')) return 'paused';
  return normalized;
}

export function transformUptimeRobotToEvent(data: UptimeRobotEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const status = toStatus(data.alertType);
  const summary =
    firstString(data.monitorFriendlyName, data.alertTypeFriendlyName) || 'UptimeRobot Alert';
  const severity =
    status === 'resolved' ? normalizeSeverity('info', 'info') : normalizeSeverity('critical');
  // Use monitorID or create stable key from monitor name (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(data.monitorID) ||
    `uptimerobot-${(data.monitorFriendlyName || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: normalizeEventAction(status, 'trigger'),
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'UptimeRobot',
      severity,
      custom_details: {
        alertType: data.alertType,
        alertDetails: data.alertDetails,
        alertDateTime: data.alertDateTime,
        raw: data,
      },
    },
  };
}
