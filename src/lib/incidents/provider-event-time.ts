import type { Prisma } from '@prisma/client';

type OrderedAction = 'trigger' | 'resolve';

const RECENT_ALERTS = 10;
// Alertmanager and Grafana send this for "no end yet".
const ZERO_TIME = /^0001-01-01/;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toMs(value: unknown): number | null {
  if (typeof value === 'number') {
    // Google Cloud Monitoring sends epoch seconds.
    return Number.isFinite(value) && value > 0 ? (value < 1e11 ? value * 1000 : value) : null;
  }
  if (typeof value !== 'string' || !value || ZERO_TIME.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * When the PROVIDER says this state change happened, or null when the provider gives no usable
 * time. Read from the event's own `custom_details`, which every adapter already stores per event.
 * Only providers with an unambiguous per-event time are listed; others are never reordered.
 */
export function providerEventTimeMs(
  integrationType: string,
  action: OrderedAction,
  details: unknown
): number | null {
  const d = record(details);
  if (!d) return null;
  switch (integrationType) {
    case 'CLOUDWATCH':
      return toMs(d.stateChangeTime);
    case 'AZURE':
      return toMs(action === 'resolve' ? d.resolvedDateTime : d.firedDateTime);
    case 'GOOGLE_CLOUD_MONITORING': {
      const incident = record(d.incident);
      return incident ? toMs(action === 'resolve' ? incident.ended_at : incident.started_at) : null;
    }
    case 'GRAFANA':
    case 'PROMETHEUS':
      return toMs(action === 'resolve' ? d.endsAt : d.startsAt);
    default:
      return null;
  }
}

/**
 * A trigger or resolve whose provider time is OLDER than the newest provider time already accepted
 * for the same dedup key is a late retry or an out-of-order delivery: applying it would reopen or
 * re-close an incident from stale state. Returns the two times when that is the case. A provider
 * without a time, or a key with no earlier timed event, is never stale. Call under the dedup-key lock.
 */
export async function findStaleProviderEvent(
  tx: Prisma.TransactionClient,
  input: {
    serviceId: string;
    dedupKeys: string[];
    integrationType: string;
    action: OrderedAction;
    details: unknown;
  }
): Promise<{ incomingMs: number; lastAcceptedMs: number } | null> {
  const incomingMs = providerEventTimeMs(input.integrationType, input.action, input.details);
  if (incomingMs === null) return null;
  const recent = await tx.alert.findMany({
    where: { serviceId: input.serviceId, dedupKey: { in: input.dedupKeys } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: RECENT_ALERTS,
    select: { status: true, payload: true },
  });
  let lastAcceptedMs: number | null = null;
  for (const row of recent) {
    const ms = providerEventTimeMs(
      input.integrationType,
      row.status === 'RESOLVED' ? 'resolve' : 'trigger',
      record(row.payload)?.custom_details
    );
    if (ms !== null && (lastAcceptedMs === null || ms > lastAcceptedMs)) lastAcceptedMs = ms;
  }
  return lastAcceptedMs !== null && incomingMs < lastAcceptedMs
    ? { incomingMs, lastAcceptedMs }
    : null;
}
