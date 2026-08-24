export type StatusAgeEntry = { status: string; avgMs: number | null };

export type OnCallShift = {
  start: Date;
  end: Date;
  userId: string;
};

export type OnCallLoadEntry = {
  id: string;
  name: string;
  hoursMs: number;
  incidentCount: number;
};

export type ServiceSlaEntry = {
  id: string;
  name: string;
  ackRate: number;
  resolveRate: number;
  total: number;
};

export function calculatePercentile(values: number[], percentileValue: number): number | null {
  if (!values || values.length === 0 || !Number.isFinite(percentileValue)) return null;
  const valid = values
    .filter(v => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (valid.length === 0) return null;

  const clampedP = Math.max(0, Math.min(100, percentileValue));
  const rank = (clampedP / 100) * (valid.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return valid[lower];
  const weight = rank - lower;
  return valid[lower] * (1 - weight) + valid[upper] * weight;
}

export function calculateMtbfMs(
  dates: Date[],
  windowStart?: Date,
  windowEnd?: Date,
  downtimeMs: number = 0
): number {
  const failureCount = dates.length;
  if (failureCount === 0) {
    if (!windowStart || !windowEnd) return 0;
    return windowEnd.getTime() - windowStart.getTime();
  }
  if (!windowStart || !windowEnd) {
    // Legacy behaviour: total span / failure count (original formula)
    if (dates.length === 0) return 0;
    if (dates.length === 1) return 0;
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
    const totalSpan = sorted[sorted.length - 1].getTime() - sorted[0].getTime();
    return totalSpan / dates.length;
  }
  const totalOperatingTimeMs = windowEnd.getTime() - windowStart.getTime() - downtimeMs;
  return Math.max(0, totalOperatingTimeMs) / failureCount;
}

export function smoothSeries(values: number[], windowSize: number): number[] {
  if (!Number.isFinite(windowSize) || windowSize <= 1 || values.length <= 1) {
    return values;
  }

  const window = Math.max(1, Math.floor(windowSize));
  return values.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = values.slice(start, index + 1);
    const sum = slice.reduce((acc, val) => acc + val, 0);
    return slice.length ? sum / slice.length : 0;
  });
}

export function buildStatusAges(
  incidents: Array<{
    status: string;
    createdAt: Date;
    updatedAt?: Date | null;
    resolvedAt?: Date | null;
  }>,
  now: Date,
  statusOrder: string[]
): StatusAgeEntry[] {
  const statusAgeMap = new Map<string, { totalMs: number; count: number }>();
  for (const incident of incidents) {
    const resolvedAt = incident.resolvedAt || incident.updatedAt;
    const durationMs =
      incident.status === 'RESOLVED' && resolvedAt
        ? resolvedAt.getTime() - incident.createdAt.getTime()
        : now.getTime() - incident.createdAt.getTime();
    const current = statusAgeMap.get(incident.status) || { totalMs: 0, count: 0 };
    current.totalMs += durationMs;
    current.count += 1;
    statusAgeMap.set(incident.status, current);
  }

  return statusOrder.map(status => {
    const data = statusAgeMap.get(status);
    const avgMs = data && data.count ? data.totalMs / data.count : null;
    return { status, avgMs };
  });
}

export function buildOnCallLoad(
  shifts: OnCallShift[],
  incidents: Array<{ createdAt: Date }>,
  windowStart: Date,
  windowEnd: Date,
  userNameMap: Map<string, string>,
  limit: number = 6
): OnCallLoadEntry[] {
  const onCallLoadMap = new Map<string, { hoursMs: number; incidentCount: number }>();

  for (const shift of shifts) {
    const shiftStart = shift.start < windowStart ? windowStart : shift.start;
    const shiftEnd = shift.end > windowEnd ? windowEnd : shift.end;
    if (shiftEnd <= shiftStart) {
      continue;
    }
    const entry = onCallLoadMap.get(shift.userId) || { hoursMs: 0, incidentCount: 0 };
    entry.hoursMs += shiftEnd.getTime() - shiftStart.getTime();
    onCallLoadMap.set(shift.userId, entry);
  }

  // Optimize incident-to-shift matching using sorted arrays and pointers
  const sortedShifts = [...shifts].sort((a, b) => a.start.getTime() - b.start.getTime());
  const sortedIncidents = [...incidents].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  let shiftIdx = 0;
  for (const incident of sortedIncidents) {
    const time = incident.createdAt.getTime();

    // Fast-forward shifts that ended before this incident
    while (shiftIdx < sortedShifts.length && sortedShifts[shiftIdx].end.getTime() < time) {
      shiftIdx++;
    }

    // Check current and subsequent shifts that might overlap with this incident time
    // Usually only one shift matches, but on-call rotations might have overlaps
    let currentIdx = shiftIdx;
    while (currentIdx < sortedShifts.length && sortedShifts[currentIdx].start.getTime() <= time) {
      const shift = sortedShifts[currentIdx];
      if (time <= shift.end.getTime()) {
        const entry = onCallLoadMap.get(shift.userId) || { hoursMs: 0, incidentCount: 0 };
        entry.incidentCount += 1;
        onCallLoadMap.set(shift.userId, entry);
      }
      currentIdx++;
    }
  }

  return Array.from(onCallLoadMap.entries())
    .map(([userId, stats]) => ({
      id: userId,
      name: userNameMap.get(userId) || 'Unknown user',
      hoursMs: stats.hoursMs,
      incidentCount: stats.incidentCount,
    }))
    .sort((a, b) => b.incidentCount - a.incidentCount)
    .slice(0, limit);
}

export function buildServiceSlaTable(
  incidents: Array<{
    id: string;
    createdAt: Date;
    status: string;
    resolvedAt: Date | null;
    updatedAt: Date | null;
    serviceId: string;
  }>,
  ackMap: Map<string, Date>,
  serviceTargets: Map<string, { ackMinutes: number; resolveMinutes: number }>,
  serviceNameMap: Map<string, string>,
  defaultAckMinutes: number = 15,
  defaultResolveMinutes: number = 120,
  limit: number = 8,
  now: Date = new Date()
): ServiceSlaEntry[] {
  const serviceSlaStats = new Map<
    string,
    { ackMet: number; ackTotal: number; resolveMet: number; resolveTotal: number }
  >();

  for (const incident of incidents) {
    const targets = serviceTargets.get(incident.serviceId);
    const ackTargetMinutes = targets?.ackMinutes ?? defaultAckMinutes;
    const resolveTargetMinutes = targets?.resolveMinutes ?? defaultResolveMinutes;
    const current = serviceSlaStats.get(incident.serviceId) || {
      ackMet: 0,
      ackTotal: 0,
      resolveMet: 0,
      resolveTotal: 0,
    };

    const ackedAt = ackMap.get(incident.id);
    if (ackedAt) {
      current.ackTotal += 1;
      const diffMinutes = (ackedAt.getTime() - incident.createdAt.getTime()) / 60000;
      if (diffMinutes <= ackTargetMinutes) {
        current.ackMet += 1;
      }
    } else if (incident.status !== 'RESOLVED') {
      // Active incidents become evaluated SLA breaches once their
      // acknowledgement deadline passes. Omitting them from the denominator
      // can otherwise report 100% compliance while incidents remain unacked.
      const ageMinutes = (now.getTime() - incident.createdAt.getTime()) / 60000;
      if (ageMinutes > ackTargetMinutes) current.ackTotal += 1;
    }

    if (incident.status === 'RESOLVED') {
      const resolvedAt = incident.resolvedAt || incident.updatedAt;
      if (resolvedAt) {
        current.resolveTotal += 1;
        const diffMinutes = (resolvedAt.getTime() - incident.createdAt.getTime()) / 60000;
        if (diffMinutes <= resolveTargetMinutes) {
          current.resolveMet += 1;
        }
      }
    }

    serviceSlaStats.set(incident.serviceId, current);
  }

  return Array.from(serviceSlaStats.entries())
    .map(([serviceId, stats]) => ({
      id: serviceId,
      name: serviceNameMap.get(serviceId) || 'Deleted service',
      ackRate: stats.ackTotal ? (stats.ackMet / stats.ackTotal) * 100 : 0,
      resolveRate: stats.resolveTotal ? (stats.resolveMet / stats.resolveTotal) * 100 : 0,
      total: Math.max(stats.ackTotal, stats.resolveTotal),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
