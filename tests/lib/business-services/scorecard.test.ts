import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
import {
  DEFAULT_SCORECARD_RUBRIC,
  matchesNeed,
  rubricNeeds,
  scoreBusinessService,
  scorecardRubricSchema,
} from '@/lib/business-services/scorecard';
import { normalizeRubric, saveScorecardRubric } from '@/lib/business-services/scorecard-config';

const NOW = new Date('2026-11-24T00:00:00Z');
const full = {
  ownerTeamId: 't',
  criticality: 'TIER_1',
  memberCount: 2,
  sloTarget: 99.9,
  linkCount: 1,
  description: 'Checkout',
  lastReviewedAt: new Date('2026-10-01T00:00:00Z'),
};

describe('scoreBusinessService', () => {
  it('scores a complete service 100 and not needing attention', () => {
    const card = scoreBusinessService(full, NOW);
    expect(card.score).toBe(100);
    expect(card.needsAttention).toBe(false);
  });
  it('flags a stale review and an empty service', () => {
    const card = scoreBusinessService(
      { ...full, memberCount: 0, ownerTeamId: null, lastReviewedAt: new Date('2026-01-01') },
      NOW
    );
    expect(card.checks.filter(c => !c.passed).map(c => c.id)).toEqual([
      'owner',
      'members',
      'reviewed',
    ]);
    expect(card.needsAttention).toBe(true);
    expect(matchesNeed(card, 'no-owner')).toBe(true);
    expect(matchesNeed(card, 'no-tier')).toBe(false);
    expect(matchesNeed(card, 'no-members')).toBe(true);
  });
  it('an individual owner satisfies the owner check', () => {
    const card = scoreBusinessService({ ...full, ownerTeamId: null, ownerUserId: 'u' }, NOW);
    expect(matchesNeed(card, 'no-owner')).toBe(false);
  });
});

describe('configurable scorecard rubric', () => {
  const rubric = (
    rules: unknown[],
    levels = [
      { id: 'bronze', label: 'Bronze' },
      { id: 'gold', label: 'Gold' },
    ]
  ) => scorecardRubricSchema.parse({ levels, rules });

  it('keeps the default rubric equal to the seven original checks', () => {
    expect(DEFAULT_SCORECARD_RUBRIC.rules.map(rule => rule.id)).toEqual([
      'owner',
      'tier',
      'members',
      'slo',
      'runbook',
      'reviewed',
      'description',
    ]);
    expect(scorecardRubricSchema.safeParse(DEFAULT_SCORECARD_RUBRIC).success).toBe(true);
    expect(scoreBusinessService(full, NOW).level?.id).toBe('gold');
    expect(scoreBusinessService({ ...full, sloTarget: null }, NOW).level?.id).toBe('bronze');
    expect(scoreBusinessService({ ...full, ownerTeamId: null }, NOW).level).toBeNull();
  });

  it('reaches a level only when it and every lower level pass', () => {
    const r = rubric([
      { id: 'owner', label: 'Owner', check: { type: 'field', field: 'owner' }, level: 'bronze' },
      {
        id: 'ep',
        label: 'Escalation',
        check: { type: 'field', field: 'escalationPolicy' },
        level: 'gold',
      },
    ]);
    expect(scoreBusinessService({ ...full, escalationPolicyId: 'ep' }, NOW, r).level?.id).toBe(
      'gold'
    );
    expect(scoreBusinessService(full, NOW, r).level?.id).toBe('bronze');
    expect(scoreBusinessService(full, NOW, r).score).toBe(50);
  });

  it('checks custom attributes for presence or an exact value', () => {
    const r = rubric([
      { id: 'pii', label: 'PII classified', check: { type: 'attribute', key: 'pii' } },
      { id: 'region', label: 'EU', check: { type: 'attribute', key: 'region', equals: 'eu' } },
    ]);
    const card = scoreBusinessService(
      { ...full, customAttributes: { pii: false, region: 'us' } },
      NOW,
      r
    );
    expect(card.checks.map(check => [check.id, check.passed])).toEqual([
      ['pii', true],
      ['region', false],
    ]);
  });

  it('applies scoped rules only to matching teams and tiers', () => {
    const r = rubric([
      { id: 'slo', label: 'SLO', check: { type: 'field', field: 'slo' }, tiers: ['TIER_0'] },
      {
        id: 'desc',
        label: 'Description',
        check: { type: 'field', field: 'description' },
        teamIds: ['other'],
      },
      { id: 'owner', label: 'Owner', check: { type: 'field', field: 'owner' } },
    ]);
    const card = scoreBusinessService({ ...full, criticality: 'TIER_1' }, NOW, r);
    expect(card.checks.map(check => check.id)).toEqual(['owner']);
  });

  it('marks a failing rule overdue only after its deadline day', () => {
    const r = rubric([
      {
        id: 'ep',
        label: 'EP',
        check: { type: 'field', field: 'escalationPolicy' },
        deadline: '2026-11-23',
      },
      {
        id: 'cc',
        label: 'Channel',
        check: { type: 'field', field: 'contactChannel' },
        deadline: '2026-11-24',
      },
    ]);
    const card = scoreBusinessService(full, NOW, r);
    expect(card.checks.map(check => [check.id, check.overdue, check.deadline])).toEqual([
      ['ep', true, '2026-11-23'],
      ['cc', false, '2026-11-24'],
    ]);
  });

  it('scores SLO state and hygiene only when they are loaded', () => {
    const r = rubric([
      { id: 'budget', label: 'Budget', check: { type: 'slo', state: 'NOT_BREACHED' } },
      { id: 'fresh', label: 'Review', check: { type: 'hygiene', flag: 'REVIEW_OVERDUE' } },
    ]);
    expect(scoreBusinessService(full, NOW, r).checks).toEqual([]);
    const loaded = scoreBusinessService(
      { ...full, sloState: 'AT_RISK', hygiene: ['REVIEW_OVERDUE'] },
      NOW,
      r
    );
    expect(loaded.checks.map(check => check.passed)).toEqual([true, false]);
    expect(
      scoreBusinessService({ ...full, sloState: null, hygiene: [] }, NOW, r).checks.map(
        c => c.passed
      )
    ).toEqual([false, true]);
    expect(rubricNeeds(r)).toEqual({ sloState: true, hygiene: true });
  });

  it('keeps the needs filter on the structural basics whatever the rubric says', () => {
    const r = rubric([
      { id: 'desc', label: 'Description', check: { type: 'field', field: 'description' } },
    ]);
    const card = scoreBusinessService({ ...full, memberCount: 0 }, NOW, r);
    expect(card.needsAttention).toBe(true);
    expect(matchesNeed(card, 'no-members')).toBe(true);
  });

  it('rejects duplicate ids, unknown levels and misplaced options', () => {
    const base = { id: 'a', label: 'A', check: { type: 'field', field: 'owner' } };
    for (const rules of [
      [base, base],
      [{ ...base, level: 'platinum' }],
      [{ ...base, check: { type: 'field', field: 'owner', maxAgeDays: 3 } }],
      [{ ...base, check: { type: 'field', field: 'nope' } }],
      [{ ...base, deadline: '2026-13-45' }],
    ])
      expect(scorecardRubricSchema.safeParse({ levels: [], rules }).success).toBe(false);
    expect(normalizeRubric({ levels: [], rules: [] })).toBe(DEFAULT_SCORECARD_RUBRIC);
  });
});

describe('saveScorecardRubric', () => {
  const tx = () => ({
    systemConfig: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    team: { findMany: vi.fn(async () => [{ id: 'team_a' }]) },
    user: { findUnique: vi.fn(async () => null) },
    auditLog: { create: vi.fn(async () => ({})) },
  });
  const rules = (teamIds: string[]) => [
    { id: 'owner', label: 'Owner', check: { type: 'field', field: 'owner' }, teamIds },
  ];

  it('stores the rubric and audits the old and new value', async () => {
    const client = tx();
    const saved = await saveScorecardRubric(
      { levels: [], rules: rules(['team_a']) },
      { id: 'u1', source: 'API' },
      client as never
    );
    expect(saved.rules[0].teamIds).toEqual(['team_a']);
    expect(client.systemConfig.upsert).toHaveBeenCalledOnce();
    const audit = (
      client.auditLog.create.mock.calls[0] as unknown as [
        { data: { action: string; details: { oldValue: { rules: unknown[] } } } },
      ]
    )[0].data;
    expect(audit.action).toBe('business_service.scorecard_rubric_updated');
    expect(audit.details.oldValue.rules).toHaveLength(7);
  });

  it('rejects a scope naming an unknown team without writing', async () => {
    const client = tx();
    await expect(
      saveScorecardRubric(
        { levels: [], rules: rules(['ghost']) },
        { id: 'u1', source: 'UI' },
        client as never
      )
    ).rejects.toThrow();
    expect(client.systemConfig.upsert).not.toHaveBeenCalled();
  });
});
