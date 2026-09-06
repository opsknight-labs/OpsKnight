import { normalizeSeverity, firstString } from './normalization';

export type UptimeKumaEvent = {
  heartbeat?: {
    status?: number | string | null;
    msg?: string | null;
    monitorID?: number | string | null;
  };
  monitor?: {
    id?: number | string | null;
    name?: string | null;
    url?: string | null;
  };
  status?: string | null;
  msg?: string | null;
  [key: string]: unknown;
};

function mapAction(
  status?: number | string | null,
  statusText?: string | null
): 'trigger' | 'resolve' {
  if (typeof status === 'number') {
    return status === 1 ? 'resolve' : 'trigger';
  }
  if (typeof status === 'string') {
    const numeric = Number(status);
    if (!Number.isNaN(numeric)) {
      return numeric === 1 ? 'resolve' : 'trigger';
    }
  }
  const normalized = statusText?.toLowerCase();
  if (normalized && (normalized.includes('up') || normalized.includes('resolved'))) {
    return 'resolve';
  }
  return 'trigger';
}

export function transformUptimeKumaToEvent(data: UptimeKumaEvent): {
  event_action: 'trigger' | 'resolve';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const summary =
    firstString(data.monitor?.name, data.msg, data.heartbeat?.msg) || 'Uptime Kuma Alert';
  const action = mapAction(data.heartbeat?.status, data.status);
  const severity =
    action === 'resolve' ? normalizeSeverity('info', 'info') : normalizeSeverity('critical');
  // Use monitor ID or create stable key from monitor name (avoids Date.now() which defeats dedup)
  const dedupKey =
    firstString(data.heartbeat?.monitorID, data.monitor?.id) ||
    `uptime-kuma-${(data.monitor?.name || 'unknown').replace(/\s+/g, '-').toLowerCase().slice(0, 100)}`;

  return {
    event_action: action,
    dedup_key: String(dedupKey),
    payload: {
      summary,
      source: 'Uptime Kuma',
      severity,
      custom_details: {
        heartbeat: data.heartbeat,
        monitor: data.monitor,
        raw: data,
      },
    },
  };
}
