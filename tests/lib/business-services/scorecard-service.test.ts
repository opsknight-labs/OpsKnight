import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  row: vi.fn(),
  config: vi.fn(),
  stats: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: {
    businessService: { findFirst: mocks.row },
    systemConfig: { findUnique: mocks.config },
  },
}));
vi.mock('@/lib/business-services/stats', () => ({ getBusinessServiceStats: mocks.stats }));

import { getBusinessServiceScorecard } from '@/lib/business-services/scorecard-service';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const NOW = new Date('2026-11-24T00:00:00Z');
const admin: AuthorizationActor = { id: 'u', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };
const row = {
  id: 'bs1',
  ownerTeamId: 't',
  ownerUserId: null,
  criticality: 'TIER_1',
  sloTarget: 99.9,
  sloWindowDays: 30,
  links: [{ label: 'Runbook', url: 'https://example.com' }],
  description: 'Checkout',
  lastReviewedAt: new Date('2026-11-01T00:00:00Z'),
  reviewIntervalDays: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  escalationPolicyId: null,
  contactChannel: null,
  statusPageSummary: null,
  customAttributes: { pii: 'none' },
  ownerUser: null,
  _count: { members: 2 },
};

describe('getBusinessServiceScorecard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scores with the default rubric without loading SLO stats', async () => {
    mocks.row.mockResolvedValue(row);
    mocks.config.mockResolvedValue(null);
    const card = await getBusinessServiceScorecard('bs1', admin, NOW);
    expect(card).toMatchObject({ businessServiceId: 'bs1', score: 100, level: { id: 'gold' } });
    expect(mocks.stats).not.toHaveBeenCalled();
  });

  it('loads the burn state only when the rubric has an SLO rule', async () => {
    mocks.row.mockResolvedValue(row);
    mocks.config.mockResolvedValue({
      value: {
        levels: [],
        rules: [{ id: 'budget', label: 'Budget', check: { type: 'slo', state: 'OK' } }],
      },
    });
    // 60 weighted minutes of 43.2 allowed: breached.
    mocks.stats.mockResolvedValue({
      weightedDowntimeMinutes: 60,
      impactMinutes: 60,
      weightedWindowMinutes: 43_200,
    });
    const card = await getBusinessServiceScorecard('bs1', admin, NOW);
    expect(card.checks).toEqual([expect.objectContaining({ id: 'budget', passed: false })]);
    expect(mocks.stats).toHaveBeenCalledOnce();
  });

  it('hides a business service outside the read scope', async () => {
    mocks.row.mockResolvedValue(null);
    await expect(getBusinessServiceScorecard('bs1', admin, NOW)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
});
