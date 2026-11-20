import 'server-only';

import { randomBytes } from 'node:crypto';
import { resolveUserActor } from '@/lib/authorization-actors';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { getBaseUrl } from '@/lib/env-validation';
import { logger } from '@/lib/logger';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { getAllConfiguredEmailProviders } from '@/lib/notification-providers';
import prisma from '@/lib/prisma';
import { analyticsReportWeekStart, composeWeeklyEmail } from './weekly-report';

/**
 * The default weekly analytics summary (PagerDuty-style): every active user with
 * analytics access gets last week's numbers for everything they can see, with no
 * subscription needed. Admins can switch it off for the workspace; each user can
 * opt out in their profile or with their mail app's one-click Unsubscribe.
 */

export const DIGEST_CONFIG_KEY = 'analytics_weekly_digest';
const TOKEN_BYTES = 24;

const newToken = () => randomBytes(TOKEN_BYTES).toString('base64url');

/** Sending needs at least one enabled, configured email provider (Resend, SendGrid, SES, SMTP). */
export async function hasConfiguredEmailProvider(): Promise<boolean> {
  return (await getAllConfiguredEmailProviders()).length > 0;
}

/** Workspace switch; on unless an admin turned it off. */
export async function isWeeklyDigestEnabled(): Promise<boolean> {
  const row = await prisma.systemConfig.findUnique({ where: { key: DIGEST_CONFIG_KEY } });
  const value = row?.value as { enabled?: unknown } | null | undefined;
  return value?.enabled !== false;
}

export async function setWeeklyDigestEnabled(enabled: boolean, updatedBy: string) {
  await prisma.systemConfig.upsert({
    where: { key: DIGEST_CONFIG_KEY },
    create: { key: DIGEST_CONFIG_KEY, value: { enabled }, updatedBy },
    update: { value: { enabled }, updatedBy },
  });
}

/** True when this user will get the summary (ignores the workspace switch). */
export async function isWeeklyDigestOptedIn(userId: string): Promise<boolean> {
  const row = await prisma.analyticsDigestSubscription.findUnique({
    where: { userId },
    select: { optedOut: true },
  });
  return !row?.optedOut;
}

export async function setWeeklyDigestOptOut(userId: string, optedOut: boolean) {
  await prisma.analyticsDigestSubscription.upsert({
    where: { userId },
    create: { userId, optedOut, token: newToken() },
    update: { optedOut },
  });
}

/** RFC 8058 one-click target. Unknown tokens are ignored so the endpoint can't be probed. */
export async function unsubscribeWeeklyDigestByToken(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const result = await prisma.analyticsDigestSubscription.updateMany({
    where: { token },
    data: { optedOut: true },
  });
  return result.count > 0;
}

/**
 * Sends the summary to each eligible user at most once per week (Monday 00:00 UTC onward),
 * a bounded batch per cron tick. A user is skipped for the week, without email, when they
 * are inactive, have no address, lack analytics access, or had nothing to report.
 * The notification event key is per user and week, so a retry never double-sends.
 */
export async function sendWeeklyDigests(now = new Date(), limit = 25) {
  const result = { sent: 0, skipped: 0, failed: 0, disabled: false, noEmailProvider: false };
  if (!(await isWeeklyDigestEnabled())) return { ...result, disabled: true };
  // Nothing is marked as sent, so users get the summary once an admin configures email.
  if (!(await hasConfiguredEmailProvider())) return { ...result, noEmailProvider: true };

  const weekStart = analyticsReportWeekStart(now);
  const weekKey = weekStart.toISOString().slice(0, 10);
  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { analyticsDigest: null },
        {
          analyticsDigest: {
            optedOut: false,
            OR: [{ lastSentAt: null }, { lastSentAt: { lt: weekStart } }],
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      timeZone: true,
      analyticsDigest: { select: { token: true } },
    },
    orderBy: { id: 'asc' },
    take: limit,
  });

  for (const user of users) {
    // Create the row on first contact (it carries the unsubscribe token) and mark the week done.
    const markDone = () =>
      prisma.analyticsDigestSubscription.upsert({
        where: { userId: user.id },
        create: { userId: user.id, token: newToken(), lastSentAt: now },
        update: { lastSentAt: now },
        select: { token: true },
      });
    try {
      const actor = user.email ? await resolveUserActor(user.id) : null;
      if (!actor || !authorize({ actor, action: AUTHORIZATION_ACTIONS.REPORT_READ }).allowed) {
        await markDone();
        result.skipped++;
        continue;
      }
      const token =
        user.analyticsDigest?.token ??
        (
          await prisma.analyticsDigestSubscription.upsert({
            where: { userId: user.id },
            create: { userId: user.id, token: newToken() },
            update: {},
            select: { token: true },
          })
        ).token;

      const base = getBaseUrl();
      const email = await composeWeeklyEmail({
        actor,
        userName: user.name || 'there',
        timeZone: user.timeZone,
        query: '',
        name: 'All services you can see',
        now,
        kind: 'digest',
        manageUrl: `${base}/settings/profile`,
      });
      if (email.empty) {
        // Nothing happened and nothing is open: don't send an empty report.
        await markDone();
        result.skipped++;
        continue;
      }

      await enqueueCentralNotification({
        category: 'SYSTEM',
        channel: 'EMAIL',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: user.email!,
        userId: user.id,
        templateKey: 'analytics-weekly-digest',
        sourceType: 'USER',
        sourceId: user.id,
        eventKey: `digest:${user.id}:${weekKey}`,
        displayMessage: 'Weekly analytics summary',
        trafficClass: 'BULK',
        payload: {
          kind: 'EMAIL',
          to: user.email!,
          subject: `Your weekly summary · ${email.incidents} incidents last week`,
          html: email.html,
          text: email.text,
          listUnsubscribeUrl: `${base}/api/insights/digest/unsubscribe/${token}`,
        },
      });
      await markDone();
      result.sent++;
    } catch (error) {
      // shortcut: left unmarked and retried next tick, like the saved-view report.
      result.failed++;
      logger.warn('[Analytics] Weekly digest failed', { userId: user.id, error });
    }
  }
  return result;
}
