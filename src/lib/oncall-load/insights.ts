/* eslint-disable security/detect-object-injection -- Keys are members of the fixed risk-label map. */
import type { OpsInsightItem } from '@/lib/intelligence/ops-insights/contract';
import type { ShiftRiskKind } from './signals';

/**
 * Pure on-call insight rules: a small summary in, operations-insight items out. The summaries hold ids and
 * numbers only, never a person's or a service's name, so a stored insight cannot show text its viewer could
 * not read. Names are resolved on read by the pages that render them.
 */

export const UNFAIR_ROTATION_RATIO = 1.5;
/** Below this many pages a ratio is noise, not unfairness. */
export const UNFAIR_ROTATION_MIN_PAGES = 8;
/** Below this many people, rotation-wide numbers would give away one other person's load. */
export const MIN_ROTATION_FOR_TOTALS = 3;
export const NIGHT_LOAD_MIN_NIGHTS = 6;
export const NIGHT_LOAD_MIN_WEEKS = 3;
export const COVERAGE_GAP_LOOKAHEAD_DAYS = 14;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const WINDOW = 'last 4 weeks';

/** What the SCHEDULE producer knows about one schedule. */
export interface ScheduleInsightInput {
  scheduleId: string;
  todayKey: string;
  tomorrowKey: string;
  /** Days in the next 14 (schedule time zone) with an uncovered stretch, from `findCoverageGapDays`. */
  gapDays: string[];
  /** Whole hours in the next 14 days in which one person is both primary and backup, per person. */
  samePersonHours: Array<{ userId: string; hours: number }>;
  /** Null when fewer than MIN_ROTATION_FOR_TOTALS people were on call. */
  rotation: {
    size: number;
    fairnessIndex: number | null;
    /** People above UNFAIR_ROTATION_RATIO with at least UNFAIR_ROTATION_MIN_PAGES pages. */
    above: number;
  } | null;
}

export function deriveScheduleInsights(input: ScheduleInsightInput): OpsInsightItem[] {
  const items: OpsInsightItem[] = [];
  const base = `/schedules/${input.scheduleId}`;

  if (input.gapDays.length > 0) {
    const first = input.gapDays[0];
    const soon = first === input.todayKey || first === input.tomorrowKey;
    items.push({
      key: 'gap',
      severity: soon ? 'CRITICAL' : 'WARNING',
      title: `Nobody is on call for part of ${plural(input.gapDays.length, 'day')} in the next ${COVERAGE_GAP_LOOKAHEAD_DAYS} days`,
      summary:
        'Pages routed to this schedule during a gap reach nobody. Add an override or extend a layer to cover it.',
      evidence: {
        window: `next ${COVERAGE_GAP_LOOKAHEAD_DAYS} days`,
        facts: [
          { label: 'Days with a gap', value: String(input.gapDays.length) },
          { label: 'First gap', value: first },
        ],
        examples: input.gapDays.slice(0, 5).map(day => ({ label: day })),
      },
      draftHref: `${base}?tab=overrides`,
    });
  }

  const overlap = input.samePersonHours.filter(entry => entry.hours >= 1);
  if (overlap.length > 0) {
    const hours = overlap.reduce((total, entry) => total + entry.hours, 0);
    items.push({
      key: 'same-person',
      severity: 'WARNING',
      title: `The same person is primary and backup for ${plural(hours, 'hour')} in the next ${COVERAGE_GAP_LOOKAHEAD_DAYS} days`,
      summary:
        'If that person misses a page there is nobody else behind them. Put a different responder on the backup for these hours.',
      evidence: {
        window: `next ${COVERAGE_GAP_LOOKAHEAD_DAYS} days`,
        facts: [
          { label: 'Hours with no separate backup', value: String(hours) },
          { label: 'People affected', value: String(overlap.length) },
        ],
      },
      draftHref: `${base}?tab=rotation`,
    });
  }

  const rotation = input.rotation;
  if (rotation && rotation.size >= MIN_ROTATION_FOR_TOTALS && rotation.above > 0) {
    items.push({
      key: 'unfair',
      severity:
        rotation.fairnessIndex !== null && rotation.fairnessIndex < 0.6 ? 'WARNING' : 'INFO',
      title: `Load is uneven: ${plural(rotation.above, 'responder')} above ${UNFAIR_ROTATION_RATIO}x the rotation's mean`,
      summary:
        'Pages per week of on-call time are well above the rest of the rotation for some people. Open Load & fairness to see who, then reorder the rotation or add a responder.',
      evidence: {
        window: WINDOW,
        facts: [
          { label: 'People on call', value: String(rotation.size) },
          { label: `Above ${UNFAIR_ROTATION_RATIO}x the mean`, value: String(rotation.above) },
          ...(rotation.fairnessIndex === null
            ? []
            : [{ label: 'Fairness index (1 = even)', value: String(rotation.fairnessIndex) }]),
        ],
      },
      draftHref: `${base}?tab=load`,
    });
  }
  return items;
}

/** What the USER producer knows about one person. Mean and fairness are null in rotations under 3. */
export interface PersonInsightInput {
  userId: string;
  rotations: Array<{
    scheduleId: string;
    pages: number;
    pagesPerOnCallWeek: number | null;
    vsRotationMean: number | null;
    meanPagesPerOnCallWeek: number | null;
  }>;
  night: { nightPages: number; nightsPaged: number; weeksWithNightPages: number };
  /** The person's next shift starting within the lookahead, when a service behind it carries a risk. */
  upcoming: {
    scheduleId: string;
    /** Shift start, to the hour (ISO). */
    startsAt: string;
    serviceIds: string[];
    counts: Record<ShiftRiskKind, number>;
  } | null;
}

const RISK_LABEL: Record<ShiftRiskKind, string> = {
  RISKY_CHANGE: 'Services with a high-risk change in the last 24 hours',
  SLO_BURNING: 'Services burning SLO budget',
  MAINTENANCE_ENDING: 'Services whose maintenance ends during the shift',
};

export function derivePersonInsights(input: PersonInsightInput): OpsInsightItem[] {
  const items: OpsInsightItem[] = [];

  for (const rotation of input.rotations) {
    const ratio = rotation.vsRotationMean;
    if (ratio === null || ratio <= UNFAIR_ROTATION_RATIO) continue;
    if (rotation.pages < UNFAIR_ROTATION_MIN_PAGES) continue;
    items.push({
      key: rotation.scheduleId,
      severity: ratio >= 2.5 ? 'CRITICAL' : 'WARNING',
      title: `On-call load is ${ratio}x the rotation's mean`,
      summary:
        'Pages per week of on-call time are well above the rest of this rotation. Consider reordering the rotation or adding a responder.',
      evidence: {
        window: WINDOW,
        facts: [
          { label: 'Pages', value: String(rotation.pages) },
          { label: 'Pages per on-call week', value: String(rotation.pagesPerOnCallWeek ?? '-') },
          ...(rotation.meanPagesPerOnCallWeek === null
            ? []
            : [{ label: 'Rotation mean', value: String(rotation.meanPagesPerOnCallWeek) }]),
        ],
        examples: [
          { label: 'Open the schedule', href: `/schedules/${rotation.scheduleId}?tab=load` },
        ],
      },
      draftHref: `/schedules/${rotation.scheduleId}?tab=rotation`,
    });
  }

  const night = input.night;
  if (
    night.nightsPaged >= NIGHT_LOAD_MIN_NIGHTS &&
    night.weeksWithNightPages >= NIGHT_LOAD_MIN_WEEKS
  ) {
    items.push({
      key: 'night',
      severity: night.nightsPaged >= NIGHT_LOAD_MIN_NIGHTS * 2 ? 'CRITICAL' : 'WARNING',
      title: `Paged at night on ${plural(night.nightsPaged, 'night')}`,
      summary:
        'Night pages keep recurring week after week. Check whether these alerts need to page at night or can wait for the morning.',
      evidence: {
        window: WINDOW,
        facts: [
          { label: 'Night pages (22:00-07:00 local)', value: String(night.nightPages) },
          { label: 'Nights with a page', value: String(night.nightsPaged) },
          { label: 'Weeks affected', value: String(night.weeksWithNightPages) },
        ],
      },
    });
  }

  const upcoming = input.upcoming;
  if (upcoming && upcoming.serviceIds.length > 0) {
    const kinds = (Object.keys(RISK_LABEL) as ShiftRiskKind[]).filter(
      kind => upcoming.counts[kind] > 0
    );
    const total = kinds.reduce((sum, kind) => sum + upcoming.counts[kind], 0);
    items.push({
      key: 'upcoming',
      severity: upcoming.counts.SLO_BURNING > 0 || total >= 3 ? 'WARNING' : 'INFO',
      title: `Next shift may be busy: ${plural(upcoming.serviceIds.length, 'service')} with a known risk`,
      summary:
        'Services behind the next shift have a high-risk change, a burning SLO or maintenance ending while on call. Look them over before the shift starts.',
      evidence: {
        window: `shift starting ${upcoming.startsAt.slice(0, 16).replace('T', ' ')} UTC`,
        facts: kinds.map(kind => ({
          label: RISK_LABEL[kind],
          value: String(upcoming.counts[kind]),
        })),
        examples: upcoming.serviceIds.slice(0, 5).map((serviceId, index) => ({
          label: `Service ${index + 1}`,
          href: `/services/${serviceId}`,
        })),
      },
      draftHref: `/schedules/${upcoming.scheduleId}`,
    });
  }
  return items;
}

type Shift = { userId: string; start: Date; end: Date };

/** Whole hours per person in which they are both on `primary` and on `secondary`, inside [from, to). */
export function samePersonOverlapHours(input: {
  primary: readonly Shift[];
  secondary: readonly Shift[];
  from: Date;
  to: Date;
}): Array<{ userId: string; hours: number }> {
  const from = input.from.getTime();
  const to = input.to.getTime();
  const overlapMs = new Map<string, number>();
  for (const first of input.primary) {
    for (const second of input.secondary) {
      if (first.userId !== second.userId) continue;
      const start = Math.max(first.start.getTime(), second.start.getTime(), from);
      const end = Math.min(first.end.getTime(), second.end.getTime(), to);
      if (end > start)
        overlapMs.set(first.userId, (overlapMs.get(first.userId) ?? 0) + end - start);
    }
  }
  return [...overlapMs.entries()]
    .map(([userId, ms]) => ({ userId, hours: Math.round(ms / 3_600_000) }))
    .filter(entry => entry.hours >= 1)
    .sort((a, b) => b.hours - a.hours || a.userId.localeCompare(b.userId));
}
