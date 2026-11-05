import 'server-only';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getAppUrl } from '@/lib/app-url';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { resolveUserActor } from '@/lib/authorization-actors';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getInsights } from '../insights/service';
import { enqueueWorkItems, WORK_KINDS } from '../jobs/work-queue';
import { parseOrThrow, type IntelligenceActor } from '../settings/service';
import {
  DIGEST_SETTINGS_DEFAULTS,
  digestScheduledFor,
  digestSettingsInputSchema,
  isDigestDue,
  isoWeekKey,
} from './contract';
import { renderDigestEmail } from './render';

/** Recipients emailed per work item; the rest continue in the next item so no job runs long. */
export const DIGEST_CHUNK_SIZE = 10;
/** Upper bound on recipients, so a misconfigured role can never mass-mail the workspace. */
export const MAX_DIGEST_RECIPIENTS = 100;
export const DIGEST_CHECK_INTERVAL_MS = 5 * 60_000;
const INSIGHTS_PATH = '/settings/intelligence/insights';

export interface DigestSettingsView {
  enabled: boolean;
  dayOfWeek: number;
  hourUtc: number;
  revision: number;
}

export interface DigestRunView {
  weekKey: string;
  status: string;
  recipients: number;
  sent: number;
  failed: number;
  startedAt: Date;
  completedAt: Date | null;
}

export async function getDigestSettings(): Promise<DigestSettingsView> {
  const row = await prisma.intelligenceDigestSettings.findUnique({
    where: { id: 'default' },
    select: { enabled: true, dayOfWeek: true, hourUtc: true, revision: true },
  });
  return row ?? { ...DIGEST_SETTINGS_DEFAULTS, revision: 0 };
}

/** Caller must authorize INTELLIGENCE_MANAGE. Revision-locked and audited. */
export async function updateDigestSettings(input: unknown, actor: IntelligenceActor): Promise<DigestSettingsView> {
  const { expectedRevision, ...values } = parseOrThrow(digestSettingsInputSchema, input);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('intelligence-digest-settings', 0))`;
    const previous = await tx.intelligenceDigestSettings.findUnique({ where: { id: 'default' } });
    if ((previous?.revision ?? 0) !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const select = { enabled: true, dayOfWeek: true, hourUtc: true, revision: true } as const;
    const next = await tx.intelligenceDigestSettings.upsert({
      where: { id: 'default' },
      create: { ...values, revision: 1, updatedBy: actor.actorId },
      update: { ...values, revision: { increment: 1 }, updatedBy: actor.actorId },
      select,
    });
    await logAudit(
      {
        action: 'intelligence.digest.settings.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'intelligence-digest',
        actorId: actor.actorId,
        source: actor.source,
        details: actor.source === 'API' ? { apiClientId: actor.apiClientId } : undefined,
        oldValue: previous ? { enabled: previous.enabled, dayOfWeek: previous.dayOfWeek, hourUtc: previous.hourUtc } : null,
        newValue: { enabled: next.enabled, dayOfWeek: next.dayOfWeek, hourUtc: next.hourUtc },
      },
      tx
    );
    return next;
  });
}

export async function getLatestDigestRun(): Promise<DigestRunView | null> {
  const run = await prisma.intelligenceDigestRun.findFirst({ orderBy: { startedAt: 'desc' } });
  return run
    ? {
        weekKey: run.weekKey,
        status: run.status,
        recipients: run.recipients,
        sent: run.sentTo.length,
        failed: run.failedTo.length,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      }
    : null;
}

/** Active people whose role can manage intelligence, oldest first, capped. */
export async function digestRecipients(): Promise<Array<{ id: string; email: string }>> {
  const roles = (['ADMIN', 'RESPONDER', 'USER', 'AUDITOR'] as const).filter(role =>
    hasCapability(role, CAPABILITIES.INTELLIGENCE_MANAGE)
  );
  return prisma.user.findMany({
    where: { status: 'ACTIVE', role: { in: [...roles] } },
    orderBy: { id: 'asc' },
    take: MAX_DIGEST_RECIPIENTS,
    select: { id: true, email: true },
  });
}

/** A digest is only worth reading the day it is sent; an outage never delivers last week's mail. */
const DIGEST_TTL_MS = 24 * 3_600_000;

/**
 * Builds one person's digest from what that person may read right now and hands it to the durable
 * notification control plane, which owns retries, provider failover and delivery history. The
 * control plane de-duplicates on (recipient, source, event), so `eventKey` makes each person's weekly
 * digest exactly-once. BULK traffic is served after everything paging-related. Returns false when the
 * person is no longer entitled to it or it could not be queued.
 */
async function sendDigestTo(
  recipient: { id: string; email: string },
  weekKey: string,
  now: Date,
  appUrl: string,
  eventKey: string
): Promise<boolean> {
  const actor = await resolveUserActor(recipient.id);
  if (!actor || !hasCapability(actor.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE)) return false;
  const insights = await getInsights(actor, now);
  if (!insights?.weekly) return false;
  const email = renderDigestEmail({
    weekKey,
    weekly: insights.weekly,
    recurring: insights.recurring,
    anomalies: insights.anomalies,
    insightsUrl: `${appUrl}${INSIGHTS_PATH}`,
    settingsUrl: `${appUrl}${INSIGHTS_PATH}#digest`,
  });
  const result = await enqueueCentralNotification({
    category: 'SYSTEM',
    channel: 'EMAIL',
    recipientType: 'USER',
    recipientId: recipient.id,
    recipientAddress: recipient.email,
    userId: recipient.id,
    templateKey: 'intelligence-weekly-digest',
    sourceType: 'INTELLIGENCE_DIGEST',
    sourceId: recipient.id,
    eventKey,
    displayMessage: email.subject,
    trafficClass: 'BULK',
    expiresAt: new Date(Date.now() + DIGEST_TTL_MS),
    payload: { kind: 'EMAIL', to: recipient.email, subject: email.subject, html: email.html, text: email.text },
  });
  return !result.skipped;
}

export type DigestPassOutcome = 'skipped' | 'more' | 'done';

/**
 * Queues the next chunk of this week's digest. The run row is claimed with insert-if-absent and each
 * recipient is recorded as soon as they are handled, so a crash resumes where it stopped; if it stops
 * between queueing and recording, the control plane's per-recipient de-duplication still holds.
 */
export async function sendDigestPass(weekKey: string, now: Date = new Date(), signal?: AbortSignal): Promise<DigestPassOutcome> {
  const settings = await getDigestSettings();
  // A queued item from an earlier week, or one left over after the digest was turned off, does nothing.
  if (!isDigestDue(now, settings) || weekKey !== isoWeekKey(now)) return 'skipped';

  await prisma.intelligenceDigestRun.createMany({
    data: [{ weekKey, scheduledFor: digestScheduledFor(now, settings) }],
    skipDuplicates: true,
  });
  const run = await prisma.intelligenceDigestRun.findUniqueOrThrow({ where: { weekKey } });
  if (run.status === 'COMPLETED') return 'done';

  const recipients = await digestRecipients();
  const handled = new Set([...run.sentTo, ...run.failedTo]);
  const pending = recipients.filter(recipient => !handled.has(recipient.id));
  const appUrl = await getAppUrl();
  let processed = 0;
  for (const recipient of pending.slice(0, DIGEST_CHUNK_SIZE)) {
    if (signal?.aborted) break;
    const sent = await sendDigestTo(recipient, weekKey, now, appUrl, `weekly:${weekKey}`).catch(error => {
      logger.warn('[Intelligence] Weekly digest could not be queued', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    });
    await prisma.intelligenceDigestRun.update({
      where: { weekKey },
      data: sent ? { sentTo: { push: recipient.id } } : { failedTo: { push: recipient.id } },
    });
    processed += 1;
  }

  if (processed < pending.length) return 'more';
  const final = await prisma.intelligenceDigestRun.update({
    where: { weekKey },
    data: { status: 'COMPLETED', completedAt: new Date(), recipients: recipients.length },
  });
  logger.info('[Intelligence] Weekly digest sent', {
    weekKey,
    sent: final.sentTo.length,
    failed: final.failedTo.length,
  });
  return 'done';
}

/** Called by the lane: queues this week's digest once it is due and not yet finished. */
export async function scheduleDigestIfDue(now: Date = new Date()): Promise<boolean> {
  const settings = await getDigestSettings();
  if (!isDigestDue(now, settings)) return false;
  const weekKey = isoWeekKey(now);
  const run = await prisma.intelligenceDigestRun.findUnique({ where: { weekKey }, select: { status: true } });
  if (run?.status === 'COMPLETED') return false;
  await enqueueWorkItems([{ kind: WORK_KINDS.SEND_DIGEST, subjectKey: weekKey }]);
  return true;
}

/** Sends the current digest to one person now, outside the schedule, so an admin can check it. */
export async function sendTestDigest(userId: string, now: Date = new Date()): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true } });
  if (!user || user.status !== 'ACTIVE') return false;
  return sendDigestTo(user, isoWeekKey(now), now, await getAppUrl(), `test:${randomUUID()}`);
}
