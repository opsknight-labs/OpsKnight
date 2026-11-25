import { describe, expect, it } from 'vitest';
import { matchesNeed, scoreBusinessService } from '@/lib/business-services/scorecard';

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
