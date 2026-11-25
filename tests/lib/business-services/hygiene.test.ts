import { describe, expect, it } from 'vitest';
import {
  HYGIENE_DEDUPE_DAYS,
  evaluateHygiene,
  hygieneBadges,
  hygieneDedupeKey,
  hygieneMessage,
  hygieneTitle,
  isRecentlyNotified,
  type HygieneInput,
} from '@/lib/business-services/hygiene';

const NOW = new Date('2026-11-25T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const base: HygieneInput = {
  createdAt: daysAgo(400),
  lastReviewedAt: daysAgo(10),
  reviewIntervalDays: null,
  ownerUserId: 'u1',
  ownerUserStatus: 'ACTIVE',
  ownerTeamId: 't1',
  teamUnreachable: false,
};

describe('evaluateHygiene', () => {
  it('is clean for a reviewed service with an active owner and a reachable team', () => {
    expect(evaluateHygiene(base, NOW)).toEqual([]);
  });

  it('flags a review older than the default 180 days, or the per-service interval', () => {
    expect(evaluateHygiene({ ...base, lastReviewedAt: daysAgo(181) }, NOW)).toEqual([
      'REVIEW_OVERDUE',
    ]);
    expect(evaluateHygiene({ ...base, lastReviewedAt: daysAgo(179) }, NOW)).toEqual([]);
    expect(
      evaluateHygiene({ ...base, lastReviewedAt: daysAgo(40), reviewIntervalDays: 30 }, NOW)
    ).toEqual(['REVIEW_OVERDUE']);
    expect(
      evaluateHygiene({ ...base, lastReviewedAt: daysAgo(200), reviewIntervalDays: 365 }, NOW)
    ).toEqual([]);
  });

  it('measures a never-reviewed service from creation, so a new one is not overdue', () => {
    expect(evaluateHygiene({ ...base, lastReviewedAt: null, createdAt: daysAgo(5) }, NOW)).toEqual(
      []
    );
    expect(
      evaluateHygiene({ ...base, lastReviewedAt: null, createdAt: daysAgo(400) }, NOW)
    ).toEqual(['REVIEW_OVERDUE']);
  });

  it('flags an owner who is disabled, invited or gone, but not a service with no owner user', () => {
    for (const ownerUserStatus of ['DISABLED', 'INVITED', null])
      expect(evaluateHygiene({ ...base, ownerUserStatus }, NOW)).toEqual(['OWNER_INACTIVE']);
    expect(evaluateHygiene({ ...base, ownerUserId: null, ownerUserStatus: null }, NOW)).toEqual([]);
  });

  it('flags an owner team nobody can be reached through', () => {
    expect(evaluateHygiene({ ...base, teamUnreachable: true }, NOW)).toEqual(['TEAM_NO_ONCALL']);
    expect(evaluateHygiene({ ...base, ownerTeamId: null, teamUnreachable: true }, NOW)).toEqual([]);
  });

  it('reports every finding', () => {
    expect(
      evaluateHygiene(
        {
          ...base,
          lastReviewedAt: daysAgo(999),
          ownerUserStatus: 'DISABLED',
          teamUnreachable: true,
        },
        NOW
      )
    ).toEqual(['REVIEW_OVERDUE', 'OWNER_INACTIVE', 'TEAM_NO_ONCALL']);
  });
});

describe('hygieneBadges', () => {
  it('never claims team reachability, which needs I/O', () => {
    expect(hygieneBadges({ ...base, lastReviewedAt: daysAgo(999) }, NOW)).toEqual([
      'REVIEW_OVERDUE',
    ]);
  });
});

describe('notification dedupe', () => {
  const sent = (reason: Parameters<typeof hygieneTitle>[0], days: number, entityId = 'bs1') => ({
    entityId,
    title: hygieneTitle(reason),
    createdAt: daysAgo(days),
  });
  it('suppresses the same service and reason inside 7 days only', () => {
    expect(HYGIENE_DEDUPE_DAYS).toBe(7);
    expect(isRecentlyNotified([sent('REVIEW_OVERDUE', 6)], 'bs1', 'REVIEW_OVERDUE', NOW)).toBe(
      true
    );
    expect(isRecentlyNotified([sent('REVIEW_OVERDUE', 8)], 'bs1', 'REVIEW_OVERDUE', NOW)).toBe(
      false
    );
  });
  it('does not mix services or reasons', () => {
    expect(isRecentlyNotified([sent('REVIEW_OVERDUE', 1)], 'bs1', 'OWNER_INACTIVE', NOW)).toBe(
      false
    );
    expect(
      isRecentlyNotified([sent('REVIEW_OVERDUE', 1, 'bs2')], 'bs1', 'REVIEW_OVERDUE', NOW)
    ).toBe(false);
  });
  it('keys concurrent sweeps on the same day identically and the next day differently', () => {
    const next = new Date(NOW.getTime() + 86_400_000);
    expect(hygieneDedupeKey('bs1', 'REVIEW_OVERDUE', NOW)).toBe(
      hygieneDedupeKey('bs1', 'REVIEW_OVERDUE', new Date(NOW.getTime() + 60_000))
    );
    expect(hygieneDedupeKey('bs1', 'REVIEW_OVERDUE', NOW)).not.toBe(
      hygieneDedupeKey('bs1', 'REVIEW_OVERDUE', next)
    );
  });
  it('words each reason', () => {
    expect(hygieneMessage('Checkout', 'REVIEW_OVERDUE', 90)).toContain('90 days');
    expect(hygieneMessage('Checkout', 'REVIEW_OVERDUE', null)).toContain('180 days');
    expect(hygieneMessage('Checkout', 'OWNER_INACTIVE', null)).toContain(
      'no longer an active user'
    );
    expect(hygieneMessage('Checkout', 'TEAM_NO_ONCALL', null)).toContain('no one on call');
  });
});
