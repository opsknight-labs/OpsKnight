import 'server-only';

import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { businessServiceReadWhere } from './commands';
import { evaluateHygiene } from './hygiene';
import { parseBusinessServiceLinks } from './links';
import { rubricNeeds, scoreBusinessService, type Scorecard } from './scorecard';
import { getScorecardRubric } from './scorecard-config';
import { computeErrorBudget, type BurnState } from './slo';
import { getBusinessServiceStats } from './stats';

/** One business service scored against the configured rubric, inside the actor's read scope. */
export async function getBusinessServiceScorecard(
  id: string,
  actor: AuthorizationActor,
  now = new Date()
): Promise<Scorecard & { businessServiceId: string }> {
  const row = await prisma.businessService.findFirst({
    where: { AND: [{ id }, businessServiceReadWhere(actor)] },
    select: {
      id: true,
      ownerTeamId: true,
      ownerUserId: true,
      criticality: true,
      sloTarget: true,
      sloWindowDays: true,
      links: true,
      description: true,
      lastReviewedAt: true,
      reviewIntervalDays: true,
      createdAt: true,
      escalationPolicyId: true,
      contactChannel: true,
      statusPageSummary: true,
      customAttributes: true,
      ownerUser: { select: { status: true } },
      _count: { select: { members: true } },
    },
  });
  if (!row) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const rubric = await getScorecardRubric();
  const needs = rubricNeeds(rubric);
  let sloState: BurnState | null | undefined;
  if (needs.sloState && row.sloTarget !== null) {
    const to = now;
    const from = new Date(to.getTime() - row.sloWindowDays * 86_400_000);
    const stats = await getBusinessServiceStats(row.id, { from, to }, actor);
    sloState = computeErrorBudget({
      targetPercent: row.sloTarget,
      windowDays: row.sloWindowDays,
      downtimeMinutes: stats.weightedDowntimeMinutes ?? stats.impactMinutes,
      windowMinutes: stats.weightedWindowMinutes,
    }).burnState;
  } else if (needs.sloState) sloState = null;
  const attributes =
    row.customAttributes &&
    typeof row.customAttributes === 'object' &&
    !Array.isArray(row.customAttributes)
      ? (row.customAttributes as Record<string, unknown>)
      : null;
  const card = scoreBusinessService(
    {
      ...row,
      memberCount: row._count.members,
      linkCount: parseBusinessServiceLinks(row.links).length,
      customAttributes: attributes,
      sloState,
      // Team reachability needs schedule reads; the hygiene sweep reports it, the scorecard does not.
      hygiene: needs.hygiene
        ? evaluateHygiene(
            {
              createdAt: row.createdAt,
              lastReviewedAt: row.lastReviewedAt,
              reviewIntervalDays: row.reviewIntervalDays,
              ownerUserId: row.ownerUserId,
              ownerUserStatus: row.ownerUser?.status ?? null,
              ownerTeamId: null,
              teamUnreachable: null,
            },
            now
          )
        : undefined,
    },
    now,
    rubric
  );
  return { businessServiceId: row.id, ...card };
}
