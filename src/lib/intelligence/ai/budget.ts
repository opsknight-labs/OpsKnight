import 'server-only';
import prisma from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import type { AiUsage } from './port';

export type AdmissionDecision = { allowed: true } | { allowed: false; reason: 'RATE_LIMITED' | 'BUDGET_EXHAUSTED' };

export const utcDay = (now: Date = new Date()) => now.toISOString().slice(0, 10);

/**
 * Per-user rate limit and the global daily token budget, checked before any model call. The budget is
 * a soft ceiling: concurrent in-flight requests can overshoot it by at most their own output caps.
 * A failure to read it fails closed, because uncontrolled spend is the thing the budget exists to stop.
 */
export async function admitAiRequest(
  actorId: string,
  limits: { requestsPerMinutePerUser: number; dailyTokenBudget: number },
  now: Date = new Date()
): Promise<AdmissionDecision> {
  const rate = await checkRateLimit(`ai:user:${actorId}`, limits.requestsPerMinutePerUser, 60_000);
  if (!rate.allowed) return { allowed: false, reason: 'RATE_LIMITED' };
  const row = await prisma.aiUsageDay.findUnique({
    where: { day: utcDay(now) },
    select: { inputTokens: true, outputTokens: true },
  });
  const used = (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0);
  return used >= limits.dailyTokenBudget ? { allowed: false, reason: 'BUDGET_EXHAUSTED' } : { allowed: true };
}

const MAX_TOKENS_PER_CALL = 2_000_000;
const clampTokens = (value: number) => Math.max(0, Math.min(MAX_TOKENS_PER_CALL, Math.trunc(Number.isFinite(value) ? value : 0)));

export async function recordAiUsage(usage: AiUsage, now: Date = new Date()): Promise<void> {
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
}

export async function getTodayUsage(now: Date = new Date()) {
  const row = await prisma.aiUsageDay.findUnique({ where: { day: utcDay(now) } });
  return { requests: row?.requests ?? 0, inputTokens: row?.inputTokens ?? 0, outputTokens: row?.outputTokens ?? 0 };
}
