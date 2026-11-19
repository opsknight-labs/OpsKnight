import { firstString } from './normalization';

export type UptimeRobotEvent = {
  alertType?: string | number;
  alertTypeFriendlyName?: string;
  monitorID?: string | number;
  monitorFriendlyName?: string;
  alertDetails?: string;
  alertDateTime?: string;
  [key: string]: unknown;
};

// UptimeRobot alertType: 1 down, 2 up, 3 SSL expiry; anything else (paused,
// started) is informational.
function toStatus(alertType?: string | number): 'down' | 'up' | 'ssl' | undefined {
  if (alertType === undefined || alertType === null) return undefined;
  const normalized = String(alertType).toLowerCase();
  if (normalized === '2' || normalized.includes('up')) return 'up';
  if (normalized === '1' || normalized.includes('down')) return 'down';
  if (normalized === '3' || normalized.includes('ssl')) return 'ssl';
  return undefined;
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
} | null {
  const status = toStatus(data.alertType);
  if (!status) return null;
  const monitorName =
    firstString(data.monitorFriendlyName, data.alertTypeFriendlyName) || 'UptimeRobot Alert';
  // Use monitorID or create stable key from monitor name (avoids Date.now() which defeats dedup)
  const monitorKey =
    firstString(data.monitorID) ||
    `uptimerobot-${(data.monitorFriendlyName || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: status === 'up' ? 'resolve' : 'trigger',
    // An SSL notice is a separate problem; a monitor UP must not resolve it.
    dedup_key: status === 'ssl' ? `${monitorKey}-ssl` : String(monitorKey),
    payload: {
      summary:
        status === 'ssl'
          ? `SSL certificate expiring: ${monitorName}`
          : status === 'down'
            ? `Monitor down: ${monitorName}`
            : monitorName,
      source: 'UptimeRobot',
      severity: status === 'up' ? 'info' : status === 'ssl' ? 'warning' : 'critical',
      custom_details: {
        alertType: data.alertType,
        alertDetails: data.alertDetails,
        alertDateTime: data.alertDateTime,
        raw: data,
      },
    },
  };
}
