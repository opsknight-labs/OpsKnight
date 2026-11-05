import type { Prisma, ComplianceDriftEvent } from '@prisma/client';
import { getComplianceMonitoringConfig } from '../monitoring/config';
import { emitAuditEvent } from '../../audit';
import { createInAppNotifications } from '../../in-app-notifications';
import { createCentralNotificationIntent } from '../../notification-control-plane';

export const MAX_NOTIFICATIONS_PER_EPISODE = 5;

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
    await emitAuditEvent(
      {
        action: 'COMPLIANCE_DRIFT_NOTIFICATION_SUPPRESSED',
        source: 'BACKGROUND',
        target: { type: 'COMPLIANCE_DRIFT_EVENT', id: params.driftEvent.id },
        actor: { type: 'SYSTEM' },
        occurredAt: now,
        metadata: {
          driftEventId: params.driftEvent.id,
          reason: 'NOTIFICATIONS_DISABLED',
        },
      },
      tx
    );
    return { dispatched: false, reason: 'NOTIFICATIONS_DISABLED' };
  }

  // 2. Only actionable kinds trigger notifications
  if (!ACTIONABLE_KINDS.has(params.driftEvent.kind)) {
    return { dispatched: false, reason: 'INFORMATIONAL_EVENT' };
  }

  // 3. Enforce maximum notification generation per episode (anti-alert storm)
  if (params.generation > MAX_NOTIFICATIONS_PER_EPISODE) {
    await emitAuditEvent(
      {
        action: 'COMPLIANCE_DRIFT_NOTIFICATION_SUPPRESSED',
        source: 'BACKGROUND',
        target: { type: 'COMPLIANCE_DRIFT_EVENT', id: params.driftEvent.id },
        actor: { type: 'SYSTEM' },
        occurredAt: now,
        metadata: {
          driftEventId: params.driftEvent.id,
          controlId: params.driftEvent.controlId,
          generation: params.generation,
          reason: 'MAX_GENERATIONS_EXCEEDED',
        },
      },
      tx
    );
    return { dispatched: false, reason: 'MAX_GENERATIONS_EXCEEDED' };
  }

  // 4. Flapping cooldown protection: check if a previous episode for this control was resolved recently
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
      await emitAuditEvent(
        {
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
        },
        tx
      );
      return { dispatched: false, reason: 'FLAPPING_COOLDOWN' };
    }
  }

  // 5. Retrieve recipients: active workspace administrators (operational compliance managers)
  const recipients = await tx.user.findMany({
    where: { role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true, email: true },
  });

  if (recipients.length === 0) {
    return { dispatched: false, reason: 'NO_RECIPIENTS' };
  }

  const recipientUserIds = recipients.map(u => u.id);
  const dedupeKey = `compliance-drift:${params.driftEvent.id}:${params.generation}`;

  // 6. Create in-app notifications
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

  // 7. Route through OpsKnight central notification control plane with real EMAIL payload.
  //    Rendered once; every recipient gets the same content.
  const controlId = params.driftEvent.controlId ?? 'Unknown';
  const driftText = `Compliance drift observed for control ${controlId}.\n\nSummary: ${params.driftEvent.summary}\nKind: ${params.driftEvent.kind}\nImpact: ${params.driftEvent.impact}\nDetected At: ${params.driftEvent.firstDetectedAt.toISOString()}`;
  const { renderEmail } = await import('@/emails/render');
  const { ComplianceDriftEmail } = await import('@/emails/templates/compliance-drift');
  const { emailBaseUrl } = await import('@/emails/utils');
  const appBase = emailBaseUrl();
  const { html: driftHtml } = await renderEmail(
    ComplianceDriftEmail({
      controlId,
      summary: params.driftEvent.summary,
      kind: params.driftEvent.kind,
      impact: params.driftEvent.impact,
      detectedAt: params.driftEvent.firstDetectedAt.toISOString(),
      reviewUrl: appBase ? `${appBase}/settings/security-compliance` : undefined,
    }),
    { text: driftText }
  );

  for (const user of recipients) {
    await createCentralNotificationIntent(
      {
        userId: user.id,
        channel: 'EMAIL',
        category: 'SECURITY',
        recipientType: 'USER',
        recipientId: user.id,
        recipientAddress: user.email,
        templateKey: 'COMPLIANCE_DRIFT',
        sourceType: 'COMPLIANCE_DRIFT_EVENT',
        sourceId: params.driftEvent.id,
        eventKey: `${params.driftEvent.id}:${params.generation}`,
        displayMessage: params.driftEvent.summary,
        payload: {
          kind: 'EMAIL',
          to: user.email,
          subject: `[OpsKnight Compliance Drift] Control ${controlId}: ${params.driftEvent.summary}`,
          text: driftText,
          html: driftHtml,
        },
      },
      tx
    );
  }

  // 8. Update event's lastNotifiedAt
  await tx.complianceDriftEvent.update({
    where: { id: params.driftEvent.id },
    data: { lastNotifiedAt: now },
  });

  await emitAuditEvent(
    {
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
    },
    tx
  );

  return { dispatched: true };
}
