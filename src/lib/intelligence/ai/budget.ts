import 'server-only';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { checkRateLimit } from '@/lib/rate-limit';
import type { AiUsage } from './port';

export type AdmissionDecision =
  { allowed: true } | { allowed: false; reason: 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' };

export const utcDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/** Background work (embedding) acts as a system identity, never as a person, and has no personal share. */
const isPerson = (actorId: string) => !actorId.includes(':');

/**
 * Per-user rate limit, the per-user daily token share and the global daily token budget, checked before
 * any model call. Atomic reservations below include concurrent in-flight requests in both limits. A failure to read them fails closed, because uncontrolled spend is the thing the
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

export interface AiReservation {
  id: string;
  day: string;
}

/** Serialize admission and settlement by UTC day, including all active reservations. */
export async function reserveAiTokens(
  actorId: string,
  limits: { dailyTokenBudget: number; userDailyTokenBudget?: number },
  estimate: number,
  ttlMs = 120_000,
  now = new Date()
): Promise<AiReservation | null> {
  const day = utcDay(now);
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
      tx.$queryRaw<Array<{ total: bigint; personal: bigint }>>(Prisma.sql`
        SELECT coalesce(sum(tokens),0)::bigint AS total,
          coalesce(sum(tokens) FILTER (WHERE "actorId" = ${actorId}),0)::bigint AS personal
        FROM "AiTokenReservation" WHERE day = ${day} AND "settledAt" IS NULL AND "expiresAt" > ${now}`),
    ]);
    if (
      (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) + Number(reserved[0].total) + tokens >
        limits.dailyTokenBudget ||
      (isPerson(actorId) &&
        limits.userDailyTokenBudget &&
        (personal?.tokens ?? 0) + Number(reserved[0].personal) + tokens >
          limits.userDailyTokenBudget)
    )
      return null;
    const row = await tx.aiTokenReservation.create({
      data: {
        day,
        actorId,
        tokens,
        expiresAt: new Date(+now + Math.max(60_000, Math.min(ttlMs, 3_600_000))),
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
  reservation?: AiReservation
): Promise<void> {
  const inputTokens = clampTokens(usage.inputTokens);
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
    await tx.aiUsageDay.upsert({
      where: { day },
      create: { day, requests: 1, inputTokens, outputTokens },
      update: {
        requests: { increment: 1 },
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
      },
    });
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
    }
    if (held)
      await tx.aiTokenReservation.update({ where: { id: held.id }, data: { settledAt: now } });
  });
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
