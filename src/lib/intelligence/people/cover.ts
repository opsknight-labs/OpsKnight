import 'server-only';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getWindowOnCallShifts } from '@/lib/oncall-shifts';
import { computeLoad } from '@/lib/oncall-load/metrics';
import { loadPageBuckets, loadWindow, LOAD_WINDOW_DAYS } from '@/lib/oncall-load/store';
import { readableOpsInsightScopes } from '../ops-insights/view';
import { peopleSuggestionsEnabled } from './enabled';
import { hasUncoveredTime, isDaytimeFor, rankCoverCandidates } from './cover-rank';

export interface CoverCandidate {
  userId: string;
  name: string;
  /** 08:00-22:00 on their own clock for the whole window. */
  daytime: boolean;
  /** Pages and night pages in the last 28 days; null when the viewer may not see this person's load. */
  pages: number | null;
  nightPages: number | null;
}

export interface CoverSuggestions {
  /** Some part of the window has nobody on call. */
  gap: boolean;
  windowDays: number;
  candidates: CoverCandidate[];
}

const MAX_POOL = 50;
const MAX_SHOWN = 5;
/** Longer windows are not a cover request; the suggestion stays bounded. */
const MAX_WINDOW_MS = 14 * 86_400_000;

/**
 * Ranked cover candidates for an override window, shown only when the window has uncovered time or the
 * override replaces someone. The pool is the schedule's layer members plus members of teams whose
 * services page this schedule, minus whoever is on call in the window and the person being replaced.
 * Ranked by daytime-for-them, then fewest pages and night pages over the last 28 days (the pages rollup).
 * Page counts are shown only for people whose load the viewer may see (self, team lead, admin).
 * Deterministic; three bounded reads plus the rotation; nothing on the paging path.
 */
export async function suggestCoverCandidates(
  actor: AuthorizationActor,
  input: { scheduleId: string; start: Date; end: Date; replacesUserId?: string | null },
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<CoverSuggestions | null> {
  const { scheduleId, start, end } = input;
  const span = end.getTime() - start.getTime();
  if (!(span > 0 && span <= MAX_WINDOW_MS)) return null;
  if (!(await peopleSuggestionsEnabled(client))) return null;
  if (!(await readableOpsInsightScopes(actor, 'SCHEDULE', [scheduleId], client)).has(scheduleId))
    return null;

  const shifts = await getWindowOnCallShifts(start, end, scheduleId, client);
  const gap = hasUncoveredTime(shifts, start, end);
  if (!gap && !input.replacesUserId) return { gap, windowDays: LOAD_WINDOW_DAYS, candidates: [] };

  const busy = new Set(shifts.map(shift => shift.userId));
  if (input.replacesUserId) busy.add(input.replacesUserId);
  const pool = await client.user.findMany({
    where: {
      status: 'ACTIVE',
      id: { notIn: [...busy] },
      OR: [
        { layerAssignments: { some: { layer: { scheduleId } } } },
        {
          teamMemberships: {
            some: {
              team: {
                services: {
                  some: { policy: { steps: { some: { targetScheduleId: scheduleId } } } },
                },
              },
            },
          },
        },
      ],
    },
    select: { id: true, name: true, timeZone: true },
    orderBy: { id: 'asc' },
    take: MAX_POOL,
  });
  if (pool.length === 0) return { gap, windowDays: LOAD_WINDOW_DAYS, candidates: [] };

  const window = loadWindow(now);
  const ids = pool.map(person => person.id);
  const [buckets, visible] = await Promise.all([
    loadPageBuckets(ids, window, client),
    readableOpsInsightScopes(actor, 'USER', ids, client),
  ]);
  const load = new Map(
    computeLoad({
      buckets,
      users: pool.map(person => ({ userId: person.id, timeZone: person.timeZone })),
      onCallSeconds: new Map(),
      from: window.from,
      to: window.to,
    }).people.map(person => [person.userId, person])
  );
  // People whose load the viewer may see are ranked by it; the rest follow, by daytime then name only, so
  // the order cannot reveal the load the USER rule hides.
  const candidates = pool.map(person => ({
    userId: person.id,
    name: person.name,
    daytime: isDaytimeFor(start, end, person.timeZone),
    pages: visible.has(person.id) ? (load.get(person.id)?.pages ?? 0) : 0,
    nightPages: visible.has(person.id) ? (load.get(person.id)?.nightPages ?? 0) : 0,
  }));
  const hidden = rankCoverCandidates(candidates.filter(c => !visible.has(c.userId))).map(c => ({
    ...c,
    pages: null,
    nightPages: null,
  }));
  return {
    gap,
    windowDays: LOAD_WINDOW_DAYS,
    candidates: [
      ...rankCoverCandidates(candidates.filter(c => visible.has(c.userId))),
      ...hidden,
    ].slice(0, MAX_SHOWN),
  };
}
