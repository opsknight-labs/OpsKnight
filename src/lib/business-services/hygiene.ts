/**
 * Ownership hygiene: which business services have stale reviews, an inactive owner, or an owner
 * team nobody can be paged through. The evaluation is pure; the sweep (see hygiene-sweep.ts)
 * reads the inputs and notifies.
 */
import { REVIEW_MAX_AGE_DAYS } from './scorecard';

export const HYGIENE_REASONS = ['REVIEW_OVERDUE', 'OWNER_INACTIVE', 'TEAM_NO_ONCALL'] as const;
export type HygieneReason = (typeof HYGIENE_REASONS)[number];
export const HYGIENE_DEDUPE_DAYS = 7;
const DAY_MS = 86_400_000;

export const HYGIENE_LABELS: Record<HygieneReason, string> = {
  REVIEW_OVERDUE: 'Review overdue',
  OWNER_INACTIVE: 'Owner inactive',
  TEAM_NO_ONCALL: 'No one on call',
};

export type HygieneInput = {
  createdAt: Date;
  lastReviewedAt: Date | null;
  /** Per-service cadence; null uses the org default. */
  reviewIntervalDays: number | null;
  ownerUserId: string | null;
  /** Status of the owner user; null when the owner no longer exists. */
  ownerUserStatus: string | null;
  ownerTeamId: string | null;
  /** The owner team has no members, or its escalation schedule has nobody on call. Null = not applicable. */
  teamUnreachable: boolean | null;
};

export function evaluateHygiene(input: HygieneInput, now = new Date()): HygieneReason[] {
  const reasons: HygieneReason[] = [];
  const interval = (input.reviewIntervalDays ?? REVIEW_MAX_AGE_DAYS) * DAY_MS;
  // A service never reviewed is measured from creation, so a new one is not overdue on day one.
  const reviewedAt = (input.lastReviewedAt ?? input.createdAt).getTime();
  if (now.getTime() - reviewedAt > interval) reasons.push('REVIEW_OVERDUE');
  if (input.ownerUserId && input.ownerUserStatus !== 'ACTIVE') reasons.push('OWNER_INACTIVE');
  if (input.ownerTeamId && input.teamUnreachable) reasons.push('TEAM_NO_ONCALL');
  return reasons;
}

/** Notification title: stable per reason, so a rolling 7-day dedupe can match on it. */
export const hygieneTitle = (reason: HygieneReason) =>
  `Business service hygiene: ${HYGIENE_LABELS[reason]}`;

export function hygieneMessage(
  name: string,
  reason: HygieneReason,
  reviewIntervalDays: number | null
) {
  switch (reason) {
    case 'REVIEW_OVERDUE':
      return `${name} has not been reviewed in ${reviewIntervalDays ?? REVIEW_MAX_AGE_DAYS} days. Open it and mark it reviewed.`;
    case 'OWNER_INACTIVE':
      return `The owner of ${name} is no longer an active user. Assign a new owner.`;
    case 'TEAM_NO_ONCALL':
      return `The owning team of ${name} has no one on call. Check its schedule and escalation policy.`;
  }
}

/** One notification per service and reason at most every HYGIENE_DEDUPE_DAYS days. */
export function isRecentlyNotified(
  existing: ReadonlyArray<{ entityId: string | null; title: string; createdAt: Date }>,
  businessServiceId: string,
  reason: HygieneReason,
  now: Date
): boolean {
  const since = now.getTime() - HYGIENE_DEDUPE_DAYS * DAY_MS;
  return existing.some(
    row =>
      row.entityId === businessServiceId &&
      row.title === hygieneTitle(reason) &&
      row.createdAt.getTime() > since
  );
}

/** Stable per day, so two concurrent sweeps never double-send. */
export const hygieneDedupeKey = (businessServiceId: string, reason: HygieneReason, now: Date) =>
  `bs-hygiene:${businessServiceId}:${reason}:${Math.floor(now.getTime() / DAY_MS)}`;

/** Badges for the catalog scorecard: the same rules, no I/O (team reachability is not shown). */
export function hygieneBadges(
  input: Pick<
    HygieneInput,
    'createdAt' | 'lastReviewedAt' | 'reviewIntervalDays' | 'ownerUserId' | 'ownerUserStatus'
  >,
  now = new Date()
): HygieneReason[] {
  return evaluateHygiene({ ...input, ownerTeamId: null, teamUnreachable: null }, now);
}
