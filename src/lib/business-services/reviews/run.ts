import 'server-only';

import prisma from '@/lib/prisma';
import { emitAuditEvent } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/env-validation';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveUserActor } from '@/lib/authorization-actors';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { getAllConfiguredEmailProviders } from '@/lib/notification-providers';
import { businessServiceReadWhere } from '../commands';
import { getReviewConfig } from './config';
import { collectServiceReviews } from './data';
import { buildDigest, claimKey, resolveRecipients, type ReviewService } from './digest';
import { isRunDue, reviewPeriod } from './period';
import { renderReview, toEmailProps } from './render';

const MAX_RECIPIENTS_PER_RUN = 500;
const PREVIEW_LIMIT = { count: 3, windowMs: 3_600_000 };

export type RunSummary = {
  period: string;
  sent: number;
  skipped: number;
  failed: number;
  alreadySent: number;
  disabled?: boolean;
  notDue?: boolean;
  noEmailProvider?: boolean;
};

/** A PENDING claim older than this belongs to a node that died before finish(). */
export const STALE_PENDING_MS = 30 * 60_000;

export async function claim(
  period: string,
  kind: string,
  recipientKey: string,
  now = new Date()
): Promise<boolean> {
  const created = await prisma.businessServiceReviewRun.createMany({
    data: [{ period, kind, recipientKey, status: 'PENDING' }],
    skipDuplicates: true,
  });
  if (created.count > 0) return true;
  // FAILED may be retried, and so may a PENDING abandoned by a crashed node. Compare-and-set on the
  // old updatedAt: the winner bumps it, so a second node's identical update matches nothing.
  // SENT and SKIPPED are never re-run.
  const stale = new Date(now.getTime() - STALE_PENDING_MS);
  const retried = await prisma.businessServiceReviewRun.updateMany({
    where: {
      period,
      kind,
      recipientKey,
      OR: [{ status: 'FAILED' }, { status: 'PENDING', updatedAt: { lt: stale } }],
    },
    data: { status: 'PENDING', error: null, updatedAt: now },
  });
  return retried.count > 0;
}

const finish = (
  period: string,
  kind: string,
  recipientKey: string,
  status: 'SENT' | 'SKIPPED' | 'FAILED',
  serviceCount: number,
  error?: string
) =>
  prisma.businessServiceReviewRun.update({
    where: { period_kind_recipientKey: { period, kind, recipientKey } },
    data: { status, serviceCount, error: error?.slice(0, 500) ?? null },
  });

/** Services the actor may see in a review: review read access plus business service scope. */
async function visibleServiceIds(userId: string, ids: readonly string[]): Promise<string[]> {
  const actor = await resolveUserActor(userId);
  if (!actor || !authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_REVIEW_READ }).allowed)
    return [];
  const rows = await prisma.businessService.findMany({
    where: { AND: [{ id: { in: [...ids] } }, businessServiceReadWhere(actor)] },
    select: { id: true },
  });
  return rows.map(r => r.id);
}

async function emailProviderReady() {
  return (await getAllConfiguredEmailProviders()).length > 0;
}

async function enqueue(input: {
  userId: string;
  to: string;
  eventKey: string;
  subject: string;
  html: string;
  text: string;
}) {
  await enqueueCentralNotification({
    category: 'SYSTEM',
    channel: 'EMAIL',
    recipientType: 'USER',
    recipientId: input.userId,
    recipientAddress: input.to,
    userId: input.userId,
    templateKey: 'business-service-review',
    sourceType: 'USER',
    sourceId: input.userId,
    eventKey: input.eventKey,
    displayMessage: 'Monthly service review',
    trafficClass: 'BULK',
    payload: {
      kind: 'EMAIL',
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    },
  });
}

/**
 * One monthly run: one DIGEST email per recipient (their services only) and one SUMMARY per
 * configured portfolio recipient. Every (period, kind, recipient) is claimed in
 * BusinessServiceReviewRun first, so a rerun or a second node never sends twice.
 */
export async function runServiceReviews(opts: {
  now?: Date;
  /** Admin "run now": skips the schedule check, never the idempotency claim. */
  manual?: boolean;
  actorId?: string;
}): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const config = await getReviewConfig();
  const period = reviewPeriod(now, config.timeZone);
  const summary: RunSummary = {
    period: period.key,
    sent: 0,
    skipped: 0,
    failed: 0,
    alreadySent: 0,
  };
  if (!config.enabled) return { ...summary, disabled: true };
  if (!opts.manual && !isRunDue(now, config)) return { ...summary, notDue: true };
  if (!(await emailProviderReady())) return { ...summary, noEmailProvider: true };

  const services = await prisma.businessService.findMany({
    where: { includeInReview: true, lifecycle: { not: 'RETIRED' } },
    select: { id: true, includeInReview: true, ownerUserId: true, ownerTeamId: true },
  });
  const teamIds = [...new Set(services.map(s => s.ownerTeamId).filter((x): x is string => !!x))];
  const optedIn = await prisma.teamMember.findMany({
    where: { teamId: { in: teamIds }, user: { receiveServiceReviews: true } },
    select: { teamId: true, userId: true },
  });
  const optedInTeamMembers = new Map<string, string[]>();
  for (const m of optedIn)
    optedInTeamMembers.set(m.teamId, [...(optedInTeamMembers.get(m.teamId) ?? []), m.userId]);
  const ownerIds = services.map(s => s.ownerUserId).filter((x): x is string => !!x);
  const candidateIds = [
    ...new Set([...ownerIds, ...optedIn.map(m => m.userId), ...config.summaryUserIds]),
  ];
  const users = await prisma.user.findMany({
    where: { id: { in: candidateIds }, status: 'ACTIVE' },
    select: { id: true, name: true, email: true },
  });
  const byId = new Map(users.map(u => [u.id, u]));
  const recipients = resolveRecipients({
    services,
    optedInTeamMembers,
    eligibleUserIds: new Set(users.filter(u => u.email).map(u => u.id)),
  });

  const data = await collectServiceReviews(
    services.map(s => s.id),
    period,
    config.timeZone
  );
  const base = getBaseUrl();
  const ctx = {
    periodLabel: period.label,
    reviewUrl: `${base}/services/business`,
    manageUrl: `${base}/settings/profile`,
  };

  const deliver = async (kind: 'DIGEST' | 'SUMMARY', userId: string, serviceIds: string[]) => {
    const user = byId.get(userId);
    if (!user?.email) return;
    const key = userId;
    if (!(await claim(period.key, kind, key))) {
      summary.alreadySent++;
      return;
    }
    try {
      const visible = new Set(await visibleServiceIds(userId, serviceIds));
      const rows = [...visible].map(id => data.get(id)).filter((r): r is ReviewService => !!r);
      const digest = buildDigest(rows);
      if (!digest) {
        await finish(period.key, kind, key, 'SKIPPED', 0);
        summary.skipped++;
        return;
      }
      const email = await renderReview(
        toEmailProps(digest, {
          ...ctx,
          recipientName: user.name || 'there',
          kind: kind === 'SUMMARY' ? 'summary' : 'digest',
        })
      );
      await enqueue({
        userId,
        to: user.email,
        eventKey: claimKey(period.key, kind, userId),
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      await finish(period.key, kind, key, 'SENT', digest.totals.services);
      summary.sent++;
    } catch (error) {
      summary.failed++;
      await finish(
        period.key,
        kind,
        key,
        'FAILED',
        0,
        error instanceof Error ? error.message : 'error'
      ).catch(() => undefined);
      logger.warn('[ServiceReview] delivery failed', { userId, kind, error });
    }
  };

  const allIds = services.map(s => s.id);
  for (const [userId, ids] of [...recipients].slice(0, MAX_RECIPIENTS_PER_RUN))
    await deliver('DIGEST', userId, ids);
  for (const userId of config.summaryUserIds) await deliver('SUMMARY', userId, allIds);

  await emitAuditEvent({
    action: 'business_service_review.run',
    source: opts.actorId ? 'API' : 'BACKGROUND',
    actor: opts.actorId ? { type: 'USER', id: opts.actorId } : { type: 'SYSTEM' },
    target: { type: 'SYSTEM_CONFIG', id: 'business_service_reviews' },
    metadata: { ...summary, manual: !!opts.manual },
  });
  return summary;
}

/** Cron entry: bounded no-op unless an admin enabled reviews and the schedule is due. */
export const runScheduledServiceReviews = (now = new Date()) => runServiceReviews({ now });

/** "Send preview to me": the requester's own digest, rate limited, never claims the monthly run. */
export async function sendReviewPreview(userId: string, now = new Date()) {
  const config = await getReviewConfig();
  if (!config.enabled)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Service reviews are not enabled.',
    });
  const limit = await checkRateLimit(
    `service-review-preview:${userId}`,
    PREVIEW_LIMIT.count,
    PREVIEW_LIMIT.windowMs
  );
  if (!limit.allowed) throw new AppError({ code: 'RATE_LIMIT_EXCEEDED' });
  if (!(await emailProviderReady()))
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'No email provider is configured.',
    });
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  if (!user?.email) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const actor = await resolveUserActor(userId);
  if (!actor || !authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_REVIEW_READ }).allowed)
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  const period = reviewPeriod(now, config.timeZone);
  // The preview shows what the actor would see: every opted-in service they can read.
  const readable = await prisma.businessService.findMany({
    where: { AND: [{ includeInReview: true }, businessServiceReadWhere(actor)] },
    select: { id: true },
    take: 1000,
  });
  const data = await collectServiceReviews(
    readable.map(r => r.id),
    period,
    config.timeZone
  );
  const digest = buildDigest([...data.values()]);
  if (!digest)
    return { sent: false as const, reason: 'nothing_to_report' as const, period: period.key };
  const base = getBaseUrl();
  const email = await renderReview(
    toEmailProps(digest, {
      recipientName: user.name || 'there',
      periodLabel: period.label,
      kind: 'digest',
      reviewUrl: `${base}/services/business`,
      manageUrl: `${base}/settings/profile`,
      preview: true,
    })
  );
  await enqueue({
    userId,
    to: user.email,
    eventKey: `service-review-preview:${userId}:${now.getTime()}`,
    subject: `[Preview] ${email.subject}`,
    html: email.html,
    text: email.text,
  });
  await emitAuditEvent({
    action: 'business_service_review.preview_sent',
    source: 'API',
    actor: { type: 'USER', id: userId },
    target: { type: 'SYSTEM_CONFIG', id: 'business_service_reviews' },
    metadata: { period: period.key, services: digest.totals.services },
  });
  return { sent: true as const, period: period.key, services: digest.totals.services };
}

/** Recent runs. Admins see all; others only rows for themselves. Recipient keys are user ids. */
export async function listReviewRuns(actor: { id: string; global: boolean }, take = 50) {
  return prisma.businessServiceReviewRun.findMany({
    where: actor.global ? {} : { recipientKey: actor.id },
    orderBy: { createdAt: 'desc' },
    take: Math.min(take, 200),
    select: {
      period: true,
      kind: true,
      recipientKey: true,
      status: true,
      serviceCount: true,
      error: true,
      createdAt: true,
    },
  });
}
