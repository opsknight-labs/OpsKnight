import { describe, expect, it } from 'vitest';
import { computeErrorBudget } from '@/lib/business-services/slo';
import {
  buildDigest,
  claimKey,
  resolveRecipients,
  TOP_EXPANDED,
  type ReviewService,
} from '@/lib/business-services/reviews/digest';
import { applyBudgetRisk, evaluateFreeze } from '@/lib/business-services/reviews/freeze';
import {
  isRunDue,
  nextReviewRun,
  priorPeriod,
  reviewPeriod,
} from '@/lib/business-services/reviews/period';
import { estimateCostCents, revenueOf } from '@/lib/business-services/reviews/data';
import { normalizeConfig, reviewConfigSchema } from '@/lib/business-services/reviews/config';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';

const service = (i: number, over: Partial<ReviewService> = {}): ReviewService => ({
  id: `s${i}`,
  name: `Service ${String(i).padStart(3, '0')}`,
  criticality: null,
  sloTarget: 99.9,
  attainmentPercent: 99.95,
  budget: computeErrorBudget({ targetPercent: 99.9, windowDays: 30, downtimeMinutes: 0 }),
  priorRemainingPercent: null,
  downtimeMinutes: 0,
  incidentCount: 0,
  mttaMinutes: null,
  mttrMinutes: null,
  estimatedCostCents: null,
  currency: null,
  topCauses: [],
  ...over,
});
const withDowntime = (i: number, minutes: number) =>
  service(i, {
    downtimeMinutes: minutes,
    incidentCount: 1,
    budget: computeErrorBudget({ targetPercent: 99.9, windowDays: 30, downtimeMinutes: minutes }),
  });

describe('buildDigest', () => {
  it('skips services with nothing to report', () => {
    expect(buildDigest([service(1), service(2)])).toBeNull();
  });

  it('keeps a quiet service only when its budget is breached or at risk', () => {
    const atRisk = service(1, {
      budget: computeErrorBudget({ targetPercent: 99.9, windowDays: 30, downtimeMinutes: 40 }),
    });
    expect(atRisk.budget?.burnState).toBe('AT_RISK');
    expect(buildDigest([atRisk, service(2)])?.totals.services).toBe(1);
  });

  it('orders by attention, expands the top 5 and compacts the rest (100 services)', () => {
    const all = Array.from({ length: 100 }, (_, i) => withDowntime(i, i + 1));
    const digest = buildDigest(all)!;
    expect(digest.expanded).toHaveLength(TOP_EXPANDED);
    expect(digest.compact).toHaveLength(95);
    expect(digest.expanded[0]!.downtimeMinutes).toBe(100);
    expect(digest.totals.services).toBe(100);
    expect(digest.totals.breached).toBeGreaterThan(0);
  });

  it('puts BREACHED ahead of a noisier OK service', () => {
    const breached = withDowntime(1, 60);
    const noisy = service(2, { incidentCount: 3, downtimeMinutes: 2 });
    expect(breached.budget?.burnState).toBe('BREACHED');
    expect(buildDigest([noisy, breached])!.expanded[0]!.id).toBe('s1');
  });

  it('reports a trend and degrades without revenue fields', () => {
    const s = withDowntime(1, 60);
    const digest = buildDigest([{ ...s, priorRemainingPercent: 90 }])!;
    expect(digest.expanded[0]!.trend).toBe('worsening');
    expect(digest.totals.estimatedCostCents).toBeNull();
  });

  it('sums cost only for one currency', () => {
    const a = { ...withDowntime(1, 10), estimatedCostCents: 100, currency: 'USD' };
    const b = { ...withDowntime(2, 10), estimatedCostCents: 200, currency: 'USD' };
    const c = { ...withDowntime(3, 10), estimatedCostCents: 300, currency: 'EUR' };
    expect(buildDigest([a, b])!.totals.estimatedCostCents).toBe(300);
    expect(buildDigest([a, b, c])!.totals.estimatedCostCents).toBeNull();
  });
});

describe('resolveRecipients', () => {
  const eligible = new Set(['owner', 'a', 'b', 'c']);
  const services = [
    { id: 's1', includeInReview: true, ownerUserId: 'owner', ownerTeamId: 't1' },
    { id: 's2', includeInReview: true, ownerUserId: null, ownerTeamId: 't1' },
    { id: 's3', includeInReview: false, ownerUserId: 'owner', ownerTeamId: 't1' },
  ];

  it('sends an owner and opted-in team members one entry with all their services', () => {
    const result = resolveRecipients({
      services,
      optedInTeamMembers: new Map([['t1', ['a', 'owner']]]),
      eligibleUserIds: eligible,
    });
    expect(result.get('owner')).toEqual(['s1', 's2']);
    expect(result.get('a')).toEqual(['s1', 's2']);
    expect(result.has('b')).toBe(false);
  });

  it('never includes services that did not opt in, nor ineligible users', () => {
    const result = resolveRecipients({
      services,
      optedInTeamMembers: new Map([['t1', ['ghost']]]),
      eligibleUserIds: new Set(['owner']),
    });
    expect([...result.keys()]).toEqual(['owner']);
    expect(result.get('owner')).not.toContain('s3');
  });

  it('100 services across 10 teams yield one entry per person, not per service', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: `s${i}`,
      includeInReview: true,
      ownerUserId: null,
      ownerTeamId: `t${i % 10}`,
    }));
    const members = new Map(Array.from({ length: 10 }, (_, t) => [`t${t}`, [`u${t}`, 'shared']]));
    const result = resolveRecipients({
      services: many,
      optedInTeamMembers: members,
      eligibleUserIds: new Set([...Array.from({ length: 10 }, (_, t) => `u${t}`), 'shared']),
    });
    expect(result.size).toBe(11);
    expect(result.get('shared')).toHaveLength(100);
    expect(result.get('u3')).toHaveLength(10);
  });
});

describe('idempotency key', () => {
  it('is stable per period, kind and recipient and case-insensitive', () => {
    expect(claimKey('2026-11', 'DIGEST', 'User1')).toBe(claimKey('2026-11', 'DIGEST', 'user1'));
    expect(claimKey('2026-11', 'DIGEST', 'u')).not.toBe(claimKey('2026-12', 'DIGEST', 'u'));
    expect(claimKey('2026-11', 'DIGEST', 'u')).not.toBe(claimKey('2026-11', 'SUMMARY', 'u'));
  });
});

describe('evaluateFreeze', () => {
  it('warns only when the budget is exhausted', () => {
    const budget = (m: number) =>
      computeErrorBudget({ targetPercent: 99.9, windowDays: 30, downtimeMinutes: m });
    expect(evaluateFreeze(budget(0)).warn).toBe(false);
    expect(evaluateFreeze(budget(40))).toMatchObject({ warn: false, level: 'at_risk' });
    expect(evaluateFreeze(budget(60))).toMatchObject({ warn: true, level: 'exhausted' });
    expect(evaluateFreeze(null).warn).toBe(false);
  });

  it('bumps change risk by a capped amount, never above 1', () => {
    expect(applyBudgetRisk(0.5, false)).toBe(0.5);
    expect(applyBudgetRisk(0.5, true)).toBe(0.65);
    expect(applyBudgetRisk(0.95, true)).toBe(1);
  });
});

describe('period and schedule', () => {
  it('reviews the previous calendar month in the org time zone', () => {
    const p = reviewPeriod(new Date('2026-12-01T09:00:00Z'), 'UTC');
    expect(p).toMatchObject({ key: '2026-11', days: 30 });
    expect(p.from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(reviewPeriod(new Date('2027-01-02T00:00:00Z'), 'UTC').key).toBe('2026-12');
    expect(priorPeriod(p, 'UTC').key).toBe('2026-10');
  });

  it('honours the time zone at the month boundary', () => {
    // 2026-12-01 03:00 UTC is still Nov 30 evening in New York: reviews October.
    expect(reviewPeriod(new Date('2026-12-01T03:00:00Z'), 'America/New_York').key).toBe('2026-10');
  });

  it('is due from the scheduled hour for 72 hours only', () => {
    const schedule = { dayOfMonth: 1, hour: 9, timeZone: 'UTC' };
    expect(isRunDue(new Date('2026-12-01T08:59:00Z'), schedule)).toBe(false);
    expect(isRunDue(new Date('2026-12-01T09:00:00Z'), schedule)).toBe(true);
    expect(isRunDue(new Date('2026-12-03T20:00:00Z'), schedule)).toBe(true);
    expect(isRunDue(new Date('2026-12-04T10:00:00Z'), schedule)).toBe(false);
  });

  it('finds the next run this month or next, across the year end and in the zone', () => {
    const schedule = { dayOfMonth: 1, hour: 9, timeZone: 'UTC' };
    expect(nextReviewRun(new Date('2026-11-26T12:00:00Z'), schedule)?.toISOString()).toBe(
      '2026-12-01T09:00:00.000Z'
    );
    expect(nextReviewRun(new Date('2026-12-01T09:00:00Z'), schedule)?.toISOString()).toBe(
      '2027-01-01T09:00:00.000Z'
    );
    expect(
      nextReviewRun(new Date('2026-11-26T12:00:00Z'), {
        ...schedule,
        timeZone: 'Europe/Berlin',
      })?.toISOString()
    ).toBe('2026-12-01T08:00:00.000Z');
  });
});

describe('cost and config', () => {
  it('reads revenue fields defensively', () => {
    expect(revenueOf({})).toEqual({ perHourCents: null, currency: null });
    expect(revenueOf({ revenuePerHourCents: 6000, currency: 'EUR' })).toEqual({
      perHourCents: 6000,
      currency: 'EUR',
    });
    expect(estimateCostCents(30, 6000)).toBe(3000);
    expect(estimateCostCents(30, null)).toBeNull();
  });

  it('is off by default and rejects bad schedules', () => {
    expect(normalizeConfig(undefined)).toMatchObject({
      enabled: false,
      freezeWarningEnabled: false,
      dayOfMonth: 1,
      hour: 9,
    });
    expect(reviewConfigSchema.safeParse({ dayOfMonth: 31 }).success).toBe(false);
    expect(reviewConfigSchema.safeParse({ timeZone: 'Nope/Zone' }).success).toBe(false);
    expect(reviewConfigSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('RBAC', () => {
  const actor = (role: AuthorizationActor['role']): AuthorizationActor => ({
    id: role,
    role,
    status: 'ACTIVE',
    teamIds: ['t1'],
  });
  const decide = (
    role: AuthorizationActor['role'],
    action: (typeof AUTHORIZATION_ACTIONS)[keyof typeof AUTHORIZATION_ACTIONS]
  ) => authorize({ actor: actor(role), action });

  it('admins manage and read everything', () => {
    expect(decide('ADMIN', AUTHORIZATION_ACTIONS.SERVICE_REVIEW_MANAGE).allowed).toBe(true);
    expect(decide('ADMIN', AUTHORIZATION_ACTIONS.SERVICE_REVIEW_READ)).toMatchObject({
      allowed: true,
      scope: 'global',
    });
  });

  it('responders read their scope but never manage', () => {
    expect(decide('RESPONDER', AUTHORIZATION_ACTIONS.SERVICE_REVIEW_READ)).toMatchObject({
      allowed: true,
      scope: 'resource',
    });
    expect(decide('RESPONDER', AUTHORIZATION_ACTIONS.SERVICE_REVIEW_MANAGE).allowed).toBe(false);
  });

  it.each(['USER', 'AUDITOR', 'STAKEHOLDER'] as const)('%s has no access', role => {
    expect(decide(role, AUTHORIZATION_ACTIONS.SERVICE_REVIEW_READ).allowed).toBe(false);
    expect(decide(role, AUTHORIZATION_ACTIONS.SERVICE_REVIEW_MANAGE).allowed).toBe(false);
  });

  it('a disabled admin is denied', () => {
    expect(
      authorize({
        actor: { ...actor('ADMIN'), status: 'DISABLED' },
        action: AUTHORIZATION_ACTIONS.SERVICE_REVIEW_MANAGE,
      }).allowed
    ).toBe(false);
  });
});
