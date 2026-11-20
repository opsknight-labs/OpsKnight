import { buildScheduleBlocks, getFinalScheduleBlocks, type LayerInput } from '@/lib/oncall';

export type ScheduleResponder = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  gender: string | null;
};

export type ScheduleOnCallSummary = {
  onCallNow: ScheduleResponder | null;
  next: (ScheduleResponder & { start: Date }) | null;
};

type SummaryOverride = Parameters<typeof buildScheduleBlocks>[1][number];

/**
 * Who is on call now and who takes over next, from the same block engine the
 * schedule detail page uses. Looks `windowDays` ahead for the next handoff.
 */
export function summarizeScheduleOnCall(
  schedule: { timeZone: string; layers: LayerInput[] },
  overrides: SummaryOverride[],
  now: Date,
  windowDays = 14
): ScheduleOnCallSummary {
  const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const blocks = getFinalScheduleBlocks(
    buildScheduleBlocks(schedule.layers, overrides, now, windowEnd, schedule.timeZone),
    new Map(schedule.layers.map(layer => [layer.id, layer.priority ?? 0]))
  ).sort((a, b) => a.start.getTime() - b.start.getTime());

  const t = now.getTime();
  const current = blocks.find(b => b.start.getTime() <= t && b.end.getTime() > t) ?? null;
  const upcoming = blocks.filter(b => b.start.getTime() > t);
  const nextBlock =
    upcoming.find(b => !current || b.userId !== current.userId) ?? upcoming[0] ?? null;

  const toResponder = (b: (typeof blocks)[number]): ScheduleResponder => ({
    userId: b.userId,
    name: b.userName,
    avatarUrl: b.userAvatar ?? null,
    gender: b.userGender ?? null,
  });

  return {
    onCallNow: current ? toResponder(current) : null,
    next: nextBlock ? { ...toResponder(nextBlock), start: nextBlock.start } : null,
  };
}
