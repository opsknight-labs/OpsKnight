import type { RotationLoad } from './metrics';

/**
 * Pure on-call insight functions: plain data in, insight items out. Nothing here reads or writes a
 * store. The item shape is the operations-insight producer item (`key`, `severity`, `title`,
 * `summary`, `evidence`, optional `draftHref`) plus `kind`, so a producer can pass the items straight
 * to `upsertInsights(scope, kind, items)` grouped by `kind`.
 */
export type OnCallInsightSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export const ONCALL_INSIGHT_KINDS = {
  unfairRotation: 'oncall.unfair_rotation',
  sustainedNightLoad: 'oncall.sustained_night_load',
  coverageGap: 'oncall.coverage_gap',
  samePersonPrimarySecondary: 'oncall.same_person_primary_secondary',
  upcomingShiftHeavy: 'oncall.upcoming_shift_heavy',
} as const;

export type OnCallInsight = {
  key: string;
  kind: (typeof ONCALL_INSIGHT_KINDS)[keyof typeof ONCALL_INSIGHT_KINDS];
  severity: OnCallInsightSeverity;
  title: string;
  summary: string;
  evidence: {
    window?: string;
    facts: Array<{ label: string; value: string }>;
    examples?: Array<{ label: string; href?: string }>;
  };
  /** In-app path of the editor a person may open. Nothing is saved until they save it there. */
  draftHref?: string;
  /**
   * Set when the insight is about one person's load. Per-person load is private: show or store the
   * item only for that person, their team owners and administrators (scope USER, not SCHEDULE).
   */
  subjectUserId?: string;
};

type Names = ReadonlyMap<string, string>;
// Names are cut so a title always fits the insight store's 140-character limit.
const nameOf = (names: Names, userId: string) => (names.get(userId) ?? 'A responder').slice(0, 60);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const UNFAIR_ROTATION_RATIO = 1.5;
/** Below this many pages a ratio is noise, not unfairness. */
export const UNFAIR_ROTATION_MIN_PAGES = 8;

/** One person carried more than 1.5x the rotation's mean load per on-call week across the window. */
export function unfairRotationInsights(
  load: RotationLoad,
  names: Names,
  options: { windowLabel?: string; rotationHref?: string } = {}
): OnCallInsight[] {
  if (load.meanPagesPerOnCallWeek === null || load.fairnessIndex === null) return [];
  return load.people
    .filter(
      person =>
        person.vsRotationMean !== null &&
        person.vsRotationMean > UNFAIR_ROTATION_RATIO &&
        person.pages >= UNFAIR_ROTATION_MIN_PAGES
    )
    .map(person => ({
      key: person.userId,
      kind: ONCALL_INSIGHT_KINDS.unfairRotation,
      severity: (person.vsRotationMean ?? 0) >= 2.5 ? 'CRITICAL' : 'WARNING',
      title: `${nameOf(names, person.userId)} carries ${person.vsRotationMean}x the rotation's mean load`,
      summary:
        'Pages per week of on-call time are well above the rest of the rotation. Consider reordering the rotation or adding a responder.',
      evidence: {
        window: options.windowLabel ?? 'last 4 weeks',
        facts: [
          { label: 'Pages', value: String(person.pages) },
          { label: 'Pages per on-call week', value: String(person.pagesPerOnCallWeek) },
          { label: 'Rotation mean', value: String(load.meanPagesPerOnCallWeek) },
          { label: 'Fairness index', value: String(load.fairnessIndex) },
        ],
      },
      draftHref: options.rotationHref,
      subjectUserId: person.userId,
    }));
}

export const NIGHT_LOAD_MIN_NIGHTS = 6;
export const NIGHT_LOAD_MIN_WEEKS = 3;

/** Night pages (22:00-07:00 local) on at least 6 nights, spread over at least 3 of the window's weeks. */
export function sustainedNightLoadInsights(
  load: RotationLoad,
  names: Names,
  options: { windowLabel?: string } = {}
): OnCallInsight[] {
  return load.people
    .filter(
      person =>
        person.nightsPaged >= NIGHT_LOAD_MIN_NIGHTS &&
        person.weeksWithNightPages >= NIGHT_LOAD_MIN_WEEKS
    )
    .map(person => ({
      key: person.userId,
      kind: ONCALL_INSIGHT_KINDS.sustainedNightLoad,
      severity: person.nightsPaged >= NIGHT_LOAD_MIN_NIGHTS * 2 ? 'CRITICAL' : 'WARNING',
      title: `${nameOf(names, person.userId)} was paged at night on ${plural(person.nightsPaged, 'night')}`,
      summary:
        'Night pages keep recurring week after week. Check whether these alerts need to page at night or can wait for the morning.',
      evidence: {
        window: options.windowLabel ?? 'last 4 weeks',
        facts: [
          { label: 'Night pages (22:00-07:00 local)', value: String(person.nightPages) },
          { label: 'Nights with a page', value: String(person.nightsPaged) },
          { label: 'Weeks affected', value: String(person.weeksWithNightPages) },
        ],
      },
      subjectUserId: person.userId,
    }));
}

/** `gapDays` comes from `findCoverageGapDays` (sorted date keys in the schedule's time zone). */
export function coverageGapInsights(input: {
  gapDays: readonly string[];
  todayKey: string;
  tomorrowKey: string;
  windowDays?: number;
  overridesHref?: string;
}): OnCallInsight[] {
  if (input.gapDays.length === 0) return [];
  const first = input.gapDays[0];
  const soon = first === input.todayKey || first === input.tomorrowKey;
  const windowDays = input.windowDays ?? 14;
  return [
    {
      key: `next-${windowDays}d`,
      kind: ONCALL_INSIGHT_KINDS.coverageGap,
      severity: soon ? 'CRITICAL' : 'WARNING',
      title: `Nobody is on call for part of ${plural(input.gapDays.length, 'day')} in the next ${windowDays} days`,
      summary:
        'Pages routed to this schedule during a gap reach nobody. Add an override or extend a layer to cover it.',
      evidence: {
        window: `next ${windowDays} days`,
        facts: [
          { label: 'Days with a gap', value: String(input.gapDays.length) },
          { label: 'First gap', value: first },
        ],
        examples: input.gapDays.slice(0, 5).map(day => ({ label: day })),
      },
      draftHref: input.overridesHref,
    },
  ];
}

type Shift = { userId: string; start: Date; end: Date };

/**
 * The same person is both the primary and the fallback at the same time, so the fallback adds no
 * cover. Works for any two shift lists: two layers of one schedule, or steps 1 and 2 of a policy.
 */
export function samePersonPrimarySecondaryInsights(input: {
  primary: readonly Shift[];
  secondary: readonly Shift[];
  from: Date;
  to: Date;
  names: Names;
  windowLabel?: string;
  rotationHref?: string;
}): OnCallInsight[] {
  const from = input.from.getTime();
  const to = input.to.getTime();
  const overlapMs = new Map<string, number>();
  for (const first of input.primary) {
    for (const second of input.secondary) {
      if (first.userId !== second.userId) continue;
      const start = Math.max(first.start.getTime(), second.start.getTime(), from);
      const end = Math.min(first.end.getTime(), second.end.getTime(), to);
      if (end > start) overlapMs.set(first.userId, (overlapMs.get(first.userId) ?? 0) + end - start);
    }
  }
  return [...overlapMs.entries()]
    .map(([userId, ms]) => ({ userId, hours: Math.round(ms / 3_600_000) }))
    .filter(entry => entry.hours >= 1)
    .sort((a, b) => b.hours - a.hours || a.userId.localeCompare(b.userId))
    .map(({ userId, hours }) => ({
      key: userId,
      kind: ONCALL_INSIGHT_KINDS.samePersonPrimarySecondary,
      severity: 'WARNING' as const,
      title: `${nameOf(input.names, userId)} is primary and backup at the same time for ${plural(hours, 'hour')}`,
      summary:
        'If this person misses a page there is nobody else behind them. Put a different responder on the backup layer for these hours.',
      evidence: {
        window: input.windowLabel ?? 'next 14 days',
        facts: [{ label: 'Hours with no separate backup', value: String(hours) }],
      },
      draftHref: input.rotationHref,
    }));
}

export type ShiftRiskSignal = {
  kind: 'RISKY_CHANGE' | 'SLO_BURNING' | 'MAINTENANCE_ENDING';
  serviceId: string;
  serviceName: string;
};

const SIGNAL_LABEL: Record<ShiftRiskSignal['kind'], string> = {
  RISKY_CHANGE: 'Risky change still open',
  SLO_BURNING: 'SLO budget burning',
  MAINTENANCE_ENDING: 'Maintenance ends during the shift',
};

/** A heads-up for the incoming person: services behind the shift carry a known risk right now. */
export function upcomingShiftHeavyInsights(input: {
  shift: Shift;
  signals: readonly ShiftRiskSignal[];
}): OnCallInsight[] {
  if (input.signals.length === 0) return [];
  const services = new Set(input.signals.map(signal => signal.serviceId));
  const burning = input.signals.some(signal => signal.kind === 'SLO_BURNING');
  return [
    {
      key: `${input.shift.userId}:${input.shift.start.toISOString()}`,
      kind: ONCALL_INSIGHT_KINDS.upcomingShiftHeavy,
      severity: burning || input.signals.length >= 3 ? 'WARNING' : 'INFO',
      title: `Your next shift may be busy: ${plural(services.size, 'service')} with a known risk`,
      summary:
        'These services have an open risky change, a burning SLO or maintenance ending while you are on call.',
      evidence: {
        window: 'your next shift',
        facts: input.signals.slice(0, 12).map(signal => ({
          label: signal.serviceName,
          value: SIGNAL_LABEL[signal.kind],
        })),
        examples: [...services].slice(0, 5).map(serviceId => ({
          label: input.signals.find(signal => signal.serviceId === serviceId)?.serviceName ?? serviceId,
          href: `/services/${serviceId}`,
        })),
      },
      subjectUserId: input.shift.userId,
    },
  ];
}
