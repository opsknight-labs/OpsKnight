import type { Prisma, ComplianceDriftEvent } from '@prisma/client';
import { getComplianceMonitoringConfig } from '../monitoring/config';
import { emitAuditEvent } from '../../audit';
import { createInAppNotifications } from '../../in-app-notifications';
import { encrypt } from '../../encryption';

const ACTIONABLE_KINDS = new Set([
  'CONTROL_STATUS_REGRESSION',
  'CONTROL_UNVERIFIED',
  'EVIDENCE_INTEGRITY_MISMATCH',
]);

/**
 * Handles durable notification dispatch and deduplication for a compliance drift event.
 * Enforces anti-alert-storm rules, per-event generation deduplication, and flapping cooldowns.
 */
export async function dispatchComplianceDriftNotification(
  tx: Prisma.TransactionClient,
  params: {
    driftEvent: ComplianceDriftEvent;
    generation: number;
    now?: Date;
  }
): Promise<{ dispatched: boolean; reason?: string }> {
  const now = params.now ?? new Date();
  const config = getComplianceMonitoringConfig();

  // 1. Check if notifications are enabled globally
  if (!config.notificationsEnabled) {
    await emitAuditEvent({
      action: 'COMPLIANCE_DRIFT_NOTIFICATION_SUPPRESSED',
      source: 'BACKGROUND',
      target: { type: 'COMPLIANCE_DRIFT_EVENT', id: params.driftEvent.id },
      actor: { type: 'SYSTEM' },
      occurredAt: now,
      metadata: {
        driftEventId: params.driftEvent.id,
        reason: 'NOTIFICATIONS_DISABLED',
      },
    });
    return { dispatched: false, reason: 'NOTIFICATIONS_DISABLED' };
  }

  // 2. Only actionable kinds trigger notifications
  if (!ACTIONABLE_KINDS.has(params.driftEvent.kind)) {
    return { dispatched: false, reason: 'INFORMATIONAL_EVENT' };
  }

  // 3. Flapping cooldown protection: check if a previous episode for this control was resolved recently
  if (params.driftEvent.controlId) {
    const cooldownCutoff = new Date(now.getTime() - config.renotifyCooldownMinutes * 60 * 1000);

    const recentlyResolved = await tx.complianceDriftEvent.findFirst({
      where: {
        controlId: params.driftEvent.controlId,
        kind: params.driftEvent.kind,
        id: { not: params.driftEvent.id },
        resolvedAt: { gte: cooldownCutoff },
      },
    });

    if (recentlyResolved) {
      await emitAuditEvent({
        action: 'COMPLIANCE_DRIFT_NOTIFICATION_SUPPRESSED',
        source: 'BACKGROUND',
        target: { type: 'COMPLIANCE_DRIFT_EVENT', id: params.driftEvent.id },
        actor: { type: 'SYSTEM' },
        occurredAt: now,
        metadata: {
          driftEventId: params.driftEvent.id,
          controlId: params.driftEvent.controlId,
          reason: 'FLAPPING_COOLDOWN',
          cooldownMinutes: config.renotifyCooldownMinutes,
        },
      });
      return { dispatched: false, reason: 'FLAPPING_COOLDOWN' };
    }
  }

  // 4. Retrieve recipients: active workspace administrators (operational compliance managers)
  const recipients = await tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  });

  if (recipients.length === 0) {
    return { dispatched: false, reason: 'NO_RECIPIENTS' };
  }

  const recipientUserIds = recipients.map(u => u.id);
  const dedupeKey = `compliance-drift:${params.driftEvent.id}:${params.generation}`;

  // 5. Create in-app notifications
  await createInAppNotifications(
    {
      userIds: recipientUserIds,
      type: 'SERVICE',
      title: `Compliance Drift: ${params.driftEvent.controlId ?? 'Runtime Control'}`,
      message: params.driftEvent.summary,
      entityType: 'COMPLIANCE_CONTROL',
      entityId: params.driftEvent.controlId,
      dedupeKey,
    },
    tx as never
  );

  const serializedPayload = JSON.stringify({
    summary: params.driftEvent.summary,
    controlId: params.driftEvent.controlId,
    kind: params.driftEvent.kind,
    generation: params.generation,
  });
  let payloadEncrypted: string | null = null;
  try {
    payloadEncrypted = await encrypt(serializedPayload);
  } catch {
    payloadEncrypted = Buffer.from(serializedPayload).toString('base64');
  }

  // 6. Create durable notification intents with unique deliveryKey
  for (const userId of recipientUserIds) {
    const deliveryKey = `${dedupeKey}:email:${userId}`;
    await tx.notification.createMany({
      data: [
        {
          userId,
          channel: 'EMAIL',
          status: 'PENDING',
          category: 'SECURITY',
          message: params.driftEvent.summary,
          eventType: 'COMPLIANCE_DRIFT',
          sourceType: 'COMPLIANCE_DRIFT_EVENT',
          sourceId: params.driftEvent.id,
          deliveryKey,
          payloadEncrypted,
        },
      ],
      skipDuplicates: true,
    });
  }

  // 7. Update event's lastNotifiedAt
  await tx.complianceDriftEvent.update({
    where: { id: params.driftEvent.id },
    data: { lastNotifiedAt: now },
  });

  await emitAuditEvent({
    action: 'COMPLIANCE_DRIFT_NOTIFICATION_QUEUED',
    source: 'BACKGROUND',
    target: { type: 'COMPLIANCE_DRIFT_EVENT', id: params.driftEvent.id },
    actor: { type: 'SYSTEM' },
    occurredAt: now,
    metadata: {
      driftEventId: params.driftEvent.id,
      controlId: params.driftEvent.controlId,
      generation: params.generation,
      recipientCount: recipientUserIds.length,
    },
  });

  return { dispatched: true };
}
