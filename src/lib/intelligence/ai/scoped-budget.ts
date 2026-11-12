import 'server-only';
import { Prisma } from '@prisma/client';
import { budgetKey, wouldExceed, type BudgetLimits, type BudgetScope } from './pricing';

type Tx = Prisma.TransactionClient;

/**
 * Attribution carried by a reservation: which team and capability the call is charged to, and its
 * estimated dollar cost. Every field is optional so callers that predate cost governance are unchanged.
 */
export interface ReservationScope {
  capability?: string | null;
  teamId?: string | null;
  /** Estimated cost of the hold in millionths of a dollar; null or absent when the model has no price. */
  costMicros?: number | null;
}

/** What a settled call actually used, for dollars and the per-team/capability/model breakdown. */
export interface UsageAttribution {
  providerKind: string;
  model: string;
  capability?: string | null;
  teamId?: string | null;
  /** Actual cost in micros; null when the model has no price. */
  costMicros: number | null;
}

const toLimits = (row: {
  dailyTokenLimit: number | null;
  dailyCostLimitMicros: bigint | null;
}): BudgetLimits => ({
  dailyTokenLimit: row.dailyTokenLimit,
  dailyCostLimitMicros: row.dailyCostLimitMicros === null ? null : Number(row.dailyCostLimitMicros),
});

/**
 * Checks the optional team and capability budgets that apply to one reservation. Runs inside the caller's
 * day-locked transaction so it serialises with every other reservation and settlement of the same UTC day.
 * Returns the scope that would be exceeded, or null. Any read error propagates: the caller fails closed.
 */
export async function exceededScopedBudget(
  tx: Tx,
  day: string,
  now: Date,
  tokens: number,
  scope: ReservationScope | undefined
): Promise<BudgetScope | null> {
  if (!scope) return null;
  const keys = [
    ...(scope.teamId ? [budgetKey('TEAM', scope.teamId)] : []),
    ...(scope.capability ? [budgetKey('CAPABILITY', scope.capability)] : []),
  ];
  if (keys.length === 0) return null;
  const budgets = await tx.aiBudget.findMany({
    where: { key: { in: keys }, enabled: true },
    select: { scope: true, dailyTokenLimit: true, dailyCostLimitMicros: true },
  });
  if (budgets.length === 0) return null;
  const team = scope.teamId ?? null;
  const capability = scope.capability ?? null;
  const [settled] = await tx.$queryRaw<
    Array<{ teamTokens: bigint; teamCost: bigint; capTokens: bigint; capCost: bigint }>
  >(Prisma.sql`
    SELECT
      coalesce(sum("inputTokens" + "outputTokens") FILTER (WHERE "teamId" = ${team ?? ''}), 0)::bigint AS "teamTokens",
      coalesce(sum("costMicros") FILTER (WHERE "teamId" = ${team ?? ''}), 0)::bigint AS "teamCost",
      coalesce(sum("inputTokens" + "outputTokens") FILTER (WHERE capability = ${capability}), 0)::bigint AS "capTokens",
      coalesce(sum("costMicros") FILTER (WHERE capability = ${capability}), 0)::bigint AS "capCost"
    FROM "AiUsageBreakdownDay" WHERE day = ${day}`);
  const [held] = await tx.$queryRaw<
    Array<{ teamTokens: bigint; teamCost: bigint; capTokens: bigint; capCost: bigint }>
  >(Prisma.sql`
    SELECT
      coalesce(sum(tokens) FILTER (WHERE "teamId" = ${team}), 0)::bigint AS "teamTokens",
      coalesce(sum("costMicros") FILTER (WHERE "teamId" = ${team}), 0)::bigint AS "teamCost",
      coalesce(sum(tokens) FILTER (WHERE capability = ${capability}), 0)::bigint AS "capTokens",
      coalesce(sum("costMicros") FILTER (WHERE capability = ${capability}), 0)::bigint AS "capCost"
    FROM "AiTokenReservation"
    WHERE day = ${day} AND "settledAt" IS NULL AND "expiresAt" > ${now}`);
  const request = { tokens, costMicros: Math.max(0, scope.costMicros ?? 0) };
  for (const budget of budgets) {
    const isTeam = budget.scope === 'TEAM';
    const current = {
      tokens: Number(
        isTeam ? settled.teamTokens + held.teamTokens : settled.capTokens + held.capTokens
      ),
      costMicros: Number(
        isTeam ? settled.teamCost + held.teamCost : settled.capCost + held.capCost
      ),
    };
    if (wouldExceed(toLimits(budget), current, request)) return isTeam ? 'TEAM' : 'CAPABILITY';
  }
  return null;
}

/** Adds one settled call to the day's team/capability/model breakdown. */
export async function recordUsageBreakdown(
  tx: Tx,
  day: string,
  usage: { inputTokens: number; outputTokens: number },
  attribution: UsageAttribution
): Promise<void> {
  const cost = attribution.costMicros;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "AiUsageBreakdownDay"
      (day, "teamId", capability, "providerKind", model, requests, "inputTokens", "outputTokens",
       "costMicros", "unpricedRequests", "updatedAt")
    VALUES (${day}, ${attribution.teamId ?? ''}, ${(attribution.capability ?? 'UNKNOWN').slice(0, 64)},
      ${attribution.providerKind.slice(0, 64)}, ${attribution.model.slice(0, 200)}, 1,
      ${usage.inputTokens}, ${usage.outputTokens}, ${BigInt(cost ?? 0)}, ${cost === null ? 1 : 0}, now())
    ON CONFLICT (day, "teamId", capability, "providerKind", model) DO UPDATE SET
      requests = "AiUsageBreakdownDay".requests + 1,
      "inputTokens" = "AiUsageBreakdownDay"."inputTokens" + EXCLUDED."inputTokens",
      "outputTokens" = "AiUsageBreakdownDay"."outputTokens" + EXCLUDED."outputTokens",
      "costMicros" = "AiUsageBreakdownDay"."costMicros" + EXCLUDED."costMicros",
      "unpricedRequests" = "AiUsageBreakdownDay"."unpricedRequests" + EXCLUDED."unpricedRequests",
      "updatedAt" = now()`);
}
