import { getTimeZoneOffsetMs } from './timezone';

type LayerUser = {
  userId: string;
  user: { name: string; avatarUrl?: string | null; gender?: string | null };
  position: number;
};

type LayerRestrictions = {
  daysOfWeek?: number[]; // 0=Sun, 1=Mon, ..., 6=Sat
  startHour?: number; // 0-23
  endHour?: number; // 0-23
};

type LayerInput = {
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

type OverrideInput = {
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
};

function getDayHourInTimeZone(date: Date, timeZone: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);

  const weekday = parts.find(p => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return { day: dayMap[weekday] ?? 0, hour };
}
function addCalendarDaysInTimeZone(base: Date, days: number, timeZone: string): Date {
  // Get the date parts in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(base);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');

  // Reconstruct the date with calendar day offset, keeping the same wall-clock time
  const baseUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day') + days,
    get('hour') % 24,
    get('minute'),
    get('second')
  );

  // Convert back from target timezone to UTC with two-step DST boundary refinement
  const guessOffsetMs = getTimeZoneOffsetMs(new Date(baseUtc), timeZone);
  let date = new Date(baseUtc - guessOffsetMs);
  const actualOffsetMs = getTimeZoneOffsetMs(date, timeZone);
  if (actualOffsetMs !== guessOffsetMs) {
    date = new Date(baseUtc - actualOffsetMs);
  }
  return date;
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
    } else {
      if (segStart) {
        result.push({ start: segStart, end: new Date(cursor) });
        segStart = null;
      }
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
  if (layer.users.length === 0) {
    return [];
  }

  const rotationMs = layer.rotationLengthHours * 60 * 60 * 1000;
  const shiftMs = (layer.shiftLengthHours || layer.rotationLengthHours) * 60 * 60 * 1000;

  if (rotationMs <= 0 || shiftMs <= 0) {
    return [];
  }

  const layerStart = layer.start;
  const layerEnd = layer.end ?? null;
  const effectiveWindowStart = windowStart < layerStart ? layerStart : windowStart;

  if (layerEnd && effectiveWindowStart >= layerEnd) {
    return [];
  }

  // Calculate initial index (start at least 1 index earlier to account for DST fallback offsets)
  const startOffsetMs = Math.max(0, effectiveWindowStart.getTime() - layerStart.getTime());
  let index = Math.max(0, Math.floor(startOffsetMs / rotationMs) - 1);

  // If we land inside a gap, we might need to check if we missed the duty period for this index
  // But simpler to just start checking from this index.

  const blocks: OnCallBlock[] = [];
  let guard = 0;
  // Support up to 1 year of 1-hour rotations (~8760 blocks). 10000 is safe.
  const maxBlocks = 10000;

  while (guard < maxBlocks) {
    let blockStart: Date;
    if (layer.rotationLengthHours % 24 === 0) {
      // Calendar-day math to avoid DST drift for daily/weekly/multi-day rotations
      blockStart = addCalendarDaysInTimeZone(
        layerStart,
        index * (layer.rotationLengthHours / 24),
        timeZone
      );
    } else if (layer.rotationLengthHours < 24 && 24 % layer.rotationLengthHours === 0) {
      // Calendar-anchored math for sub-daily integer factors of 24 (12h, 8h, 6h, 4h, 2h, 1h)
      const totalHours = index * layer.rotationLengthHours;
      const dayOffset = Math.floor(totalHours / 24);
      const hourOffset = totalHours % 24;
      const dayBase = addCalendarDaysInTimeZone(layerStart, dayOffset, timeZone);
      blockStart = new Date(dayBase.getTime() + hourOffset * 3600000);
    } else {
      const rotationStartTime = layerStart.getTime() + index * rotationMs;
      blockStart = new Date(rotationStartTime);
    }

    if (blockStart >= windowEnd) {
      break;
    }

    if (layerEnd && blockStart >= layerEnd) {
      break;
    }

    let rawEnd: Date;
    const shiftHours = layer.shiftLengthHours || layer.rotationLengthHours;
    if (shiftHours % 24 === 0) {
      rawEnd = addCalendarDaysInTimeZone(blockStart, shiftHours / 24, timeZone);
    } else {
      rawEnd = new Date(blockStart.getTime() + shiftMs);
    }
    const blockEnd = layerEnd && rawEnd > layerEnd ? layerEnd : rawEnd;

    // Check visibility
    // If the entire duty block is before window start, skip
    if (blockEnd <= effectiveWindowStart) {
      index++;
      guard++;
      continue;
    }

    // Determine User
    const user = layer.users[index % layer.users.length];

    // Clamping to visual window
    const clampedStart = blockStart < windowStart ? windowStart : blockStart;
    const clampedEnd = blockEnd > windowEnd ? windowEnd : blockEnd;

    if (clampedStart < clampedEnd) {
      if (layer.restrictions) {
        // Split into hourly sub-blocks and filter by restriction
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

    index++;
    guard++;
  }

  return blocks;
}

function applyOverrides(blocks: OnCallBlock[], overrides: OverrideInput[]): OnCallBlock[] {
  const sortedOverrides = [...overrides].sort((a, b) => a.start.getTime() - b.start.getTime());
  let result = [...blocks];

  for (const override of sortedOverrides) {
    const next: OnCallBlock[] = [];
    const coveredIntervals: Array<{ start: Date; end: Date }> = [];

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
        next.push({ ...block, end: overrideStart });
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
      coveredIntervals.push({ start: overrideStart, end: overrideEnd });

      if (overrideEnd < block.end) {
        next.push({ ...block, start: overrideEnd });
      }
    }

    // If override has intervals not covered by existing blocks, emit standalone override segments for gaps
    if (!override.replacesUserId) {
      coveredIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());
      let cursor = override.start;
      for (const cov of coveredIntervals) {
        if (cursor < cov.start) {
          next.push({
            id: `override-${override.id}-${cursor.getTime()}`,
            start: cursor,
            end: cov.start,
            userId: override.userId,
            userName: override.user.name,
            userAvatar: override.user.avatarUrl,
            userGender: override.user.gender,
            layerId: 'override',
            layerName: 'Override',
            source: 'override',
          });
        }
        if (cursor < cov.end) {
          cursor = cov.end;
        }
      }
      if (cursor < override.end) {
        next.push({
          id: `override-${override.id}-${cursor.getTime()}`,
          start: cursor,
          end: override.end,
          userId: override.userId,
          userName: override.user.name,
          userAvatar: override.user.avatarUrl,
          userGender: override.user.gender,
          layerId: 'override',
          layerName: 'Override',
          source: 'override',
        });
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
  return applyOverrides(blocks, overrides);
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

  // Sort blocks by start time
  const sorted = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());

  // Create timeline events
  type TimelineEvent = {
    time: Date;
    type: 'start' | 'end';
    block: OnCallBlock;
    priority: number;
  };

  const events: TimelineEvent[] = [];
  for (const block of sorted) {
    // Overrides always take top priority over all scheduled layers
    const priority =
      block.source === 'override'
        ? Number.MAX_SAFE_INTEGER
        : (layerPriority.get(block.layerId) ?? 0);
    events.push({ time: block.start, type: 'start', block, priority });
    events.push({ time: block.end, type: 'end', block, priority });
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
  const activeBlocks = new Map<string, { block: OnCallBlock; priority: number }>();
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
      activeBlocks.set(event.block.id, { block: event.block, priority: event.priority });
    } else {
      activeBlocks.delete(event.block.id);
    }

    // Find the winner (highest priority active block). Tie-breaker: lexical layerId for determinism.
    let winner: OnCallBlock | null = null;
    let maxPriority = -Infinity;
    for (const { block, priority } of activeBlocks.values()) {
      if (priority > maxPriority) {
        maxPriority = priority;
        winner = block;
        continue;
      }
      if (priority === maxPriority && winner && block.layerId < winner.layerId) {
        winner = block;
      } else if (priority === maxPriority && !winner) {
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

  return merged;
}
