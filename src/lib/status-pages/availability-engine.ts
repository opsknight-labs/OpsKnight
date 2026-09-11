import type { PublicServiceStatus, PublicStatusHistorySegment } from './public-contract';
import { getWorstPublicStatus, publicStatusForIncidentUrgency } from './status-presentation';

/**
 * One canonical availability engine for every public surface.
 *
 * Current status, service history, and 30/90-day uptime are all derived from the same merged
 * health intervals. Overlaps resolve with a sweep-line (O(n log n)), not a nested scan.
 * Maintenance is health, not downtime. UNKNOWN time is excluded from known availability so it
 * can never silently become green.
 */

export type PublicHistoryIncident = {
  serviceId: string;
  createdAt: Date;
  resolvedAt: Date | null;
  updatedAt?: Date | null;
  urgency: string;
  status: string;
};

/**
 * Empty / missing affected-service lists mean the maintenance is page-wide.
 * Never infer that from array emptiness at call sites — use `maintenanceScopeFromAffectedIds`.
 */
export type MaintenanceScope =
  | { type: 'ALL_SERVICES' }
  | { type: 'SERVICES'; serviceIds: readonly string[] };

export type PublicHistoryMaintenance = {
  startDate: Date;
  endDate: Date | null;
  affectedServiceIds: string[];
  scope?: MaintenanceScope;
};

/** A merged, non-overlapping span of non-operational health, in epoch milliseconds. */
export type HealthSegment = {
  start: number;
  end: number;
  status: Exclude<PublicServiceStatus, 'OPERATIONAL'>;
};

export function maintenanceScopeFromAffectedIds(ids: unknown): MaintenanceScope {
  if (!Array.isArray(ids) || ids.length === 0) return { type: 'ALL_SERVICES' };
  const serviceIds = ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return serviceIds.length === 0 ? { type: 'ALL_SERVICES' } : { type: 'SERVICES', serviceIds };
}

export function maintenanceAppliesToService(scope: MaintenanceScope, serviceId: string): boolean {
  return scope.type === 'ALL_SERVICES' || scope.serviceIds.includes(serviceId);
}

function scopeOf(item: PublicHistoryMaintenance): MaintenanceScope {
  return item.scope ?? maintenanceScopeFromAffectedIds(item.affectedServiceIds);
}

const DOWNTIME_STATUSES: ReadonlySet<PublicServiceStatus> = new Set([
  'DEGRADED',
  'PARTIAL_OUTAGE',
  'MAJOR_OUTAGE',
]);

function incidentIntervalEnd(incident: PublicHistoryIncident, windowEnd: Date): Date {
  return effectiveIncidentEnd(incident) ?? windowEnd;
}

/**
 * Close time used for history and uptime.
 *
 * Legacy resolved rows often stored the close time only on `updatedAt`. A null `resolvedAt` on a
 * RESOLVED incident must not be treated as still open through the reporting window.
 */
export function effectiveIncidentEnd(incident: PublicHistoryIncident): Date | null {
  if (incident.resolvedAt) return incident.resolvedAt;
  if (incident.status === 'RESOLVED') return incident.updatedAt ?? incident.createdAt;
  return null;
}

/**
 * Collapse a service's incidents and maintenance into merged non-overlapping health segments.
 *
 * Overlaps resolve to the worst status (an incident always outranks concurrent maintenance), and
 * touching same-status spans are joined, so the result is the minimal canonical interval set.
 */
export function buildServiceHealthSegments({
  serviceId,
  incidents,
  maintenance,
  start,
  end,
}: {
  serviceId: string;
  incidents: PublicHistoryIncident[];
  maintenance: PublicHistoryMaintenance[];
  start: Date;
  end: Date;
}): HealthSegment[] {
  if (end <= start) return [];
  const windowStart = start.getTime();
  const windowEnd = end.getTime();
  const raw: HealthSegment[] = [];
  const add = (from: Date, to: Date, status: PublicServiceStatus) => {
    const boundedStart = Math.max(windowStart, from.getTime());
    const boundedEnd = Math.min(windowEnd, to.getTime());
    if (boundedEnd > boundedStart && status !== 'OPERATIONAL') {
      raw.push({ start: boundedStart, end: boundedEnd, status });
    }
  };

  for (const incident of incidents) {
    if (
      incident.serviceId !== serviceId ||
      incident.status === 'SUPPRESSED' ||
      incident.status === 'SNOOZED'
    )
      continue;
    add(
      incident.createdAt,
      incidentIntervalEnd(incident, end),
      publicStatusForIncidentUrgency(incident.urgency)
    );
  }
  for (const item of maintenance) {
    if (!maintenanceAppliesToService(scopeOf(item), serviceId)) continue;
    add(item.startDate, item.endDate ?? end, 'MAINTENANCE');
  }

  return mergeHealthSegmentsSweep(raw);
}

type SweepEvent = { time: number; delta: 1 | -1; status: HealthSegment['status'] };

/** Sweep-line merge: sort endpoints once, track active severity counts, emit canonical intervals. */
function mergeHealthSegmentsSweep(raw: HealthSegment[]): HealthSegment[] {
  if (raw.length === 0) return [];
  const events: SweepEvent[] = [];
  for (const segment of raw) {
    events.push({ time: segment.start, delta: 1, status: segment.status });
    events.push({ time: segment.end, delta: -1, status: segment.status });
  }
  // Ends before starts at the same timestamp so a touching pair does not create a zero-width span.
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);

  let degraded = 0;
  let maintenance = 0;
  let partialOutage = 0;
  let majorOutage = 0;
  let unknown = 0;
  const merged: HealthSegment[] = [];
  let cursor: number | undefined;
  let current: HealthSegment['status'] | null = null;

  const applyDelta = (status: HealthSegment['status'], delta: 1 | -1) => {
    switch (status) {
      case 'DEGRADED':
        degraded += delta;
        return;
      case 'MAINTENANCE':
        maintenance += delta;
        return;
      case 'PARTIAL_OUTAGE':
        partialOutage += delta;
        return;
      case 'MAJOR_OUTAGE':
        majorOutage += delta;
        return;
      case 'UNKNOWN':
        unknown += delta;
    }
  };

  const worstActive = (): HealthSegment['status'] | null => {
    const active: PublicServiceStatus[] = [];
    if (degraded > 0) active.push('DEGRADED');
    if (maintenance > 0) active.push('MAINTENANCE');
    if (partialOutage > 0) active.push('PARTIAL_OUTAGE');
    if (majorOutage > 0) active.push('MAJOR_OUTAGE');
    if (unknown > 0) active.push('UNKNOWN');
    if (active.length === 0) return null;
    const worst = getWorstPublicStatus(active);
    return worst === 'OPERATIONAL' ? null : (worst as HealthSegment['status']);
  };

  for (const event of events) {
    if (cursor !== undefined && event.time > cursor && current) {
      const previous = merged.at(-1);
      if (previous?.status === current && previous.end === cursor) previous.end = event.time;
      else merged.push({ start: cursor, end: event.time, status: current });
    }
    applyDelta(event.status, event.delta);
    cursor = event.time;
    current = worstActive();
  }
  return merged;
}

/** Intersect merged health segments with a sub-window, preserving order and merging touches. */
export function clipHealthSegments(
  segments: HealthSegment[],
  start: Date,
  end: Date
): HealthSegment[] {
  const windowStart = start.getTime();
  const windowEnd = end.getTime();
  const clipped: HealthSegment[] = [];
  for (const segment of segments) {
    const from = Math.max(windowStart, segment.start);
    const to = Math.min(windowEnd, segment.end);
    if (to <= from) continue;
    const previous = clipped.at(-1);
    if (previous?.status === segment.status && previous.end === from) previous.end = to;
    else clipped.push({ start: from, end: to, status: segment.status });
  }
  return clipped;
}

/** Serialize merged health segments to the public history contract shape. */
export function healthSegmentsToPublic(segments: HealthSegment[]): PublicStatusHistorySegment[] {
  return segments.map(segment => ({
    startAt: new Date(segment.start).toISOString(),
    endAt: new Date(segment.end).toISOString(),
    status: segment.status,
  }));
}

/**
 * Status at an instant from the same intervals that drive history and uptime.
 * Endpoints are inclusive so a snapshot clock equal to the window end still sees open incidents.
 */
export function healthAt(
  segments: HealthSegment[],
  at: number
): { status: PublicServiceStatus; statusSince?: string } {
  const covering = segments.filter(
    segment => segment.start <= at && at <= segment.end && segment.start < segment.end
  );
  if (covering.length === 0) {
    let recoveredAt: number | undefined;
    for (const segment of segments) {
      if (segment.end <= at && (recoveredAt === undefined || segment.end > recoveredAt)) {
        recoveredAt = segment.end;
      }
    }
    return {
      status: 'OPERATIONAL',
      ...(recoveredAt !== undefined ? { statusSince: new Date(recoveredAt).toISOString() } : {}),
    };
  }
  const status = getWorstPublicStatus(covering.map(segment => segment.status));
  const since = covering
    .filter(segment => segment.status === status)
    .reduce((latest, segment) => Math.max(latest, segment.start), Number.NEGATIVE_INFINITY);
  return {
    status,
    ...(Number.isFinite(since) ? { statusSince: new Date(since).toISOString() } : {}),
  };
}

export type ServiceAvailability = {
  /** Null when there is no known time in the window — never reported as 100%. */
  percentage: number | null;
  knownMs: number;
  unknownMs: number;
  downtimeMs: number;
};

/**
 * Availability over a window, from the same segments that drive history.
 *
 * Known time: operational, maintenance, degraded, partial, major.
 * UNKNOWN time is excluded from the known denominator so a fully-unknown window is not 100%.
 * Downtime is degraded / partial / major only; maintenance counts as known-available.
 */
export function serviceAvailability(
  segments: HealthSegment[],
  start: Date,
  end: Date
): ServiceAvailability {
  const windowStart = start.getTime();
  const windowEnd = end.getTime();
  const total = windowEnd - windowStart;
  if (total <= 0) return { percentage: null, knownMs: 0, unknownMs: 0, downtimeMs: 0 };
  let unknownMs = 0;
  let downtimeMs = 0;
  for (const segment of segments) {
    const from = Math.max(windowStart, segment.start);
    const to = Math.min(windowEnd, segment.end);
    if (to <= from) continue;
    const span = to - from;
    if (segment.status === 'UNKNOWN') unknownMs += span;
    else if (DOWNTIME_STATUSES.has(segment.status)) downtimeMs += span;
  }
  const knownMs = total - unknownMs;
  if (knownMs <= 0) return { percentage: null, knownMs: 0, unknownMs, downtimeMs };
  return {
    percentage: Math.max(0, Math.min(100, ((knownMs - downtimeMs) / knownMs) * 100)),
    knownMs,
    unknownMs,
    downtimeMs,
  };
}

/** Availability percentage, or null when the window has no known time. */
export function serviceUptimePercent(
  segments: HealthSegment[],
  start: Date,
  end: Date
): number | null {
  return serviceAvailability(segments, start, end).percentage;
}
