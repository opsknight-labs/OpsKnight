import {
  getTimeZoneOffsetMs,
  resolveLocalDateTimeInTimeZone,
  type LocalDateTimeParts,
} from './timezone';

type LayerUser = {
  userId: string;
  user: { name: string; avatarUrl?: string | null; gender?: string | null };
  position: number;
};

export type LayerRestrictions = {
  daysOfWeek?: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  startHour?: number; // 0-23
  endHour?: number; // 0-23
};

export type LayerInput = {
  id: string;
  name: string;
  start: Date;
  end: Date | null;
  rotationLengthHours: number;
  shiftLengthHours?: number | null;
  restrictions?: LayerRestrictions | null;
  priority?: number;
  users: LayerUser[];
};

export type OverrideInput = {
  id: string;
  userId: string;
  user: { name: string; avatarUrl?: string | null; gender?: string | null };
  start: Date;
  end: Date;
  replacesUserId: string | null;
};

export type OnCallBlock = {
  id: string;
  start: Date;
  end: Date;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  userGender?: string | null;
  layerId: string;
  layerName: string;
  source: 'rotation' | 'override';
  isAdditiveOverride?: boolean;
};

const weekdayHourFormatterCache = new Map<string, Intl.DateTimeFormat>();
const localDateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getWeekdayHourFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = weekdayHourFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
      hourCycle: 'h23',
    });
    weekdayHourFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function getLocalDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = localDateTimeFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    localDateTimeFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function getDayHourInTimeZone(date: Date, timeZone: string): { day: number; hour: number } {
  const parts = getWeekdayHourFormatter(timeZone).formatToParts(date);

  const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;

  const day =
    weekday === 'Sun'
      ? 0
      : weekday === 'Mon'
        ? 1
        : weekday === 'Tue'
          ? 2
          : weekday === 'Wed'
            ? 3
            : weekday === 'Thu'
              ? 4
              : weekday === 'Fri'
                ? 5
                : weekday === 'Sat'
                  ? 6
                  : 0;

  return { day, hour };
}

function getLocalDateTimeParts(date: Date, timeZone: string): Required<LocalDateTimeParts> {
  const parts = getLocalDateTimeFormatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value ?? '0');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
    millisecond: date.getUTCMilliseconds(),
  };
}

function resolveShiftedWallClock(
  base: Date,
  timeZone: string,
  mutateUtcParts: (date: Date) => void,
  fallbackMs: number
): Date {
  const local = getLocalDateTimeParts(base, timeZone);
  const pseudoUtc = new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
      local.millisecond
    )
  );
  mutateUtcParts(pseudoUtc);

  const resolved = resolveLocalDateTimeInTimeZone(
    {
      year: pseudoUtc.getUTCFullYear(),
      month: pseudoUtc.getUTCMonth() + 1,
      day: pseudoUtc.getUTCDate(),
      hour: pseudoUtc.getUTCHours(),
      minute: pseudoUtc.getUTCMinutes(),
      second: pseudoUtc.getUTCSeconds(),
      millisecond: pseudoUtc.getUTCMilliseconds(),
    },
    timeZone,
    'compatible'
  );

  // The timezone was already validated when the schedule was created. Keep a
  // deterministic elapsed-time fallback for corrupted legacy rows rather than
  // returning an invalid Date and poisoning the entire escalation path.
  return resolved ?? new Date(base.getTime() + fallbackMs);
}

function addCalendarDaysInTimeZone(base: Date, days: number, timeZone: string): Date {
  if (!Number.isInteger(days)) {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  }
  return resolveShiftedWallClock(
    base,
    timeZone,
    date => date.setUTCDate(date.getUTCDate() + days),
    days * 24 * 60 * 60 * 1000
  );
}

function addCalendarHoursInTimeZone(base: Date, hours: number, timeZone: string): Date {
  if (!Number.isInteger(hours)) {
    return new Date(base.getTime() + hours * 60 * 60 * 1000);
  }
  return resolveShiftedWallClock(
    base,
    timeZone,
    date => date.setUTCHours(date.getUTCHours() + hours),
    hours * 60 * 60 * 1000
  );
}

function isCalendarAnchoredRotation(rotationLengthHours: number): boolean {
  if (!Number.isInteger(rotationLengthHours) || rotationLengthHours <= 0) return false;
  return (
    rotationLengthHours % 24 === 0 || (rotationLengthHours < 24 && 24 % rotationLengthHours === 0)
  );
}

function getRotationStartAtIndex(
  layerStart: Date,
  index: number,
  rotationLengthHours: number,
  timeZone: string
): Date {
  // The stored start is already an exact instant. Reinterpreting index 0 as a
  // wall-clock value can move a start in the second occurrence of a fall-back
  // overlap to the first occurrence, creating coverage before layer.start.
  if (index === 0) return new Date(layerStart);

  if (rotationLengthHours % 24 === 0) {
    return addCalendarDaysInTimeZone(layerStart, index * (rotationLengthHours / 24), timeZone);
  }
  if (isCalendarAnchoredRotation(rotationLengthHours)) {
    return addCalendarHoursInTimeZone(layerStart, index * rotationLengthHours, timeZone);
  }
  return new Date(layerStart.getTime() + index * rotationLengthHours * 60 * 60 * 1000);
}

function splitBlockByRestrictions(
  start: Date,
  end: Date,
  timeZone: string,
  daysOfWeek?: number[],
  startHour?: number,
  endHour?: number
): Array<{ start: Date; end: Date }> {
  const result: Array<{ start: Date; end: Date }> = [];

  let cursor = new Date(start);
  let segStart: Date | null = null;

  while (cursor < end) {
    const { day, hour } = getDayHourInTimeZone(cursor, timeZone);
    let allowed = true;
    // For overnight shifts (startHour > endHour), hours between 00:00 and endHour belong to the shift that started the previous day.
    const isOvernight = startHour != null && endHour != null && startHour > endHour;
    const effectiveDay = isOvernight && hour < endHour ? (day + 6) % 7 : day;

    // Check day restriction
    if (daysOfWeek && daysOfWeek.length > 0 && !daysOfWeek.includes(effectiveDay)) {
      allowed = false;
    }

    // Check hour restriction
    if (allowed && startHour != null && endHour != null) {
      if (startHour === endHour) {
        // startHour === endHour represents an unrestricted 24-hour window
        allowed = true;
      } else if (startHour < endHour) {
        // Normal range (e.g., 09:00 - 17:00)
        if (hour < startHour || hour >= endHour) allowed = false;
      } else {
        // Overnight range (e.g., 18:00 - 06:00)
        if (hour < startHour && hour >= endHour) allowed = false;
      }
    } else if (allowed && startHour != null && hour < startHour) {
      allowed = false;
    } else if (allowed && endHour != null && hour >= endHour) {
      allowed = false;
    }

    // Advance to next local hour boundary or end (handles fractional timezones +5:30, +5:45, +12:45)
    const offsetMs = getTimeZoneOffsetMs(cursor, timeZone);
    const localMs = cursor.getTime() + offsetMs;
    const nextLocalHourMs = 3600000 - (localMs % 3600000);
    const stepMs = Math.min(Math.max(nextLocalHourMs, 60000), 3600000);
    const nextCursor = new Date(Math.min(cursor.getTime() + stepMs, end.getTime()));

    if (allowed) {
      if (!segStart) segStart = new Date(cursor);
    } else if (segStart) {
      result.push({ start: segStart, end: new Date(cursor) });
      segStart = null;
    }

    if (nextCursor.getTime() <= cursor.getTime()) {
      break;
    }
    cursor = nextCursor;
  }

  // Close any open segment
  if (segStart) {
    result.push({ start: segStart, end: new Date(Math.min(cursor.getTime(), end.getTime())) });
  }

  return result;
}

function generateLayerBlocks(
  layer: LayerInput,
  windowStart: Date,
  windowEnd: Date,
  timeZone: string
): OnCallBlock[] {
  const sortedUsers = [...layer.users].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  if (sortedUsers.length === 0) {
    return [];
  }

  const rotationMs = layer.rotationLengthHours * 60 * 60 * 1000;
  const shiftHours = layer.shiftLengthHours || layer.rotationLengthHours;
  const shiftMs = shiftHours * 60 * 60 * 1000;
  const calendarAnchoredRotation = isCalendarAnchoredRotation(layer.rotationLengthHours);

  if (
    rotationMs <= 0 ||
    shiftMs <= 0 ||
    !Number.isFinite(rotationMs) ||
    !Number.isFinite(shiftMs)
  ) {
    return [];
  }

  const layerStart = layer.start;
  const layerEnd = layer.end ? new Date(layer.end) : null;
  const maxShiftMs = Math.max(rotationMs, shiftMs);
  const effectiveWindowStart = new Date(windowStart.getTime() - maxShiftMs);

  if (layerEnd && effectiveWindowStart >= layerEnd) {
    return [];
  }

  const blocks: OnCallBlock[] = [];

  // Seek close to the requested range using elapsed time, then intentionally
  // rewind across the largest civil-time jump supported by the resolver. This
  // keeps expansion O(window size) rather than O(schedule age), while giving
  // us enough history to establish a monotonic boundary floor around unusual
  // transitions such as Pacific/Apia's skipped day.
  let index = 0;
  if (layerStart < effectiveWindowStart) {
    const elapsed = effectiveWindowStart.getTime() - layerStart.getTime();
    index = Math.max(0, Math.floor(elapsed / rotationMs));
    const transitionLookbackSlots = calendarAnchoredRotation
      ? Math.ceil((48 * 60 * 60 * 1000) / rotationMs) + 2
      : 2;
    index = Math.max(0, index - transitionLookbackSlots);
  }

  const initialIndex = index;
  const maxIterations = 1_000_000;
  let rawRotationStart = getRotationStartAtIndex(
    layerStart,
    index,
    layer.rotationLengthHours,
    timeZone
  );
  let monotonicBoundaryMs = rawRotationStart.getTime();

  while (index - initialIndex < maxIterations) {
    const rawNextRotationStart = getRotationStartAtIndex(
      layerStart,
      index + 1,
      layer.rotationLengthHours,
      timeZone
    );
    const rawNextMs = rawNextRotationStart.getTime();

    // Generated wall-clock boundaries can collapse or even move backward when
    // a timezone skips a large civil interval (for example Apia skipped an
    // entire day). Never let a later nominal index rewind the real timeline.
    // Collapsed/backward positions still consume responder rotation parity but
    // do not emit duplicate or overlapping coverage.
    if (rawNextMs <= monotonicBoundaryMs) {
      index++;
      rawRotationStart = rawNextRotationStart;
      continue;
    }

    const rotationStart = new Date(
      Math.max(rawRotationStart.getTime(), monotonicBoundaryMs, layerStart.getTime())
    );
    const nextRotationStart = rawNextRotationStart;

    if (rotationStart >= windowEnd) break;
    if (layerEnd && rotationStart >= layerEnd) break;

    let rawEnd: Date;
    if (shiftHours === layer.rotationLengthHours) {
      // Full-duty slots meet exactly at the next monotonic rotation boundary.
      rawEnd = nextRotationStart;
    } else if (!calendarAnchoredRotation) {
      rawEnd = new Date(rotationStart.getTime() + shiftMs);
    } else if (shiftHours % 24 === 0) {
      rawEnd = addCalendarDaysInTimeZone(rotationStart, shiftHours / 24, timeZone);
    } else {
      rawEnd = addCalendarHoursInTimeZone(rotationStart, shiftHours, timeZone);
    }

    const blockEnd = layerEnd && rawEnd > layerEnd ? layerEnd : rawEnd;

    if (blockEnd > rotationStart && blockEnd > effectiveWindowStart) {
      const user = sortedUsers[index % sortedUsers.length];
      const clampedStart = rotationStart < windowStart ? windowStart : rotationStart;
      const clampedEnd = blockEnd > windowEnd ? windowEnd : blockEnd;

      if (clampedStart < clampedEnd) {
        if (layer.restrictions) {
          const { daysOfWeek, startHour, endHour } = layer.restrictions;
          const subBlocks = splitBlockByRestrictions(
            clampedStart,
            clampedEnd,
            timeZone,
            daysOfWeek,
            startHour,
            endHour
          );
          for (const sub of subBlocks) {
            blocks.push({
              id: `${layer.id}-${index}-${sub.start.getTime()}`,
              start: sub.start,
              end: sub.end,
              userId: user.userId,
              userName: user.user.name,
              userAvatar: user.user.avatarUrl,
              userGender: user.user.gender,
              layerId: layer.id,
              layerName: layer.name,
              source: 'rotation',
            });
          }
        } else {
          blocks.push({
            id: `${layer.id}-${index}`,
            start: clampedStart,
            end: clampedEnd,
            userId: user.userId,
            userName: user.user.name,
            userAvatar: user.user.avatarUrl,
            userGender: user.user.gender,
            layerId: layer.id,
            layerName: layer.name,
            source: 'rotation',
          });
        }
      }
    }

    monotonicBoundaryMs = rawNextMs;
    index++;
    rawRotationStart = rawNextRotationStart;
  }

  if (index - initialIndex >= maxIterations) {
    throw new RangeError(
      'Requested on-call schedule window exceeds the safe rotation expansion limit.'
    );
  }

  return blocks;
}

function applyOverrides(
  blocks: OnCallBlock[],
  overrides: OverrideInput[],
  windowStart: Date,
  windowEnd: Date
): OnCallBlock[] {
  const sortedOverrides = [...overrides].sort((a, b) => a.start.getTime() - b.start.getTime());
  let result = [...blocks];

  for (const override of sortedOverrides) {
    if (!override.replacesUserId) {
      const start = override.start > windowStart ? override.start : windowStart;
      const end = override.end < windowEnd ? override.end : windowEnd;
      if (start >= end) continue;
      result.push({
        id: `override-${override.id}`,
        start,
        end,
        userId: override.userId,
        userName: override.user.name,
        userAvatar: override.user.avatarUrl,
        userGender: override.user.gender,
        layerId: 'override',
        layerName: 'Additive Override',
        source: 'override',
        isAdditiveOverride: true,
      });
      continue;
    }
    const next: OnCallBlock[] = [];

    for (const block of result) {
      if (override.end <= block.start || override.start >= block.end) {
        next.push(block);
        continue;
      }

      if (override.replacesUserId && override.replacesUserId !== block.userId) {
        next.push(block);
        continue;
      }

      const overrideStart = override.start > block.start ? override.start : block.start;
      const overrideEnd = override.end < block.end ? override.end : block.end;

      if (block.start < overrideStart) {
        next.push({ ...block, id: `${block.id}-pre-split`, end: overrideStart });
      }

      next.push({
        ...block,
        id: `${block.id}-override-${override.id}`,
        start: overrideStart,
        end: overrideEnd,
        userId: override.userId,
        userName: override.user.name,
        userAvatar: override.user.avatarUrl,
        userGender: override.user.gender,
        source: 'override',
      });

      if (overrideEnd < block.end) {
        next.push({ ...block, id: `${block.id}-post-split`, start: overrideEnd });
      }
    }

    result = next;
  }

  return result.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function buildScheduleBlocks(
  layers: LayerInput[],
  overrides: OverrideInput[],
  windowStart: Date,
  windowEnd: Date,
  timeZone: string = 'UTC'
) {
  const blocks = layers.flatMap(layer =>
    generateLayerBlocks(layer, windowStart, windowEnd, timeZone)
  );
  return applyOverrides(blocks, overrides, windowStart, windowEnd);
}

/**
 * Generates the final effective schedule by merging all layers.
 * Higher priority layers override lower priority layers during overlaps.
 * Returns a flattened list of non-overlapping blocks.
 */
export function getFinalScheduleBlocks(
  blocks: OnCallBlock[],
  layerPriority: Map<string, number>
): OnCallBlock[] {
  if (blocks.length === 0) return [];

  const additiveOverrides = blocks.filter(block => block.isAdditiveOverride);
  const sorted = blocks
    .filter(block => !block.isAdditiveOverride)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  if (sorted.length === 0) return additiveOverrides;

  // Create timeline events
  type TimelineEvent = {
    time: Date;
    type: 'start' | 'end';
    block: OnCallBlock;
    priority: number;
    layerPriority: number;
  };

  const events: TimelineEvent[] = [];
  for (const block of sorted) {
    // Overrides always take top priority over all scheduled layers
    const priority =
      block.source === 'override'
        ? Number.MAX_SAFE_INTEGER
        : (layerPriority.get(block.layerId) ?? 0);
    const baseLayerPriority = layerPriority.get(block.layerId) ?? 0;
    events.push({
      time: block.start,
      type: 'start',
      block,
      priority,
      layerPriority: baseLayerPriority,
    });
    events.push({
      time: block.end,
      type: 'end',
      block,
      priority,
      layerPriority: baseLayerPriority,
    });
  }

  // Sort events by time, then by type (ends before starts at same time)
  events.sort((a, b) => {
    const timeDiff = a.time.getTime() - b.time.getTime();
    if (timeDiff !== 0) return timeDiff;
    // Process 'end' before 'start' at same time
    if (a.type === 'end' && b.type === 'start') return -1;
    if (a.type === 'start' && b.type === 'end') return 1;
    return 0;
  });

  const result: OnCallBlock[] = [];
  const activeBlocks = new Map<
    string,
    { block: OnCallBlock; priority: number; layerPriority: number }
  >();
  let lastTime: Date | null = null;
  let lastWinner: OnCallBlock | null = null;

  for (const event of events) {
    // If time has changed and we have an active winner, emit a block
    if (lastTime && lastWinner && event.time.getTime() > lastTime.getTime()) {
      result.push({
        ...lastWinner,
        id: `final-${lastWinner.id}-${lastTime.getTime()}`,
        start: lastTime,
        end: event.time,
        layerName: 'Final Schedule',
      });
    }

    // Update active blocks
    if (event.type === 'start') {
      activeBlocks.set(event.block.id, {
        block: event.block,
        priority: event.priority,
        layerPriority: event.layerPriority,
      });
    } else {
      activeBlocks.delete(event.block.id);
    }

    // Find the winner (highest priority active block). Tie-breaker: lexical layerId for determinism.
    let winner: OnCallBlock | null = null;
    let maxPriority = -Infinity;
    let maxLayerPriority = -Infinity;
    for (const { block, priority, layerPriority: baseLayerPriority } of activeBlocks.values()) {
      if (
        priority > maxPriority ||
        (priority === maxPriority && baseLayerPriority > maxLayerPriority)
      ) {
        maxPriority = priority;
        maxLayerPriority = baseLayerPriority;
        winner = block;
        continue;
      }
      if (
        priority === maxPriority &&
        baseLayerPriority === maxLayerPriority &&
        winner &&
        block.layerId < winner.layerId
      ) {
        winner = block;
      } else if (priority === maxPriority && baseLayerPriority === maxLayerPriority && !winner) {
        winner = block;
      }
    }

    lastTime = event.time;
    lastWinner = winner;
  }

  // Merge consecutive blocks with the same user
  const merged: OnCallBlock[] = [];
  for (const block of result) {
    const last = merged[merged.length - 1];
    if (last && last.userId === block.userId && last.end.getTime() === block.start.getTime()) {
      last.end = block.end;
    } else {
      merged.push({ ...block });
    }
  }

  return [...merged, ...additiveOverrides].sort((a, b) => a.start.getTime() - b.start.getTime());
}
