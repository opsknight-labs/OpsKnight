import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { isValidTimeZone } from '@/lib/timezone';

export const REVIEW_CONFIG_KEY = 'business_service_reviews';
const MAX_SUMMARY_RECIPIENTS = 20;

export type ReviewConfig = {
  /** Master switch. Off by default; an admin turns it on. */
  enabled: boolean;
  /** Warn on change risk and the service page when an error budget is exhausted. Off by default. */
  freezeWarningEnabled: boolean;
  /** Tell owners and followers when an error budget turns at risk, breached or recovers. Off by default. */
  errorBudgetAlertsEnabled: boolean;
  /** 1..28 so every month has the day. */
  dayOfMonth: number;
  hour: number;
  timeZone: string;
  /** Existing users who also get the portfolio summary. */
  summaryUserIds: string[];
};

export const DEFAULT_REVIEW_CONFIG: ReviewConfig = {
  enabled: false,
  freezeWarningEnabled: false,
  errorBudgetAlertsEnabled: false,
  dayOfMonth: 1,
  hour: 9,
  timeZone: 'UTC',
  summaryUserIds: [],
};

export const reviewConfigSchema = z
  .object({
    enabled: z.boolean(),
    freezeWarningEnabled: z.boolean(),
    errorBudgetAlertsEnabled: z.boolean(),
    dayOfMonth: z.number().int().min(1).max(28),
    hour: z.number().int().min(0).max(23),
    timeZone: z.string().trim().min(1).max(64).refine(isValidTimeZone, 'Unknown time zone'),
    summaryUserIds: z.array(z.string().trim().min(1).max(100)).max(MAX_SUMMARY_RECIPIENTS),
    /** Convenience: resolved to existing users; unknown addresses are rejected. */
    summaryEmails: z.array(z.string().trim().email().max(254)).max(MAX_SUMMARY_RECIPIENTS),
  })
  .partial()
  .strict();
export type ReviewConfigInput = z.infer<typeof reviewConfigSchema>;

export function normalizeConfig(value: unknown): ReviewConfig {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const parsed = reviewConfigSchema.safeParse({ ...raw, summaryEmails: undefined });
  return {
    ...DEFAULT_REVIEW_CONFIG,
    ...(parsed.success ? stripUndefined(parsed.data) : {}),
  } as ReviewConfig;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function getReviewConfig(): Promise<ReviewConfig> {
  const row = await prisma.systemConfig.findUnique({ where: { key: REVIEW_CONFIG_KEY } });
  return normalizeConfig(row?.value);
}

export async function isFreezeWarningEnabled(): Promise<boolean> {
  return (await getReviewConfig()).freezeWarningEnabled;
}

export async function isErrorBudgetAlertsEnabled(): Promise<boolean> {
  return (await getReviewConfig()).errorBudgetAlertsEnabled;
}

/** Merges a partial update, resolves summary recipients to existing users, audits old and new. */
export async function saveReviewConfig(
  input: ReviewConfigInput,
  actor: { id: string; source: 'UI' | 'API' },
  tx?: Prisma.TransactionClient
): Promise<ReviewConfig> {
  if (!tx) return prisma.$transaction(client => saveReviewConfig(input, actor, client));
  const { summaryEmails, ...rest } = reviewConfigSchema.parse(input);
  const current = normalizeConfig(
    (await tx.systemConfig.findUnique({ where: { key: REVIEW_CONFIG_KEY } }))?.value
  );
  const next: ReviewConfig = { ...current, ...stripUndefined(rest) } as ReviewConfig;
  if (summaryEmails || rest.summaryUserIds) {
    const emails = (summaryEmails ?? []).map(e => e.toLowerCase());
    const users = await tx.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ id: { in: rest.summaryUserIds ?? [] } }, { email: { in: emails } }],
      },
      select: { id: true, email: true },
    });
    const unknownIds = (rest.summaryUserIds ?? []).filter(id => !users.some(u => u.id === id));
    const unknownEmails = emails.filter(e => !users.some(u => u.email.toLowerCase() === e));
    if (unknownIds.length || unknownEmails.length) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: `Summary recipients must be existing active users: ${[...unknownIds, ...unknownEmails].join(', ')}`,
      });
    }
    next.summaryUserIds = users.slice(0, MAX_SUMMARY_RECIPIENTS).map(u => u.id);
  }
  await tx.systemConfig.upsert({
    where: { key: REVIEW_CONFIG_KEY },
    create: { key: REVIEW_CONFIG_KEY, value: next, updatedBy: actor.id },
    update: { value: next, updatedBy: actor.id },
  });
  await emitAuditEvent(
    {
      action: 'business_service_review.settings_updated',
      source: actor.source,
      actor: { type: 'USER', id: actor.id },
      target: { type: 'SYSTEM_CONFIG', id: REVIEW_CONFIG_KEY },
      oldValue: current,
      newValue: next,
    },
    tx
  );
  return next;
}
