/**
 * Durable handoff from escalation to notification delivery.
 *
 * An escalation step is "executed" when every page it intended is durably
 * recorded — not when a provider accepted one. So this module splits into two
 * halves with a hard line between them:
 *
 *   plan()        reads only  — eligibility, channels, quiet hours, addresses
 *   materialize() writes only — the intent rows, inside the step's transaction
 *
 * Provider delivery happens after the step has committed, and cannot affect
 * whether it committed. If this process dies before dispatching, the intents
 * are already durable and the notification control plane's own retry sweeper
 * picks them up.
 */
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { logger } from '../logger';
import { createInAppNotifications } from '../in-app-notifications';
import { buildNotificationEnvelope, encodeNotificationEnvelope } from '../notification-payload';
import { notificationIntentId } from '../notification-identity';
import {
  dispatchNotificationAttempt,
  NOTIFICATION_CHANNELS,
  type NotificationDeliveryChannel,
} from '../notification-delivery';
import { filterChannelsForQuietHours } from '../quiet-hours';
import { getUserNotificationChannels } from '../user-notifications';

/** Channels the durable control plane can carry. SLACK/WEBHOOK are service-level. */
const PERSONAL_CHANNELS: readonly NotificationDeliveryChannel[] = [
  'EMAIL',
  'SMS',
  'PUSH',
  'WHATSAPP',
];

function personalControlPlaneEnabled(): boolean {
  return process.env.NOTIFICATION_CONTROL_PLANE_PERSONAL === 'true';
}

export interface EscalationPageIntent {
  notificationId: string;
  userId: string;
  channel: NotificationDeliveryChannel;
  recipientAddress: string;
  /** Pre-resolved provider, so materialization needs no provider config read. */
  providerKey?: string;
}

export interface EscalationNotificationPlan {
  incidentId: string;
  eventKey: string;
  /** The encoded envelope stored on the intent row. */
  durableMessage: string;
  /** Plain text for the in-app notification. */
  displayMessage: string;
  intents: EscalationPageIntent[];
  /** Recipients that will get an in-app notification regardless of channels. */
  inAppUserIds: string[];
  /** Recipients with no reachable channel, for observability. */
  unreachableUserIds: string[];
  /** True when intents must be written in the durable control-plane shape. */
  controlPlane: boolean;
}

export function emptyEscalationNotificationPlan(
  incidentId: string,
  eventKey: string
): EscalationNotificationPlan {
  return {
    incidentId,
    eventKey,
    durableMessage: '',
    displayMessage: '',
    intents: [],
    inAppUserIds: [],
    unreachableUserIds: [],
    controlPlane: personalControlPlaneEnabled(),
  };
}

function recipientAddressFor(
  channel: NotificationDeliveryChannel,
  recipient: { userId: string; email: string | null; phoneNumber: string | null }
): string | null {
  if (channel === 'EMAIL') return recipient.email;
  if (channel === 'SMS' || channel === 'WHATSAPP') return recipient.phoneNumber;
  if (channel === 'PUSH') return recipient.userId;
  return null;
}

/** The incident fields a page's durable envelope and policy checks need. */
export type EscalationNotificationIncident = {
  id: string;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
  priority?: string | null;
  createdAt: Date;
  serviceId?: string | null;
  service?: { id?: string; name?: string | null } | null;
  assignee?: { id?: string; name?: string | null; email?: string | null } | null;
  team?: { id?: string; name?: string | null } | null;
};

/**
 * Resolves everything a step's pages need, without writing anything.
 *
 * Channel selection preserves the existing notification policy: a step's
 * configured channels are intersected with what the recipient has enabled, and
 * quiet hours are applied by the notification domain, not by escalation.
 */
export async function planEscalationNotificationIntents(input: {
  /** Already loaded by the executor; this module does not re-read it. */
  incident: EscalationNotificationIncident;
  recipients: readonly string[];
  /** Step channel restriction, or undefined to use recipient preferences. */
  stepChannels?: readonly NotificationDeliveryChannel[];
  eventKey: string;
  displayMessage: string;
  generation: number;
  stepIndex: number;
}): Promise<EscalationNotificationPlan> {
  const incident = input.incident;
  const plan = emptyEscalationNotificationPlan(incident.id, input.eventKey);
  plan.displayMessage = input.displayMessage;
  if (input.recipients.length === 0) return plan;

  // The envelope is the durable message body. It is keyed on the incident's
  // creation instant, never on escalation scheduling fields, which move while a
  // step's channels are still being fanned out.
  plan.durableMessage = encodeNotificationEnvelope(
    buildNotificationEnvelope(
      { ...incident, updatedAt: incident.createdAt },
      'triggered',
      incident.createdAt,
      input.displayMessage
    )
  );

  const stepChannels = input.stepChannels?.filter(channel =>
    NOTIFICATION_CHANNELS.includes(channel)
  );

  for (const userId of input.recipients) {
    const [recipient, enabledChannels] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          status: true,
          email: true,
          phoneNumber: true,
          timeZone: true,
          quietHoursEnabled: true,
          quietHoursStartMinutes: true,
          quietHoursEndMinutes: true,
          quietHoursWeekendAllDay: true,
        },
      }),
      getUserNotificationChannels(userId),
    ]);

    // Only ACTIVE responders are paged, matching target resolution.
    if (!recipient || recipient.status !== 'ACTIVE') {
      plan.unreachableUserIds.push(userId);
      continue;
    }

    // Every paged responder gets the in-app record even if no external channel
    // survives, so the page is visible somewhere.
    plan.inAppUserIds.push(userId);

    let channels = enabledChannels as NotificationDeliveryChannel[];
    if (stepChannels && stepChannels.length > 0) {
      const restricted = channels.filter(channel => stepChannels.includes(channel));
      // Preserve the existing fallback for a legacy policy whose configured
      // channels are all unavailable for this recipient.
      channels = restricted.length > 0 ? restricted : channels;
    }

    const quietHours = filterChannelsForQuietHours(channels, incident.urgency, recipient);
    channels = quietHours.channels.filter(channel => PERSONAL_CHANNELS.includes(channel));

    if (channels.length === 0) {
      plan.unreachableUserIds.push(userId);
      continue;
    }

    for (const channel of channels) {
      const recipientAddress = recipientAddressFor(channel, {
        userId,
        email: recipient.email,
        phoneNumber: recipient.phoneNumber,
      });
      if (!recipientAddress) continue;

      plan.intents.push({
        notificationId: notificationIntentId({
          eventKey: input.eventKey,
          eventType: 'triggered',
          eventAt: incident.createdAt,
          userId,
          channel,
          triggerGeneration: input.generation,
        }),
        userId,
        channel,
        recipientAddress,
      });
    }
  }

  if (plan.controlPlane && plan.intents.length > 0) {
    const { pinNotificationProviderKeys } = await import('../notification-control-plane');
    const pinned = await pinNotificationProviderKeys(plan.intents.map(intent => intent.channel));
    for (const intent of plan.intents) {
      intent.providerKey = pinned.get(intent.channel);
    }
  }

  return plan;
}

/**
 * Persists a step's pages inside the caller's transaction.
 *
 * Throwing here aborts the escalation step's commit, which is the intended
 * contract: a step must not report itself executed while a responder it meant
 * to page exists nowhere durable.
 */
export async function materializeEscalationNotificationIntents(
  tx: Prisma.TransactionClient,
  plan: EscalationNotificationPlan
): Promise<{ created: number }> {
  if (plan.inAppUserIds.length > 0) {
    await createInAppNotifications(
      {
        userIds: plan.inAppUserIds,
        type: 'INCIDENT',
        title: 'Action Required',
        message: plan.displayMessage,
        entityType: 'INCIDENT',
        entityId: plan.incidentId,
        dedupeKey: plan.eventKey,
      },
      tx
    );
  }

  if (plan.intents.length === 0) return { created: 0 };

  if (plan.controlPlane) {
    const { createCentralNotificationIntent } = await import('../notification-control-plane');
    let created = 0;
    for (const intent of plan.intents) {
      const result = await createCentralNotificationIntent(
        {
          category: 'INCIDENT',
          channel: intent.channel,
          recipientType: 'USER',
          recipientId: intent.userId,
          recipientAddress: intent.recipientAddress,
          userId: intent.userId,
          incidentId: plan.incidentId,
          templateKey: 'incident-triggered',
          sourceType: 'INCIDENT',
          sourceId: plan.incidentId,
          eventKey: plan.eventKey,
          displayMessage: 'Incident notification',
          payload: {
            kind: `INCIDENT_${intent.channel}`,
            userId: intent.userId,
            incidentId: plan.incidentId,
            eventType: 'triggered',
            eventAt: new Date().toISOString(),
            durableMessage: plan.durableMessage,
            ...(intent.providerKey ? { providerKey: intent.providerKey } : {}),
          } as never,
        },
        tx as never
      );
      if (result.created) created += 1;
    }
    return { created };
  }

  // Legacy shape: one PENDING intent row per recipient/channel, with the same
  // deterministic id the delivery path would have used, so a replay dedupes.
  const result = await tx.notification.createMany({
    data: plan.intents.map(intent => ({
      id: intent.notificationId,
      incidentId: plan.incidentId,
      userId: intent.userId,
      channel: intent.channel,
      message: plan.durableMessage,
      eventType: 'triggered',
      status: 'PENDING',
      attempts: 0,
    })),
    skipDuplicates: true,
  });
  return { created: result.count };
}

/**
 * Delivers already-committed intents. Best effort by design: the step is
 * already durable, and anything left undelivered is swept by the notification
 * retry path, so a provider outage cannot lose an intended page.
 */
export async function deliverEscalationNotificationIntents(
  plan: EscalationNotificationPlan
): Promise<Array<{ userId: string; channel: string; outcome: string }>> {
  const outcomes: Array<{ userId: string; channel: string; outcome: string }> = [];

  for (const intent of plan.intents) {
    try {
      if (plan.controlPlane) {
        const { deliverCentralNotification } = await import('../notification-control-plane');
        const result = await deliverCentralNotification(intent.notificationId);
        outcomes.push({
          userId: intent.userId,
          channel: intent.channel,
          outcome: result.success ? 'DELIVERED' : 'QUEUED',
        });
        continue;
      }

      const attempt = await dispatchNotificationAttempt({
        notificationId: intent.notificationId,
        incidentId: plan.incidentId,
        userId: intent.userId,
        channel: intent.channel,
        eventType: 'triggered',
        message: plan.durableMessage,
      });
      await applyLegacyAttemptOutcome(intent.notificationId, attempt);
      outcomes.push({ userId: intent.userId, channel: intent.channel, outcome: attempt.outcome });
    } catch (error) {
      // Leave the row for the retry sweeper rather than losing the page.
      await markLegacyIntentForRetry(
        intent.notificationId,
        error instanceof Error ? error.message : String(error)
      );
      outcomes.push({
        userId: intent.userId,
        channel: intent.channel,
        outcome: 'RETRYABLE_FAILURE',
      });
      logger.warn('escalation.notification.dispatch_failed', {
        incidentId: plan.incidentId,
        userId: intent.userId,
        channel: intent.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcomes;
}

async function applyLegacyAttemptOutcome(
  notificationId: string,
  attempt: { outcome: string; error?: string; providerMessageId?: string }
): Promise<void> {
  if (attempt.outcome === 'DELIVERED') {
    await prisma.notification.updateMany({
      where: { id: notificationId, status: 'PENDING' },
      data: { status: 'SENT', sentAt: new Date(), providerMessageId: attempt.providerMessageId },
    });
    return;
  }
  if (attempt.outcome === 'SKIPPED') {
    await prisma.notification.updateMany({
      where: { id: notificationId, status: 'PENDING' },
      data: {
        status: 'SKIPPED',
        errorMsg: attempt.error || 'Delivery skipped by notification policy.',
      },
    });
    return;
  }
  await markLegacyIntentForRetry(notificationId, attempt.error);
}

/**
 * Parks a legacy intent in FAILED so `retryFailedNotifications()` owns it from
 * here. Attempt counting and backoff stay with that one retry policy.
 */
async function markLegacyIntentForRetry(notificationId: string, error?: string): Promise<void> {
  // Never throws. The step is already durable at this point, so a failure to
  // even record the handoff must not surface as a step failure — the
  // pending-timeout sweeper picks the intent up regardless.
  try {
    await prisma.notification.updateMany({
      where: { id: notificationId, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMsg: error || 'Escalation page awaiting retry',
      },
    });
  } catch {
    // Intentionally ignored.
  }
}
