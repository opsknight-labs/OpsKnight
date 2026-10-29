import 'server-only';
import prisma from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import type { AiUsage } from './port';

export type AdmissionDecision =
  { allowed: true } | { allowed: false; reason: 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' };

export const utcDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/** Background work (embedding) acts as a system identity, never as a person, and has no personal share. */
const isPerson = (actorId: string) => !actorId.includes(':');

/**
 * Per-user rate limit, the per-user daily token share and the global daily token budget, checked before
 * any model call. Budgets are soft ceilings: concurrent in-flight requests can overshoot them by at most
 * their own output caps. A failure to read them fails closed, because uncontrolled spend is the thing the
 * budget exists to stop.
 */
export async function admitAiRequest(
  actorId: string,
  limits: {
    requestsPerMinutePerUser: number;
    dailyTokenBudget: number;
    userDailyTokenBudget?: number;
  },
  now: Date = new Date()
): Promise<AdmissionDecision> {
  const rate = await checkRateLimit(`ai:user:${actorId}`, limits.requestsPerMinutePerUser, 60_000);
  if (!rate.allowed) return { allowed: false, reason: 'RATE_LIMITED' };
  const day = utcDay(now);
  const [row, personal] = await Promise.all([
    prisma.aiUsageDay.findUnique({
      where: { day },
      select: { inputTokens: true, outputTokens: true },
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
  if (limits.userDailyTokenBudget && (personal?.tokens ?? 0) >= limits.userDailyTokenBudget) {
    return { allowed: false, reason: 'BUDGET_EXHAUSTED' };
  }
  return { allowed: true };
}

const MAX_TOKENS_PER_CALL = 2_000_000;
const clampTokens = (value: number) =>
  Math.max(0, Math.min(MAX_TOKENS_PER_CALL, Math.trunc(Number.isFinite(value) ? value : 0)));

export async function recordAiUsage(
  usage: AiUsage,
  now: Date = new Date(),
  actorId?: string
): Promise<void> {
  const inputTokens = clampTokens(usage.inputTokens);
  const outputTokens = clampTokens(usage.outputTokens);
  const day = utcDay(now);
  await prisma.aiUsageDay.upsert({
    where: { day },
    create: { day, requests: 1, inputTokens, outputTokens },
    update: {
      requests: { increment: 1 },
      inputTokens: { increment: inputTokens },
      outputTokens: { increment: outputTokens },
    },
  });
  if (actorId && isPerson(actorId)) {
    const tokens = inputTokens + outputTokens;
    await prisma.aiUsageUserDay
      .upsert({
        where: { day_userId: { day, userId: actorId } },
        create: { day, userId: actorId, tokens },
        update: { tokens: { increment: tokens } },
      })
      // The person may have been deleted mid-request; the global count above is what matters then.
      .catch(() => undefined);
  }
}

/** Rough token count (about four characters per token) for work that ended before the provider reported usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function getTodayUsage(now: Date = new Date()) {
  const row = await prisma.aiUsageDay.findUnique({ where: { day: utcDay(now) } });
  return {
    requests: row?.requests ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
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
