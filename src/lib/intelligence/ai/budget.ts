import 'server-only';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { checkRateLimit } from '@/lib/rate-limit';
import type { AiCallSite, AiUsage } from './port';
import {
  AI_DEGRADE_AT,
  BACKGROUND_EMBEDDING_ACTOR,
  backgroundAiTokenBudget,
  backgroundEmbeddingTokenBudget,
} from './contract';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import {
  CACHE_READ_BUDGET_WEIGHT,
  exceededScopedBudget,
  recordUsageBreakdown,
  type ReservationScope,
  type UsageAttribution,
} from './scoped-budget';

export type { ReservationScope, UsageAttribution } from './scoped-budget';
export { CACHE_READ_BUDGET_WEIGHT } from './scoped-budget';

type RejectionScope = 'global' | 'user' | 'background' | 'team' | 'capability';
const countRejection = (scope: RejectionScope) =>
  addOperationalMetric('opsknight_intelligence_ai_budget_rejections_total', 1, { scope });

type TokenLimits = {
  dailyTokenBudget: number;
  userDailyTokenBudget?: number;
  backgroundEmbeddingBudgetPercent?: number;
  /** Spend controls: the background allowance and degradation apply only when this is on. */
  spendControlsEnabled?: boolean;
  backgroundAiBudgetPercent?: number;
};

export type AdmissionDecision =
  | {
      allowed: true;
      /** At 80% of a daily budget: small model and shorter answers. */ degraded?: true;
    }
  | { allowed: false; reason: 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' };

export const utcDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/** Background work (embedding) acts as a system identity, never as a person, and has no personal share. */
const isPerson = (actorId: string) => !actorId.includes(':');

/** Calls nobody is waiting for: the first to be shed when spend runs high. */
export const isBackgroundCall = (callSite: string | null | undefined) =>
  callSite === 'proactive' || callSite === 'background';

/**
 * Per-user rate limit, the per-user daily token share and the global daily token budget, checked before
 * any model call. Atomic reservations below include concurrent in-flight requests in both limits. A failure to read them fails closed, because uncontrolled spend is the thing the
 * budget exists to stop.
 */
export async function admitAiRequest(
  actorId: string,
  limits: TokenLimits & {
    requestsPerMinutePerUser: number;
  },
  now: Date = new Date(),
  callSite?: AiCallSite
): Promise<AdmissionDecision> {
  const rate = await checkRateLimit(`ai:user:${actorId}`, limits.requestsPerMinutePerUser, 60_000);
  if (!rate.allowed) return { allowed: false, reason: 'RATE_LIMITED' };
  const day = utcDay(now);
  const [row, personal] = await Promise.all([
    prisma.aiUsageDay.findUnique({
      where: { day },
      select: {
        inputTokens: true,
        outputTokens: true,
        backgroundEmbeddingTokens: true,
        backgroundAiTokens: true,
      },
    }),
    limits.userDailyTokenBudget && isPerson(actorId)
      ? prisma.aiUsageUserDay.findUnique({
          where: { day_userId: { day, userId: actorId } },
          select: { tokens: true },
        })
      : Promise.resolve(null),
  ]);
  const used = (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0);
  if (used >= limits.dailyTokenBudget) return { allowed: false, reason: 'BUDGET_EXHAUSTED' };
  if (
    actorId === BACKGROUND_EMBEDDING_ACTOR &&
    (row?.backgroundEmbeddingTokens ?? 0) >= backgroundEmbeddingTokenBudget(limits)
  )
    return { allowed: false, reason: 'BUDGET_EXHAUSTED' };
  if (limits.userDailyTokenBudget && (personal?.tokens ?? 0) >= limits.userDailyTokenBudget) {
    return { allowed: false, reason: 'BUDGET_EXHAUSTED' };
  }
  if (!limits.spendControlsEnabled) return { allowed: true };
  const degraded =
    used >= limits.dailyTokenBudget * AI_DEGRADE_AT ||
    (!!limits.userDailyTokenBudget &&
      (personal?.tokens ?? 0) >= limits.userDailyTokenBudget * AI_DEGRADE_AT);
  // Shed first: background AI pauses from the degradation point and once its own allowance is used.
  if (
    isBackgroundCall(callSite) &&
    (degraded || (row?.backgroundAiTokens ?? 0) >= backgroundAiTokenBudget(limits))
  ) {
    countRejection('background');
    return { allowed: false, reason: 'BUDGET_EXHAUSTED' };
  }
  return degraded ? { allowed: true, degraded: true } : { allowed: true };
}

const MAX_TOKENS_PER_CALL = 2_000_000;
const clampTokens = (value: number) =>
  Math.max(0, Math.min(MAX_TOKENS_PER_CALL, Math.trunc(Number.isFinite(value) ? value : 0)));

export interface AiReservation {
  id: string;
  day: string;
}

/**
 * Serialize admission and settlement by UTC day, including all active reservations. With `extend`, the same
 * checks admit `estimate` more tokens onto that open hold (a multi-step call tops up per step) instead of
 * opening a new one; null when the budget refuses the top-up or the hold is already settled.
 */
export async function reserveAiTokens(
  actorId: string,
  limits: TokenLimits,
  estimate: number,
  ttlMs = 120_000,
  now = new Date(),
  scope?: ReservationScope,
  extend?: AiReservation
): Promise<AiReservation | null> {
  const day = extend?.day ?? utcDay(now);
  const tokens = Math.max(1, clampTokens(estimate));
  return prisma.$transaction(async tx => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-budget:${day}`}, 0))`
    );
    const [usage, personal, reserved] = await Promise.all([
      tx.aiUsageDay.findUnique({ where: { day } }),
      isPerson(actorId)
        ? tx.aiUsageUserDay.findUnique({ where: { day_userId: { day, userId: actorId } } })
        : null,
      tx.$queryRaw<
        Array<{ total: bigint; personal: bigint; background: bigint; backgroundAi: bigint }>
      >(Prisma.sql`
        SELECT coalesce(sum(tokens),0)::bigint AS total,
          coalesce(sum(tokens) FILTER (WHERE "actorId" = ${actorId}),0)::bigint AS personal,
          coalesce(sum(tokens) FILTER (WHERE "actorId" = ${BACKGROUND_EMBEDDING_ACTOR}),0)::bigint AS background,
          coalesce(sum(tokens) FILTER (WHERE "callSite" IN ('proactive', 'background')),0)::bigint AS "backgroundAi"
        FROM "AiTokenReservation" WHERE day = ${day} AND "settledAt" IS NULL AND "expiresAt" > ${now}`),
    ]);
    const committed =
      (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) + Number(reserved[0].total) + tokens;
    const rejected: RejectionScope | null =
      committed > limits.dailyTokenBudget
        ? 'global'
        : // Background AI never pushes the day past the degradation point, nor past its own allowance.
          limits.spendControlsEnabled &&
            isBackgroundCall(scope?.callSite) &&
            (committed > Math.floor(limits.dailyTokenBudget * AI_DEGRADE_AT) ||
              (usage?.backgroundAiTokens ?? 0) + Number(reserved[0].backgroundAi) + tokens >
                backgroundAiTokenBudget(limits))
          ? 'background'
          : actorId === BACKGROUND_EMBEDDING_ACTOR &&
              (usage?.backgroundEmbeddingTokens ?? 0) + Number(reserved[0].background) + tokens >
                backgroundEmbeddingTokenBudget(limits)
            ? 'background'
            : isPerson(actorId) &&
                limits.userDailyTokenBudget &&
                (personal?.tokens ?? 0) + Number(reserved[0].personal) + tokens >
                  limits.userDailyTokenBudget
              ? 'user'
              : null;
    if (rejected) {
      countRejection(rejected);
      return null;
    }
    // Optional team and capability budgets, under the same day lock as the global budget.
    const scoped = await exceededScopedBudget(tx, day, now, tokens, scope);
    if (scoped) {
      countRejection(scoped === 'TEAM' ? 'team' : 'capability');
      return null;
    }
    const estimatedCost =
      scope?.costMicros === null || scope?.costMicros === undefined
        ? null
        : BigInt(Math.max(0, Math.round(scope.costMicros)));
    const expiresAt = new Date(+now + Math.max(60_000, Math.min(ttlMs, 3_600_000)));
    if (extend) {
      const updated = await tx.aiTokenReservation.updateMany({
        where: { id: extend.id, settledAt: null },
        data: {
          tokens: { increment: tokens },
          expiresAt,
          ...(estimatedCost === null ? {} : { costMicros: { increment: estimatedCost } }),
        },
      });
      return updated.count ? extend : null;
    }
    const row = await tx.aiTokenReservation.create({
      data: {
        day,
        actorId,
        tokens,
        expiresAt,
        teamId: scope?.teamId ?? null,
        capability: scope?.capability ?? null,
        costMicros: estimatedCost,
        callSite: scope?.callSite ?? null,
      },
      select: { id: true, day: true },
    });
    // Retain settled receipts for a day so retried accounting is idempotent; bound maintenance work.
    await tx.$executeRaw(Prisma.sql`DELETE FROM "AiTokenReservation" WHERE id IN (
      SELECT id FROM "AiTokenReservation" WHERE "expiresAt" < ${new Date(+now - 86_400_000)} LIMIT 500)`);
    return row;
  });
}

export async function recordAiUsage(
  usage: AiUsage,
  now: Date = new Date(),
  actorId?: string,
  reservation?: AiReservation,
  attribution?: UsageAttribution
): Promise<void> {
  const rawInputTokens = clampTokens(usage.inputTokens);
  // Cache reads count at a tenth against token budgets (they cost about that); the breakdown keeps raw counts.
  const inputTokens = Math.max(
    0,
    rawInputTokens -
      Math.round(clampTokens(usage.cacheReadTokens ?? 0) * (1 - CACHE_READ_BUDGET_WEIGHT))
  );
  const outputTokens = clampTokens(usage.outputTokens);
  const day = reservation?.day ?? utcDay(now);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-budget:${day}`}, 0))`
    );
    const held = reservation
      ? await tx.aiTokenReservation.findUnique({ where: { id: reservation.id } })
      : null;
    if (reservation && (!held || held.settledAt)) return;
    const person = held?.actorId ?? actorId;
    const backgroundEmbeddingTokens =
      person === BACKGROUND_EMBEDDING_ACTOR ? inputTokens + outputTokens : 0;
    const backgroundAiTokens = isBackgroundCall(held?.callSite) ? inputTokens + outputTokens : 0;
    await tx.aiUsageDay.upsert({
      where: { day },
      create: {
        day,
        requests: 1,
        inputTokens,
        outputTokens,
        backgroundEmbeddingTokens,
        backgroundAiTokens,
      },
      update: {
        requests: { increment: 1 },
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
        backgroundEmbeddingTokens: { increment: backgroundEmbeddingTokens },
        backgroundAiTokens: { increment: backgroundAiTokens },
      },
    });
    const cost = attribution?.costMicros ?? null;
    const costMicros = cost === null ? null : BigInt(Math.max(0, Math.round(cost)));
    if (costMicros !== null)
      await tx.$executeRaw(Prisma.sql`UPDATE "AiUsageDay"
        SET "costMicros" = coalesce("costMicros", 0) + ${costMicros} WHERE day = ${day}`);
    if (attribution)
      await recordUsageBreakdown(
        tx,
        day,
        {
          inputTokens: rawInputTokens,
          outputTokens,
          cacheReadTokens: clampTokens(usage.cacheReadTokens ?? 0),
          cacheWriteTokens: clampTokens(usage.cacheWriteTokens ?? 0),
        },
        {
          ...attribution,
          // The hold's attribution wins: it is what the budget was checked against.
          teamId: held?.teamId ?? attribution.teamId ?? null,
          capability: held?.capability ?? attribution.capability ?? null,
        }
      );
    if (person && isPerson(person)) {
      const users = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "User" WHERE id = ${person} FOR KEY SHARE`
      );
      if (users.length)
        await tx.aiUsageUserDay.upsert({
          where: { day_userId: { day, userId: person } },
          create: { day, userId: person, tokens: inputTokens + outputTokens },
          update: { tokens: { increment: inputTokens + outputTokens } },
        });
      if (users.length && costMicros !== null)
        await tx.$executeRaw(Prisma.sql`UPDATE "AiUsageUserDay"
          SET "costMicros" = coalesce("costMicros", 0) + ${costMicros}
          WHERE day = ${day} AND "userId" = ${person}`);
    }
    if (held)
      await tx.aiTokenReservation.update({ where: { id: held.id }, data: { settledAt: now } });
  });
}

/** Rough token count (about four characters per token) for work that ended before the provider reported usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Where today's spend stands, for the notices in Squire and on AI-drafted surfaces: `lean` from the degradation
 * point (small model, shorter answers, background AI paused), `exhausted` at the budget (deterministic only).
 * Without spend controls only `exhausted` is reported. One primary-key read.
 */
export type AiSpendLevel = 'normal' | 'lean' | 'exhausted';

export function spendLevel(
  used: number,
  limits: Pick<TokenLimits, 'dailyTokenBudget' | 'spendControlsEnabled'>
): AiSpendLevel {
  if (used >= limits.dailyTokenBudget) return 'exhausted';
  return limits.spendControlsEnabled && used >= limits.dailyTokenBudget * AI_DEGRADE_AT
    ? 'lean'
    : 'normal';
}

export async function getAiSpendLevel(
  limits: Pick<TokenLimits, 'dailyTokenBudget' | 'spendControlsEnabled'>,
  now: Date = new Date()
): Promise<AiSpendLevel> {
  const row = await prisma.aiUsageDay.findUnique({
    where: { day: utcDay(now) },
    select: { inputTokens: true, outputTokens: true },
  });
  return spendLevel((row?.inputTokens ?? 0) + (row?.outputTokens ?? 0), limits);
}

export async function getTodayUsage(now: Date = new Date()) {
  const row = await prisma.aiUsageDay.findUnique({ where: { day: utcDay(now) } });
  return {
    requests: row?.requests ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
    backgroundEmbeddingTokens: row?.backgroundEmbeddingTokens ?? 0,
  };
}

export interface UsageDay {
  day: string;
  requests: number;
  tokens: number;
}

/** One row per UTC day for the last `days` days, oldest first, with zero-filled gaps. */
export async function getUsageHistory(days = 14, now: Date = new Date()): Promise<UsageDay[]> {
  const span = Math.min(Math.max(Math.trunc(days), 1), 90);
  const keys = Array.from({ length: span }, (_, index) =>
    utcDay(new Date(now.getTime() - (span - 1 - index) * 86_400_000))
  );
  const rows = await prisma.aiUsageDay.findMany({
    where: { day: { gte: keys[0], lte: keys[keys.length - 1] } },
    select: { day: true, requests: true, inputTokens: true, outputTokens: true },
  });
  const byDay = new Map(rows.map(row => [row.day, row]));
  return keys.map(day => {
    const row = byDay.get(day);
    return {
      day,
      requests: row?.requests ?? 0,
      tokens: (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0),
    };
  });
}
