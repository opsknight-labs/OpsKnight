import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { escapeHtml } from '@/lib/email-components';

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
  const admins = await tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });
  const title = `Security alert: ${action}`;
  const message = `Authentication event ${action} (${outcome}). Review System → SSO / Authentication → Diagnostics and Emergency Access. Event ${event.id}.`;
  if (admins.length) {
    await tx.inAppNotification.createMany({
      data: admins.map(admin => ({
        userId: admin.id,
        type: 'SECURITY' as const,
        title,
        message,
        entityType: 'AUTHENTICATION',
        entityId: event.id,
      })),
    });
    await tx.authenticationAlert.createMany({
      data: admins.map(admin => ({ eventId: event.id, recipientId: admin.id, title, message })),
    });
  }
  return event;
}

/** Durable leased email delivery. In-app alerts already commit with the security event. */
export async function processAuthenticationAlerts() {
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
      const result = await enqueueCentralNotification({ category: 'SECURITY', channel: 'EMAIL', recipientType: 'EMAIL', recipientId: alert.recipientId, recipientAddress: recipient.email, userId: alert.recipientId,
        templateKey: 'authentication-security-alert', sourceType: 'AUTHENTICATION', sourceId: alert.eventId, eventKey: alert.id, displayMessage: alert.message, priority: 0, trafficClass: 'CRITICAL',
        payload: { kind: 'EMAIL', to: recipient.email, subject: alert.title, text: alert.message, html: `<p>${escapeHtml(alert.message)}</p><p><a href="https://opsknight.com/">OpsKnight</a></p>` }
      }, { dispatchImmediately: false });
      const notification = await prisma.notification.findUnique({ where: { id: result.id }, select: { status: true } });
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
