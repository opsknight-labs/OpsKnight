import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { escapeHtml, sanitizeUrl } from '@/lib/email-components';
import { authenticationOrigin } from './origin';

export const AUTHENTICATION_ALERT_BATCH_SIZE = 100;

/** Mandatory audit + durable high-priority notification, in the caller's transaction. */
export async function securityEvent(
  tx: Prisma.TransactionClient,
  action: string,
  actorId: string,
  context: Prisma.InputJsonObject = {},
  outcome = 'success'
) {
  const event = await tx.emergencyAccessEvent.create({
    data: {
      emergencyAccountId: actorId || null,
      eventType: action,
      outcome,
      context,
    },
  });
  await logAudit(
    {
      action,
      entityType: 'SYSTEM_CONFIG',
      entityId: actorId || 'authentication',
      source: 'AUTH',
      details: { principalId: actorId || null, outcome, ...context },
    },
    tx
  );
  const anonymousFailure = context.aggregateAnonymousFailure === true;
  let failureCount = 0;
  if (anonymousFailure) {
    const windowMs = 5 * 60000;
    const bucket = Math.floor(Date.now() / windowMs);
    const window = await tx.authenticationFailureWindow.upsert({
      where: { id: `anonymous-emergency:${bucket}` },
      create: { id: `anonymous-emergency:${bucket}`, expiresAt: new Date((bucket + 2) * windowMs) },
      update: { count: { increment: 1 } },
    });
    failureCount = window.count;
    // One initial alert and one escalation per shared window, across all replicas/IPs.
    // Every individual event and audit above remains committed.
    if (failureCount !== 1 && failureCount !== 20) return event;
  }
  const admins = await tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE', createdAt: { lte: event.createdAt } },
    select: { id: true },
    take: AUTHENTICATION_ALERT_BATCH_SIZE + (anonymousFailure ? 0 : 1),
    orderBy: { id: 'asc' },
  });
  const title = anonymousFailure
    ? 'Emergency sign-in failures detected'
    : `Security alert: ${action}`;
  const message = anonymousFailure
    ? `${failureCount} unauthenticated emergency failures in the current five-minute window. Individual evidence remains in Diagnostics. Aggregated alerts reach up to 100 active administrators. Event ${event.id}.`
    : `Authentication event ${action} (${outcome}). Review System → SSO / Authentication → Diagnostics and Emergency Access. Event ${event.id}.`;
  const batch = admins.slice(0, AUTHENTICATION_ALERT_BATCH_SIZE);
  await materializeAlerts(tx, event.id, title, message, batch);
  if (admins.length > AUTHENTICATION_ALERT_BATCH_SIZE) {
    await tx.authenticationAlertFanout.create({
      data: {
        eventId: event.id,
        title,
        message,
        cursor: batch[batch.length - 1].id,
        createdAt: event.createdAt,
      },
    });
  }
  return event;
}

async function materializeAlerts(
  tx: Prisma.TransactionClient,
  eventId: string,
  title: string,
  message: string,
  admins: Array<{ id: string }>
) {
  if (!admins.length) return;
  await tx.inAppNotification.createMany({
    data: admins.map(admin => ({
      userId: admin.id,
      type: 'SECURITY' as const,
      title,
      message,
      entityType: 'AUTHENTICATION',
      entityId: eventId,
    })),
  });
  await tx.authenticationAlert.createMany({
    data: admins.map(admin => ({ eventId, recipientId: admin.id, title, message })),
  });
}

/** Bounded, restart-safe fan-out. Row locking lets replicas work without duplicate alerts. */
export async function processAuthenticationAlertFanout() {
  for (let batch = 0; batch < 5; batch++) {
    const processed = await prisma.$transaction(async tx => {
      const jobs = await tx.$queryRaw<
        Array<{ eventId: string; title: string; message: string; cursor: string; createdAt: Date }>
      >`SELECT * FROM "AuthenticationAlertFanout" ORDER BY "createdAt", "eventId"
        LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const job = jobs[0];
      if (!job) return false;
      const admins = await tx.user.findMany({
        where: {
          id: { gt: job.cursor },
          role: 'ADMIN',
          status: 'ACTIVE',
          createdAt: { lte: job.createdAt },
        },
        orderBy: { id: 'asc' },
        select: { id: true },
        take: AUTHENTICATION_ALERT_BATCH_SIZE,
      });
      await materializeAlerts(tx, job.eventId, job.title, job.message, admins);
      if (admins.length < AUTHENTICATION_ALERT_BATCH_SIZE)
        await tx.authenticationAlertFanout.delete({ where: { eventId: job.eventId } });
      else
        await tx.authenticationAlertFanout.update({
          where: { eventId: job.eventId },
          data: { cursor: admins[admins.length - 1].id },
        });
      return true;
    });
    if (!processed) break;
  }
}

/** Durable leased email delivery. In-app alerts already commit with the security event. */
export async function processAuthenticationAlerts() {
  await processAuthenticationAlertFanout();
  const pending = await prisma.authenticationAlert.findMany({
    where: {
      deliveredAt: null,
      nextAttemptAt: { lte: new Date() },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
  for (const alert of pending) {
    const leaseToken = randomUUID();
    const claim = await prisma.authenticationAlert.updateMany({
      where: {
        id: alert.id,
        deliveredAt: null,
        nextAttemptAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseToken, leaseUntil: new Date(Date.now() + 120000), attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    let delivered = false;
    try {
      const recipient = await prisma.user.findUnique({
        where: { id: alert.recipientId },
        select: { email: true, role: true, status: true },
      });
      if (!recipient || recipient.role !== 'ADMIN' || recipient.status !== 'ACTIVE') {
        await prisma.authenticationAlert.updateMany({
          where: { id: alert.id, leaseToken },
          data: {
            leaseToken: null,
            leaseUntil: null,
            nextAttemptAt: new Date(Date.now() + 3600000),
            lastError: 'Recipient is no longer an active administrator.',
          },
        });
        continue;
      }
      const { enqueueCentralNotification } = await import('@/lib/notification-control-plane');
      const reviewUrl = sanitizeUrl(`${await authenticationOrigin()}/settings/system?section=sso`);
      if (!reviewUrl) throw new Error('Canonical security review URL unavailable.');
      const result = await enqueueCentralNotification(
        {
          category: 'SECURITY',
          channel: 'EMAIL',
          recipientType: 'EMAIL',
          recipientId: alert.recipientId,
          recipientAddress: recipient.email,
          userId: alert.recipientId,
          templateKey: 'authentication-security-alert',
          sourceType: 'AUTHENTICATION',
          sourceId: alert.eventId,
          eventKey: alert.id,
          displayMessage: alert.message,
          priority: 0,
          trafficClass: 'CRITICAL',
          payload: {
            kind: 'EMAIL',
            to: recipient.email,
            subject: alert.title,
            text: `${alert.message}\nReview authentication: ${reviewUrl}`,
            html: `<p>${escapeHtml(alert.message)}</p><p><a href="${escapeHtml(reviewUrl)}">Review authentication on your instance</a></p><p><a href="https://opsknight.com/">OpsKnight</a></p>`,
          },
        },
        { dispatchImmediately: false }
      );
      const notification = await prisma.notification.findUnique({
        where: { id: result.id },
        select: { status: true },
      });
      delivered = notification?.status === 'SENT' || notification?.status === 'DELIVERED';
    } catch {
      /* Preserve the durable intent and retry; never log provider secrets. */
    }
    await prisma.authenticationAlert.updateMany({
      where: { id: alert.id, leaseToken },
      data: {
        deliveredAt: delivered ? new Date() : null,
        leaseUntil: null,
        leaseToken: null,
        nextAttemptAt: new Date(
          Date.now() + Math.min(3600000, 15000 * 2 ** Math.min(alert.attempts, 8))
        ),
        lastError: delivered
          ? null
          : 'Email delivery pending or unavailable. In-app security alert is retained.',
      },
    });
  }
}
