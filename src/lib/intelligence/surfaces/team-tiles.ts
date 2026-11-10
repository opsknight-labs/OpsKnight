import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { serviceReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { getBudgetStatuses } from '../ai/cost';
import { utcDay } from '../ai/budget';
import { getNoiseControlKpis } from '../noise-controls/kpis';

/**
 * The two intelligence tiles on a team's page. Both are null when there is nothing to say (no AI usage
 * and no budget; no alerts and no incidents), so the page renders no empty tile. Gated on
 * INTELLIGENCE_READ and on the team and its services being readable by the actor.
 */

export const TEAM_TILE_LIMITS = { maxServices: 500, days: 7 } as const;

export interface TeamAiUsageTile {
  todayTokens: number;
  todayCostMicros: number;
  /** Null when the team has no enabled budget of that kind. */
  dailyTokenLimit: number | null;
  dailyCostLimitMicros: number | null;
  /** Highest of the token and dollar ratios; 0 without a budget. */
  utilization: number;
  hasBudget: boolean;
  days: number;
  periodTokens: number;
  periodCostMicros: number;
}

export interface TeamNoiseLoadTile {
  days: number;
  services: number;
  alerts: number;
  incidents: number;
  /** Alerts per incident. */
  compressionRatio: number;
  pagesAvoided: number;
  shadowWouldAvoid: number;
}

export interface TeamIntelligenceTiles {
  aiUsage: TeamAiUsageTile | null;
  noiseLoad: TeamNoiseLoadTile | null;
}

async function loadAiUsage(
  teamId: string,
  now: Date,
  client: typeof prisma
): Promise<TeamAiUsageTile | null> {
  const days = TEAM_TILE_LIMITS.days;
  const firstDay = utcDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const [statuses, period] = await Promise.all([
    // The global figure is not shown here, so its limit is irrelevant.
    getBudgetStatuses(0, now, client),
    client.aiUsageBreakdownDay.aggregate({
      where: { teamId, day: { gte: firstDay, lte: utcDay(now) } },
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
    }),
  ]);
  const budget = statuses.find(status => status.scope === 'TEAM' && status.label === teamId);
  const periodTokens = (period._sum.inputTokens ?? 0) + (period._sum.outputTokens ?? 0);
  if (!budget && periodTokens === 0) return null;
  let today = { tokens: budget?.tokens ?? 0, costMicros: budget?.costMicros ?? 0 };
  if (!budget) {
    const settled = await client.aiUsageBreakdownDay.aggregate({
      where: { teamId, day: utcDay(now) },
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
    });
    today = {
      tokens: (settled._sum.inputTokens ?? 0) + (settled._sum.outputTokens ?? 0),
      costMicros: Number(settled._sum.costMicros ?? 0),
    };
  }
  return {
    todayTokens: today.tokens,
    todayCostMicros: today.costMicros,
    dailyTokenLimit: budget?.dailyTokenLimit ?? null,
    dailyCostLimitMicros: budget?.dailyCostLimitMicros ?? null,
    utilization: budget?.utilization ?? 0,
    hasBudget: Boolean(budget),
    days,
    periodTokens,
    periodCostMicros: Number(period._sum.costMicros ?? 0),
  };
}

async function loadNoiseLoad(
  teamId: string,
  services: Prisma.ServiceWhereInput,
  now: Date,
  client: typeof prisma
): Promise<TeamNoiseLoadTile | null> {
  const rows = await client.service.findMany({
    where: { AND: [{ teamId }, services] },
    orderBy: { id: 'asc' },
    take: TEAM_TILE_LIMITS.maxServices,
    select: { id: true },
  });
  if (!rows.length) return null;
  const kpis = await getNoiseControlKpis(
    { days: TEAM_TILE_LIMITS.days, serviceIds: rows.map(row => row.id), now },
    client
  );
  if (kpis.alerts === 0 && kpis.incidents === 0) return null;
  return {
    days: kpis.days,
    services: rows.length,
    alerts: kpis.alerts,
    incidents: kpis.incidents,
    compressionRatio: kpis.compressionRatio,
    pagesAvoided: kpis.pagesAvoided,
    shadowWouldAvoid: kpis.shadowWouldAvoid,
  };
}

export async function getTeamIntelligenceTiles(
  actor: AuthorizationActor,
  teamId: string,
  options: { now?: Date } = {},
  client: typeof prisma = prisma
): Promise<TeamIntelligenceTiles | null> {
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ))
    return null;
  let teams: Prisma.TeamWhereInput;
  let services: Prisma.ServiceWhereInput;
  try {
    teams = teamReadWhere(actor);
    services = serviceReadWhere(actor);
  } catch {
    return null;
  }
  const now = options.now ?? new Date();
  const soft = async <T>(label: string, load: () => Promise<T | null>): Promise<T | null> => {
    try {
      return await load();
    } catch (error) {
      logger.warn(`[Intelligence] Team tile unavailable: ${label}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
  const team = await soft('team', () =>
    client.team.findFirst({ where: { AND: [{ id: teamId }, teams] }, select: { id: true } })
  );
  if (!team) return null;
  const [aiUsage, noiseLoad] = await Promise.all([
    soft('ai usage', () => loadAiUsage(team.id, now, client)),
    soft('noise load', () => loadNoiseLoad(team.id, services, now, client)),
  ]);
  return aiUsage || noiseLoad ? { aiUsage, noiseLoad } : null;
}
