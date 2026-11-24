import type { Prisma } from '@prisma/client';

/** Catalog completeness: which basics a business service is missing. Pure, no I/O. */

export const REVIEW_MAX_AGE_DAYS = 180;

export type ScorecardInput = {
  ownerTeamId: string | null;
  ownerUserId?: string | null;
  criticality: string | null;
  memberCount: number;
  sloTarget?: number | null;
  linkCount: number;
  description: string | null;
  lastReviewedAt?: Date | null;
};

export type ScorecardCheckId =
  'owner' | 'tier' | 'members' | 'slo' | 'runbook' | 'reviewed' | 'description';

export type Scorecard = {
  checks: Array<{ id: ScorecardCheckId; label: string; passed: boolean }>;
  /** Percent of checks passed, 0 to 100. */
  score: number;
  needsAttention: boolean;
};

export function scoreBusinessService(input: ScorecardInput, now = new Date()): Scorecard {
  const reviewedAt = input.lastReviewedAt?.getTime();
  const checks: Scorecard['checks'] = [
    { id: 'owner', label: 'Has an owner', passed: Boolean(input.ownerTeamId || input.ownerUserId) },
    { id: 'tier', label: 'Has a tier', passed: Boolean(input.criticality) },
    { id: 'members', label: 'Has member services', passed: input.memberCount > 0 },
    { id: 'slo', label: 'Has an SLO target', passed: input.sloTarget != null },
    { id: 'runbook', label: 'Has a runbook or links', passed: input.linkCount > 0 },
    {
      id: 'reviewed',
      label: `Reviewed in the last ${REVIEW_MAX_AGE_DAYS} days`,
      passed:
        reviewedAt !== undefined && now.getTime() - reviewedAt <= REVIEW_MAX_AGE_DAYS * 86_400_000,
    },
    { id: 'description', label: 'Has a description', passed: Boolean(input.description?.trim()) },
  ];
  const passed = checks.filter(check => check.passed).length;
  const failing = (id: ScorecardCheckId) => !checks.find(check => check.id === id)!.passed;
  return {
    checks,
    score: Math.round((passed / checks.length) * 100),
    // The structural basics drive the catalog "needs attention" strip, not SLO or review hygiene.
    needsAttention: failing('owner') || failing('tier') || failing('members'),
  };
}

export const CATALOG_NEEDS = ['attention', 'no-owner', 'no-tier', 'no-members'] as const;
export type CatalogNeed = (typeof CATALOG_NEEDS)[number];

/** The same needs as a database filter, so the catalog can page and filter in SQL. */
export function needsWhere(need: CatalogNeed): Prisma.BusinessServiceWhereInput {
  const noOwner = { ownerTeamId: null, ownerUserId: null };
  const noTier = { criticality: null };
  const noMembers = { members: { none: {} } };
  if (need === 'no-owner') return noOwner;
  if (need === 'no-tier') return noTier;
  if (need === 'no-members') return noMembers;
  return { OR: [noOwner, noTier, noMembers] };
}

/** Whether a scored service matches the catalog `?needs=` filter. */
export function matchesNeed(card: Scorecard, need: CatalogNeed): boolean {
  const failed = (id: ScorecardCheckId) => !card.checks.find(check => check.id === id)!.passed;
  if (need === 'attention') return card.needsAttention;
  return failed(need === 'no-owner' ? 'owner' : need === 'no-tier' ? 'tier' : 'members');
}
