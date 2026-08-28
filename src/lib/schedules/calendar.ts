export type CalendarShiftIdentity = {
  id: string;
  start: string;
  end: string;
  label: string;
  layerId?: string | null;
  userId?: string | null;
  source?: string | null;
};

export type CalendarShiftSegment = {
  start: string;
  end: string;
};

export type CalendarDayShift<T extends CalendarShiftIdentity = CalendarShiftIdentity> = T & {
  groupKey: string;
  segments: CalendarShiftSegment[];
  spansDayBoundary: boolean;
};

function identityPart(value: string | null | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

/**
 * Calendar cells are a summary of logical coverage, not a raw event log.
 * A single responder/layer can legitimately have two raw blocks touching the
 * same civil day (for example 00:00-06:30 and 18:30-24:00 for an overnight
 * rotation). Group those fragments into one cell entry while retaining every
 * clipped coverage window for tooltips/details.
 */
export function groupCalendarShiftsForDay<T extends CalendarShiftIdentity>(
  shifts: readonly T[],
  dayStart: Date,
  dayEnd: Date
): CalendarDayShift<T>[] {
  const dayStartMs = dayStart.getTime();
  const dayEndMs = dayEnd.getTime();
  if (!Number.isFinite(dayStartMs) || !Number.isFinite(dayEndMs) || dayEndMs <= dayStartMs) {
    return [];
  }

  const grouped = new Map<string, CalendarDayShift<T>>();

  for (const shift of shifts) {
    const shiftStartMs = new Date(shift.start).getTime();
    const shiftEndMs = new Date(shift.end).getTime();
    if (!Number.isFinite(shiftStartMs) || !Number.isFinite(shiftEndMs) || shiftEndMs <= shiftStartMs) {
      continue;
    }
    if (shiftStartMs >= dayEndMs || shiftEndMs <= dayStartMs) {
      continue;
    }

    const layerKey = identityPart(shift.layerId, shift.label.split(':')[0]?.trim() || shift.label);
    const userKey = identityPart(shift.userId, shift.label);
    const sourceKey = identityPart(shift.source, 'layer');
    const groupKey = `${layerKey}\u0000${userKey}\u0000${sourceKey}`;
    const segment = {
      start: new Date(Math.max(shiftStartMs, dayStartMs)).toISOString(),
      end: new Date(Math.min(shiftEndMs, dayEndMs)).toISOString(),
    };
    const spansDayBoundary = shiftStartMs < dayStartMs || shiftEndMs > dayEndMs;

    const existing = grouped.get(groupKey);
    if (existing) {
      existing.segments.push(segment);
      existing.spansDayBoundary = existing.spansDayBoundary || spansDayBoundary;
      continue;
    }

    grouped.set(groupKey, {
      ...shift,
      groupKey,
      segments: [segment],
      spansDayBoundary,
    });
  }

  return [...grouped.values()]
    .map(shift => ({
      ...shift,
      segments: [...shift.segments].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      ),
    }))
    .sort((a, b) => {
      const timeDiff =
        new Date(a.segments[0]?.start ?? a.start).getTime() -
        new Date(b.segments[0]?.start ?? b.start).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.label.localeCompare(b.label);
    });
}
