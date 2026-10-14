import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { escapeHtml, sanitizeUrl } from '@/lib/email-components';
import { lockControlActor, type ControlActor } from './actor';
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

/** A single atomic batch; a lost worker connection rolls back alerts and cursor together. */
export async function processAuthenticationAlertFanoutBatch(tx: Prisma.TransactionClient) {
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
}

/** Bounded, restart-safe fan-out. Row locking lets replicas work without duplicate alerts. */
export async function processAuthenticationAlertFanout() {
  for (let batch = 0; batch < 5; batch++) {
    if (!(await prisma.$transaction(processAuthenticationAlertFanoutBatch))) break;
  }
}

/** Durable leased email delivery. In-app alerts already commit with the security event. */
export async function processAuthenticationAlerts() {
  await processAuthenticationAlertFanout();
  const pending = await prisma.authenticationAlert.findMany({
    where: {
      acceptedAt: null,
      deliveredAt: null,
      cancelledAt: null,
      failedAt: null,
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
        acceptedAt: null,
        deliveredAt: null,
        cancelledAt: null,
        failedAt: null,
        nextAttemptAt: { lte: new Date() },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
      },
      data: { leaseToken, leaseUntil: new Date(Date.now() + 120000), attempts: { increment: 1 } },
    });
    if (claim.count !== 1) continue;
    let delivered = false;
    let accepted = false;
    let notificationId: string | null = null;
    let acceptedAt: Date | null = null;
    let deliveredAt: Date | null = null;
    let failed = false;
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
            cancelledAt: new Date(),
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
          eventKey:
            alert.deliveryGeneration === 0
              ? alert.id
              : `${alert.id}:retry:${alert.deliveryGeneration}`,
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
      notificationId = result.id;
    } catch {
      /* Preserve the durable intent and retry; never log provider secrets. */
    }
    await prisma.$transaction(async tx => {
      // Serialize receipt updates with linking the current delivery generation.
      // A receipt before linking is reread; one after linking finds the durable reference.
      if (notificationId) {
        await tx.$queryRaw`SELECT "id" FROM "Notification" WHERE "id" = ${notificationId} FOR UPDATE`;
        const notification = await tx.notification.findUnique({
          where: { id: notificationId },
          select: {
            status: true,
            sentAt: true,
            deliveredAt: true,
            attempts: true,
            maxAttempts: true,
            payloadEncrypted: true,
            expiresAt: true,
          },
        });
        delivered = notification?.status === 'DELIVERED';
        accepted = delivered || notification?.status === 'SENT';
        acceptedAt = accepted ? (notification?.sentAt ?? new Date()) : null;
        deliveredAt = delivered ? (notification?.deliveredAt ?? new Date()) : null;
        failed =
          !notification ||
          notification.status === 'SKIPPED' ||
          (notification.status === 'FAILED' &&
            (notification.attempts >= notification.maxAttempts ||
              !notification.payloadEncrypted ||
              Boolean(notification.expiresAt && notification.expiresAt.getTime() <= Date.now())));
      }
      await tx.authenticationAlert.updateMany({
        where: { id: alert.id, leaseToken },
        data: {
          notificationId,
          acceptedAt,
          deliveredAt,
          failedAt: failed ? new Date() : null,
          leaseUntil: null,
          leaseToken: null,
          nextAttemptAt: new Date(
            Date.now() + Math.min(3600000, 15000 * 2 ** Math.min(alert.attempts, 8))
          ),
          lastError: accepted
            ? null
            : failed
              ? 'Email delivery stopped. Review the provider and retry explicitly; delivery may be uncertain.'
              : 'Email delivery pending or unavailable. In-app security alert is retained.',
        },
      });
    });
  }
}

/** Explicit, fenced retry creates a new delivery key; expired payloads are rebuilt from the intent. */
export async function retryAuthenticationAlert(
  actor: ControlActor,
  alertId: string,
  expectedGeneration: number
) {
  await prisma.$transaction(async tx => {
    await lockControlActor(tx, actor);
    await tx.$queryRaw`SELECT "id" FROM "AuthenticationAlert" WHERE "id" = ${alertId} FOR UPDATE`;
    const alert = await tx.authenticationAlert.findUniqueOrThrow({ where: { id: alertId } });
    if (
      !alert.failedAt ||
      alert.deliveredAt ||
      alert.cancelledAt ||
      alert.deliveryGeneration !== expectedGeneration
    )
      throw new Error('Delivery state changed. Refresh diagnostics.');
    const recipient = await tx.user.findUnique({
      where: { id: alert.recipientId },
      select: { role: true, status: true },
    });
    if (recipient?.role !== 'ADMIN' || recipient.status !== 'ACTIVE')
      throw new Error('Recipient is no longer an active administrator.');
    await tx.authenticationAlert.update({
      where: { id: alert.id },
      data: {
        acceptedAt: null,
        notificationId: null,
        failedAt: null,
        deliveryGeneration: { increment: 1 },
        attempts: 0,
        nextAttemptAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
        lastError: null,
      },
    });
    await securityEvent(tx, 'auth.alert.delivery.retry', actor.id, {
      alertId,
      eventId: alert.eventId,
      generation: expectedGeneration + 1,
    });
  });
}
