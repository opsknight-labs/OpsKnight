import prisma from '@/lib/prisma';
import {
  buildScheduleBlocks,
  getFinalScheduleBlocks,
  type LayerInput,
  type OnCallBlock,
  type OverrideInput,
} from '@/lib/oncall';
import { isValidTimeZone } from '@/lib/timezone';

/**
 * Rotation slots are picked by position modulo the member count, so removing or deactivating one
 * member shifts later slots to other people. This previews that, using the same evaluation the
 * schedule page uses (`buildScheduleBlocks` + `getFinalScheduleBlocks`), before the change is made.
 */
export const ROTATION_PREVIEW_DAYS = 28;
const MAX_SHIFTS_LISTED = 8;
const MAX_SCHEDULES_LISTED = 5;

export type RotationImpact = { changed: boolean; message: string };

type Person = { id: string; name: string };
type ShiftChange = { start: Date; end: Date; before: Person[]; after: Person[] };
export type PreviewSchedule = {
  id: string;
  name: string;
  timeZone: string;
  layers: LayerInput[];
  overrides: OverrideInput[];
};
/** `layerId` set: drop the users from that layer only. Unset: they are deactivated, so they leave every layer and their overrides stop. */
type Removal = { userIds: string[]; layerId?: string };

const peopleKey = (people: Person[]) => people.map(person => person.id).join(',');

function whoIsOnCall(blocks: OnCallBlock[], at: number): Person[] {
  return blocks
    .filter(block => block.start.getTime() <= at && at < block.end.getTime())
    .map(block => ({ id: block.userId, name: block.userName }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Splits the window at every shift boundary of either schedule and keeps the stretches whose assignee differs. */
export function changedShifts(
  before: OnCallBlock[],
  after: OnCallBlock[],
  from: Date,
  to: Date
): ShiftChange[] {
  const cuts = new Set<number>([from.getTime(), to.getTime()]);
  for (const block of [...before, ...after]) {
    for (const time of [block.start.getTime(), block.end.getTime()]) {
      if (time > from.getTime() && time < to.getTime()) cuts.add(time);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  const changes: ShiftChange[] = [];
  points.slice(0, -1).forEach((start, i) => {
    const end = points.at(i + 1) ?? start;
    const was = whoIsOnCall(before, start);
    const now = whoIsOnCall(after, start);
    if (peopleKey(was) === peopleKey(now)) return;
    const last = changes.at(-1);
    if (
      last &&
      last.end.getTime() === start &&
      peopleKey(last.before) === peopleKey(was) &&
      peopleKey(last.after) === peopleKey(now)
    ) {
      last.end = new Date(end);
    } else {
      changes.push({ start: new Date(start), end: new Date(end), before: was, after: now });
    }
  });
  return changes;
}

export function previewScheduleChange(
  schedule: PreviewSchedule,
  removal: Removal,
  now: Date
): ShiftChange[] {
  const windowEnd = new Date(now.getTime() + ROTATION_PREVIEW_DAYS * 24 * 60 * 60 * 1000);
  const zone = isValidTimeZone(schedule.timeZone) ? schedule.timeZone : 'UTC';
  const priorities = new Map(schedule.layers.map(layer => [layer.id, layer.priority ?? 0]));
  const evaluate = (layers: LayerInput[], overrides: OverrideInput[]) =>
    getFinalScheduleBlocks(buildScheduleBlocks(layers, overrides, now, windowEnd, zone), priorities);
  const removed = new Set(removal.userIds);
  const after = evaluate(
    schedule.layers.map(layer =>
      removal.layerId && layer.id !== removal.layerId
        ? layer
        : { ...layer, users: layer.users.filter(member => !removed.has(member.userId)) }
    ),
    removal.layerId
      ? schedule.overrides
      : schedule.overrides.filter(override => !removed.has(override.userId))
  );
  return changedShifts(evaluate(schedule.layers, schedule.overrides), after, now, windowEnd);
}

const names = (people: Person[]) =>
  people.length > 0 ? people.map(person => person.name).join(' and ') : 'nobody';

function describeSchedule(schedule: PreviewSchedule, changes: ShiftChange[], now: Date): string[] {
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimeZone(schedule.timeZone) ? schedule.timeZone : 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const lines = [
    `${schedule.name} (${schedule.timeZone}): ${changes.length} shift${changes.length === 1 ? '' : 's'} change`,
  ];
  if (changes[0].start.getTime() === now.getTime()) {
    lines.push(
      `Whoever is on call right now changes from ${names(changes[0].before)} to ${names(changes[0].after)}.`
    );
  }
  for (const change of changes.slice(0, MAX_SHIFTS_LISTED)) {
    lines.push(
      `${clock.format(change.start)} to ${clock.format(change.end)}: ${names(change.before)} becomes ${names(change.after)}`
    );
  }
  if (changes.length > MAX_SHIFTS_LISTED) {
    lines.push(`and ${changes.length - MAX_SHIFTS_LISTED} more`);
  }
  return lines;
}

/** Plain-text summary for a confirmation dialog; `changed` is false when no shift in the window changes owner. */
export function summarizeRotationChange(
  results: Array<{ schedule: PreviewSchedule; changes: ShiftChange[] }>,
  now: Date
): RotationImpact {
  const changed = results.filter(result => result.changes.length > 0);
  if (changed.length === 0) return { changed: false, message: '' };
  const blocks = changed.slice(0, MAX_SCHEDULES_LISTED).map(result =>
    describeSchedule(result.schedule, result.changes, now).join('\n')
  );
  if (changed.length > MAX_SCHEDULES_LISTED) {
    blocks.push(`and ${changed.length - MAX_SCHEDULES_LISTED} more schedules`);
  }
  return {
    changed: true,
    message: `Rotation slots follow member order, so this moves later slots to other people. These shifts in the next ${ROTATION_PREVIEW_DAYS / 7} weeks change owner:\n\n${blocks.join('\n\n')}`,
  };
}

async function loadSchedules(scheduleIds: string[], now: Date): Promise<PreviewSchedule[]> {
  const windowEnd = new Date(now.getTime() + ROTATION_PREVIEW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.onCallSchedule.findMany({
    where: { id: { in: scheduleIds } },
    select: {
      id: true,
      name: true,
      timeZone: true,
      layers: {
        select: {
          id: true,
          name: true,
          start: true,
          end: true,
          rotationLengthHours: true,
          shiftLengthHours: true,
          restrictions: true,
          priority: true,
          users: {
            where: { user: { status: 'ACTIVE' } },
            select: { userId: true, position: true, user: { select: { name: true } } },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      },
      overrides: {
        where: { start: { lt: windowEnd }, end: { gt: now }, user: { status: 'ACTIVE' } },
        select: {
          id: true,
          start: true,
          end: true,
          userId: true,
          replacesUserId: true,
          user: { select: { name: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
  return rows.map(row => ({
    ...row,
    layers: row.layers.map(layer => ({
      ...layer,
      restrictions: layer.restrictions as LayerInput['restrictions'],
    })),
  }));
}

/** Previews dropping `userIds` from one layer (`layerId`) or deactivating them (no `layerId`). Read-only. */
export async function previewRotationChange(
  removal: Removal,
  now: Date = new Date()
): Promise<RotationImpact> {
  const scheduleIds = removal.layerId
    ? (
        await prisma.onCallLayer.findMany({
          where: { id: removal.layerId },
          select: { scheduleId: true },
        })
      ).map(layer => layer.scheduleId)
    : [
        ...new Set(
          (
            await prisma.onCallLayerUser.findMany({
              where: { userId: { in: removal.userIds }, user: { status: 'ACTIVE' } },
              select: { layer: { select: { scheduleId: true } } },
            })
          ).map(member => member.layer.scheduleId)
        ),
      ];
  if (scheduleIds.length === 0) return { changed: false, message: '' };
  const schedules = await loadSchedules(scheduleIds, now);
  return summarizeRotationChange(
    schedules.map(schedule => ({ schedule, changes: previewScheduleChange(schedule, removal, now) })),
    now
  );
}
