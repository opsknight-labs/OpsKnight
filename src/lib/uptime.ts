import {
  intersectInterval,
  intervalDurationMs,
  intervalGaps,
  type TimeInterval,
} from './metrics/domain/interval';

/**
 * The one uptime rule for services (SLO evaluation, analytics, uptime exports).
 *
 *   uptime = (period - downtime) / period
 *
 * - period is [periodStart, periodEnd), moved forward to the service's createdAt, so a new service is
 *   measured only from the day it existed instead of reporting 100% for time before it.
 * - downtime is the union of recorded outage intervals [incident.createdAt, incident.resolvedAt ?? periodEnd]
 *   clipped to the period. The incident's current status does not matter: a snoozed, suppressed or
 *   acknowledged incident is still an outage until it is resolved, so a past period does not change when
 *   someone snoozes an incident later. Overlapping incidents count once.
 * - planned maintenance is not downtime: the service's recorded maintenance windows are taken out of the
 *   outage intervals, whatever the incident's status (an operator-suppressed incident with no window
 *   still counts). The period itself is not shortened, so a quiet maintenance day reports 100%.
 * - a period with no measurable time reports 100% and zero downtime.
 */

export type OutageIncident = {
  createdAt: Date;
  resolvedAt: Date | null;
  updatedAt?: Date | null;
  status: string;
};

export type UptimeResult = {
  /** 0 to 100. */
  uptimePercent: number;
  downtimeMs: number;
  /** Measured time after the createdAt clamp; 0 when nothing could be measured. */
  periodMs: number;
};

/** When the incident stopped being an outage, or null while it is still open. */
function outageEnd(incident: OutageIncident): Date | null {
  if (incident.resolvedAt) return incident.resolvedAt;
  // shortcut: legacy RESOLVED rows without resolvedAt close at updatedAt, which later edits can move.
  if (incident.status === 'RESOLVED') return incident.updatedAt ?? incident.createdAt;
  return null;
}

export function computeUptime(input: {
  periodStart: Date;
  periodEnd: Date;
  /** Start of the measured subject's life; omit when unknown. */
  createdAt?: Date | null;
  incidents: readonly OutageIncident[];
  /** The subject's recorded maintenance windows; time inside them never counts as downtime. */
  maintenanceWindows?: readonly TimeInterval[];
}): UptimeResult {
  const start =
    input.createdAt && input.createdAt > input.periodStart ? input.createdAt : input.periodStart;
  const period: TimeInterval = { start, end: input.periodEnd };
  const periodMs = period.end.getTime() - period.start.getTime();
  if (!(periodMs > 0)) return { uptimePercent: 100, downtimeMs: 0, periodMs: 0 };

  const outages = input.incidents
    .map(incident =>
      intersectInterval(
        { start: incident.createdAt, end: outageEnd(incident) ?? input.periodEnd },
        period
      )
    )
    .filter((interval): interval is TimeInterval => interval !== null);
  const maintenance = [...(input.maintenanceWindows ?? [])];
  const downtimeMs = intervalDurationMs(
    maintenance.length ? outages.flatMap(outage => intervalGaps(outage, maintenance)) : outages
  );
  return {
    uptimePercent: Math.max(0, Math.min(100, ((periodMs - downtimeMs) / periodMs) * 100)),
    downtimeMs,
    periodMs,
  };
}
