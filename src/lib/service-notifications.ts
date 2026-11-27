/** Service notification dispatcher with target-level durable idempotency. */
import prisma from './prisma';
import { incidentNotificationPriority } from './notification-priority';
import { logger } from './logger';
import { unsupportedServiceChannels } from './service-notification-settings';
import { readSlackWebhookUrl, slackWebhookHandle } from './slack-webhook-secret';
import { enqueueCentralNotification } from './notification-control-plane';
import { getBaseUrl } from './env-validation';
import type { SlackCardEvent } from './slack/incident-card';
import type { SlackLiveCardRequest } from './slack/live-card';
import { slackDestinationMatches } from './slack/destination-conditions';

export type ServiceNotificationEventType = 'triggered' | 'acknowledged' | 'resolved' | 'updated';

/** `updated` sub-events whose Slack thread reply follows the service's "notify on triggered" toggle. */
const RETRIGGER_EVENTS = new Set<SlackCardEvent>([
  'reopened',
  'escalated',
  'unsnoozed',
  'unacknowledged',
]);

/** Presentation-only status for the queued Slack payload; the card itself re-reads the incident. */
function slackPayloadEvent(status: string): 'triggered' | 'acknowledged' | 'resolved' {
  return status === 'ACKNOWLEDGED'
    ? 'acknowledged'
    : status === 'RESOLVED'
      ? 'resolved'
      : 'triggered';
}

/** True when some service channel already holds a live card for this incident (edit-only work exists). */
async function hasLiveSlackCard(incidentId: string): Promise<boolean> {
  const store = (
    prisma as unknown as {
      slackIncidentMessage?: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
    }
  ).slackIncidentMessage;
  if (!store) return false;
  return !!(await store.findFirst({
    where: { incidentId, ts: { not: null } },
    select: { id: true },
  }));
}

function serviceDeliveryKey(
  incident: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    escalationGeneration?: number | null;
  },
  eventType: ServiceNotificationEventType
): string {
  const at =
    eventType === 'triggered'
      ? incident.createdAt
      : eventType === 'acknowledged'
        ? (incident.acknowledgedAt ?? incident.updatedAt)
        : eventType === 'resolved'
          ? (incident.resolvedAt ?? incident.updatedAt)
          : incident.updatedAt;
  const generation = eventType === 'triggered' ? `:g${incident.escalationGeneration ?? 0}` : '';
  return `${incident.id}:${eventType}:${at.toISOString()}${generation}`;
}

async function persistIntent(
  deliver: () => Promise<void>
): Promise<{ success: boolean; error?: string }> {
  try {
    await deliver();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

type SlackChannelTarget = {
  id: string;
  address: string;
  name: string | null;
  matches?: boolean;
};

/** Linked Slack destinations (or the legacy channel), deduplicated by address, with their conditions applied. */
async function loadSlackChannelTargets(
  service: { id: string; slackChannel?: string | null },
  incident: { priority?: string | null; urgency?: string | null }
): Promise<SlackChannelTarget[]> {
  const slackDestinations =
    (await (
      prisma as unknown as {
        slackDestination?: {
          findMany: (a: unknown) => Promise<
            Array<{
              id: string;
              channelId: string;
              channelName: string | null;
              priorities?: string[];
              urgencies?: string[];
            }>
          >;
        };
      }
    ).slackDestination?.findMany({
      where: { serviceId: service.id, enabled: true },
      select: {
        id: true,
        channelId: true,
        channelName: true,
        priorities: true,
        urgencies: true,
      },
      orderBy: { createdAt: 'asc' },
    })) ?? [];

  const rawChannels: SlackChannelTarget[] =
    slackDestinations.length > 0
      ? slackDestinations.map(d => ({
          id: d.id,
          address: (d.channelId || d.channelName || '').trim(),
          name: d.channelName?.trim() || null,
          matches: slackDestinationMatches(d, incident),
        }))
      : service.slackChannel?.trim()
        ? [
            {
              id: 'legacy',
              address: service.slackChannel.trim(),
              name: service.slackChannel.trim(),
            },
          ]
        : [];

  // Filter empty addresses and deduplicate by address
  const seenAddresses = new Set<string>();
  const activeChannels: SlackChannelTarget[] = [];
  for (const target of rawChannels) {
    const normalized = target.address.toLowerCase();
    if (normalized && !seenAddresses.has(normalized)) {
      seenAddresses.add(normalized);
      activeChannels.push(target);
    }
  }
  return activeChannels;
}

export async function sendServiceNotifications(
  incidentId: string,
  eventType: ServiceNotificationEventType,
  options: {
    eventAt?: Date;
    escalationGeneration?: number;
    expectedStatus?: string;
    /** Stop after the Slack and Teams cards: no webhooks (snooze and suppress). */
    chatOnly?: boolean;
    /** What an `updated` event actually was (reopened, snoozed, reassigned...), for the Slack card. */
    subEvent?: SlackCardEvent;
    /** Refresh only the Slack channel cards (no Teams, webhook or Slack-webhook delivery). */
    slackOnly?: boolean;
  } = {}
): Promise<{ success: boolean; errors?: string[] }> {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        service: { include: { webhookIntegrations: { where: { enabled: true } } } },
        assignee: true,
      },
    });
    if (!incident?.service) return { success: false, errors: ['Incident or service not found'] };
    const requiredStatus =
      eventType === 'triggered'
        ? 'OPEN'
        : eventType === 'acknowledged'
          ? 'ACKNOWLEDGED'
          : eventType === 'resolved'
            ? 'RESOLVED'
            : null;
    const currentEventAt =
      eventType === 'acknowledged'
        ? incident.acknowledgedAt
        : eventType === 'resolved'
          ? incident.resolvedAt
          : null;
    const compareCommittedInstant = eventType === 'acknowledged' || eventType === 'resolved';
    if (
      (requiredStatus && incident.status !== requiredStatus) ||
      (options.expectedStatus && incident.status !== options.expectedStatus) ||
      (eventType === 'triggered' &&
        options.escalationGeneration != null &&
        incident.escalationGeneration !== options.escalationGeneration) ||
      (compareCommittedInstant &&
        options.eventAt &&
        currentEventAt?.getTime() !== options.eventAt.getTime())
    ) {
      logger.info('service_notifications.stale_lifecycle_aborted', {
        incidentId,
        eventType,
        currentStatus: incident.status,
      });
      return { success: true };
    }

    const service = incident.service;
    const notifyEnabled =
      eventType === 'triggered'
        ? (service.serviceNotifyOnTriggered ?? true)
        : eventType === 'acknowledged'
          ? (service.serviceNotifyOnAck ?? true)
          : eventType === 'resolved'
            ? (service.serviceNotifyOnResolved ?? true)
            : true;
    const slackEvent: SlackCardEvent =
      eventType === 'updated' ? (options.subEvent ?? 'updated') : eventType;
    const slackReply =
      notifyEnabled &&
      (!RETRIGGER_EVENTS.has(slackEvent) || (service.serviceNotifyOnTriggered ?? true));
    // An `updated` event, or one whose notifications are off, only edits a card that already exists:
    // the edit notifies nobody, and it keeps the card from showing a stale state forever.
    const slackEditOnly = eventType === 'updated' || !notifyEnabled;
    let liveCardLookup: Promise<boolean> | undefined;
    const liveCardExists = () => (liveCardLookup ??= hasLiveSlackCard(incident.id));
    // With notifications off, only silent edits of existing cards run: the Slack card below (guarded by
    // `slackEditable`) and Teams, whose delivery re-checks the toggle and only edits a card it already posted.
    const slackOnly = options.slackOnly || !notifyEnabled;
    const deliveryPolicy = incidentNotificationPriority({
      eventType,
      priority: incident.priority,
      urgency: incident.urgency,
    });
    const dispatchOptions = { dispatchImmediately: deliveryPolicy.trafficClass === 'CRITICAL' };
    const eventGeneration = options.escalationGeneration ?? incident.escalationGeneration ?? 0;
    const deliveryKey = options.eventAt
      ? `${incident.id}:${eventType}:${options.eventAt.toISOString()}${
          eventType === 'triggered' ? `:g${eventGeneration}` : ''
        }`
      : serviceDeliveryKey({ ...incident, escalationGeneration: eventGeneration }, eventType);
    // A pre-paging storm child (no escalation of its own) rolls its posts up under the parent's.
    const rollUpParentId =
      eventType === 'triggered' && incident.escalationStatus === 'COMPLETED'
        ? ((
            await prisma.incidentRelationship.findFirst({
              where: { sourceIncidentId: incident.id, type: 'PARENT_CHILD', decision: 'ACCEPTED' },
              select: { targetIncidentId: true },
            })
          )?.targetIncidentId ?? null)
        : null;
    const rollUp = rollUpParentId ? { rollUpParentId } : {};
    const incidentSourceId = `${service.id}:${rollUpParentId ?? incidentId}`;
    const serviceChannels = service.serviceNotificationChannels || [];
    const ignoredChannels = unsupportedServiceChannels(serviceChannels);
    if (ignoredChannels.length > 0) {
      logger.warn('service_notifications.unsupported_channels_ignored', {
        serviceId: service.id,
        channels: ignoredChannels,
      });
    }
    const errors: string[] = [];
    const incidentPresentation = {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      urgency: incident.urgency,
      serviceName: service.name,
      assigneeName: incident.assignee?.name || undefined,
    };
    const lifecyclePolicy = {
      incidentId,
      eventType,
      expectedStatus: options.expectedStatus ?? incident.status,
      escalationGeneration: eventGeneration,
      serviceId: service.id,
    };
    const webhookIncident = {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      urgency: incident.urgency,
      service: { id: service.id, name: service.name },
      assignee: incident.assignee,
      createdAt: incident.createdAt,
      acknowledgedAt: incident.acknowledgedAt,
      resolvedAt: incident.resolvedAt,
    };

    if (serviceChannels.includes('SLACK')) {
      const activeChannels = await loadSlackChannelTargets(service, incident);

      // The webhook URL is a stored secret: rows below carry only a non-secret handle and delivery
      // reads the URL from the service when it sends.
      const slackWebhookUrl = await readSlackWebhookUrl(service.slackWebhookUrl);
      const slackWebhookTarget = slackWebhookUrl ? slackWebhookHandle(slackWebhookUrl) : null;
      const slackEditable = !slackEditOnly || (await liveCardExists());
      if (activeChannels.length > 0 && slackEditable) {
        await Promise.all(
          activeChannels.map(async target => {
            const channelAddress = target.address;
            if (!channelAddress) return;
            // A destination whose conditions no longer match still edits a card it already posted.
            const conditionEditOnly = target.matches === false;
            if (conditionEditOnly && !(await liveCardExists())) return;
            const channelDeliveryKey = `${deliveryKey}:${target.id}${
              eventType === 'updated' && options.subEvent ? `:${options.subEvent}` : ''
            }${notifyEnabled ? '' : ':edit'}`;
            const card: SlackLiveCardRequest = {
              event: slackEvent,
              eventKey: channelDeliveryKey,
              reply: slackReply,
              ...(slackEditOnly || conditionEditOnly ? { editOnly: true } : {}),
            };
            const result = await persistIntent(async () => {
              await enqueueCentralNotification(
                {
                  category: 'INCIDENT',
                  channel: 'SLACK',
                  recipientType: 'SLACK_CHANNEL',
                  recipientId: service.id,
                  recipientAddress: channelAddress,
                  incidentId,
                  templateKey: `service-slack-${notifyEnabled ? eventType : 'card-edit'}`,
                  sourceType: 'SERVICE_INCIDENT',
                  sourceId: incidentSourceId,
                  ...rollUp,
                  eventKey: channelDeliveryKey,
                  displayMessage: `${eventType}: ${incident.title}`,
                  ...deliveryPolicy,
                  payload: {
                    kind: 'SLACK_CHANNEL',
                    channel: channelAddress,
                    incident: incidentPresentation,
                    eventType:
                      eventType === 'updated' ? slackPayloadEvent(incident.status) : eventType,
                    includeInteractiveButtons: true,
                    serviceId: incident.serviceId,
                    card,
                    lifecyclePolicy: {
                      ...lifecyclePolicy,
                      // A silent edit must survive the "updated is superseded by resolution" rule
                      // and the notify toggle, both of which apply to lifecycle event types only.
                      ...(notifyEnabled ? {} : { eventType: 'card_edit' }),
                      targetKind: 'SERVICE_SLACK_CHANNEL',
                      targetId: target.id,
                      targetAddress: channelAddress,
                    },
                  },
                },
                dispatchOptions
              );
            });
            if (!result.success)
              errors.push(
                `Slack channel notification failed for ${target.name ?? channelAddress}: ${result.error || 'Unknown error'}`
              );
          })
        );
      }

      if (slackWebhookTarget && eventType !== 'updated' && !slackOnly) {
        const result = await persistIntent(async () => {
          await enqueueCentralNotification(
            {
              category: 'INCIDENT',
              channel: 'SLACK',
              recipientType: 'WEBHOOK',
              recipientId: service.id,
              recipientAddress: slackWebhookTarget,
              incidentId,
              templateKey: `service-slack-webhook-${eventType}`,
              sourceType: 'SERVICE_INCIDENT',
              sourceId: incidentSourceId,
              ...rollUp,
              eventKey: deliveryKey,
              displayMessage: `${eventType}: ${incident.title}`,
              ...deliveryPolicy,
              payload: {
                kind: 'SLACK_WEBHOOK',
                incident: incidentPresentation,
                eventType,
                serviceId: service.id,
                lifecyclePolicy: {
                  ...lifecyclePolicy,
                  targetKind: 'SERVICE_SLACK_WEBHOOK',
                  targetId: service.id,
                  targetAddress: slackWebhookTarget,
                },
              },
            },
            dispatchOptions
          );
        });
        if (!result.success)
          errors.push(`Slack webhook notification failed: ${result.error || 'Unknown error'}`);
      }
    }

    if (options.slackOnly)
      return { success: errors.length === 0, errors: errors.length ? errors : undefined };

    if (serviceChannels.includes('MICROSOFT_TEAMS' as never)) {
      const teamsDestinations = await (
        prisma as unknown as {
          microsoftTeamsDestination: {
            findMany: (a: unknown) => Promise<Array<{ id: string; enabled: boolean }>>;
          };
        }
      ).microsoftTeamsDestination.findMany({
        where: { serviceId: service.id, enabled: true },
        orderBy: { createdAt: 'asc' },
      } as never);
      if (teamsDestinations.length > 0) {
        // Claim-first ExternalOperation path: idempotent row + durable BackgroundJob
        // (ExternalOperation @@unique([provider,idempotencyKey]) + advisory lock + AMBIGUOUS semantics).
        // Central Notification intent is superseded for Teams — this fence prevents duplicate cards
        // when multiple replicas race the same incidentVersion.
        // Escalations edit the Teams card in place and reply in its thread (B1).
        const teamsEventType =
          eventType === 'updated' && options.subEvent === 'escalated' ? 'escalated' : eventType;
        const incidentUpdatedAtForTeams =
          options.eventAt ??
          (teamsEventType === 'triggered'
            ? incident.createdAt
            : teamsEventType === 'acknowledged'
              ? (incident.acknowledgedAt ?? incident.updatedAt)
              : teamsEventType === 'resolved'
                ? (incident.resolvedAt ?? incident.updatedAt)
                : incident.updatedAt);
        const { enqueueMicrosoftTeamsDelivery } = await import('./microsoft-teams/delivery');
        await Promise.all(
          teamsDestinations.map(async teamsDestination => {
            const result = await persistIntent(async () => {
              await enqueueMicrosoftTeamsDelivery({
                incidentId,
                destinationId: teamsDestination.id,
                eventType: teamsEventType,
                incidentUpdatedAt: incidentUpdatedAtForTeams,
                escalationGeneration: eventGeneration,
              });
            });
            if (!result.success)
              errors.push(
                `Microsoft Teams notification failed for destination ${teamsDestination.id}: ${result.error || 'Unknown error'}`
              );
          })
        );
      }
    }

    // Webhooks have no card to edit: with this event's notifications off they get nothing, as before.
    if (slackOnly || options.chatOnly)
      return { success: errors.length === 0, errors: errors.length ? errors : undefined };

    if (serviceChannels.includes('WEBHOOK')) {
      const results = await Promise.all(
        service.webhookIntegrations.map(async webhook => {
          const result = await persistIntent(async () => {
            const [{ decryptStoredSecret }, { formatWebhookPayloadByType }] = await Promise.all([
              import('./encryption'),
              import('./webhooks'),
            ]);
            await enqueueCentralNotification(
              {
                category: 'INCIDENT',
                channel: 'WEBHOOK',
                recipientType: 'WEBHOOK',
                recipientId: webhook.id,
                recipientAddress: webhook.url,
                incidentId,
                templateKey: `service-webhook-${eventType}`,
                sourceType: 'WEBHOOK_INTEGRATION',
                sourceId: rollUpParentId ? `${webhook.id}:${rollUpParentId}` : webhook.id,
                ...rollUp,
                eventKey: deliveryKey,
                displayMessage: `${eventType}: ${incident.title}`,
                ...deliveryPolicy,
                payload: {
                  kind: 'WEBHOOK',
                  url: webhook.url,
                  payload: formatWebhookPayloadByType(
                    webhook.type,
                    webhookIncident,
                    eventType,
                    getBaseUrl(),
                    webhook.channel || undefined
                  ),
                  secret: webhook.secret ? await decryptStoredSecret(webhook.secret) : undefined,
                  lifecyclePolicy: {
                    ...lifecyclePolicy,
                    targetKind: 'WEBHOOK_INTEGRATION',
                    targetId: webhook.id,
                    targetAddress: webhook.url,
                    targetType: webhook.type,
                  },
                },
              },
              dispatchOptions
            );
          });
          return { webhookId: webhook.id, ...result };
        })
      );
      for (const result of results)
        if (!result.success)
          errors.push(`Webhook ${result.webhookId} failed: ${result.error || 'Unknown error'}`);
    }

    if (service.webhookUrl && !serviceChannels.includes('WEBHOOK')) {
      const result = await persistIntent(async () => {
        const { generateIncidentWebhookPayload } = await import('./webhooks');
        await enqueueCentralNotification(
          {
            category: 'INCIDENT',
            channel: 'WEBHOOK',
            recipientType: 'WEBHOOK',
            recipientId: service.id,
            recipientAddress: service.webhookUrl!,
            incidentId,
            templateKey: `legacy-service-webhook-${eventType}`,
            sourceType: 'SERVICE_INCIDENT',
            sourceId: incidentSourceId,
            ...rollUp,
            eventKey: deliveryKey,
            displayMessage: `${eventType}: ${incident.title}`,
            ...deliveryPolicy,
            payload: {
              kind: 'WEBHOOK',
              url: service.webhookUrl!,
              payload: generateIncidentWebhookPayload(webhookIncident, eventType),
              lifecyclePolicy: {
                ...lifecyclePolicy,
                targetKind: 'LEGACY_SERVICE_WEBHOOK',
                targetId: service.id,
                targetAddress: service.webhookUrl!,
              },
            },
          },
          dispatchOptions
        );
      });
      if (!result.success) errors.push(`Legacy webhook failed: ${result.error || 'Unknown error'}`);
    }

    return { success: errors.length === 0, errors: errors.length ? errors : undefined };
  } catch (error) {
    logger.error('Service notification error', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown service notification error'],
    };
  }
}

export type ServiceSlaNotice = {
  breachType: 'ack' | 'resolve';
  breached: boolean;
  /** `<ack|resolve>:<breached|warning>:<target minutes>`: a breach state notifies each destination once. */
  eventKey: string;
  /** One line posted with the Slack incident card. */
  message: string;
  /** Plain text for Teams and the notification list. */
  text: string;
};

/**
 * SLA warnings and breaches for the service's chat destinations, resolved exactly like the lifecycle
 * notifications above: every linked Slack destination (3 at most, with its priority and urgency
 * conditions), the legacy channel, the legacy Slack webhook and every Microsoft Teams channel. The
 * delivery key is (destination, incident, breach state), so a state is queued once per destination and a
 * monitor re-run only retries the ones that failed to queue.
 */
export async function sendServiceSlaNotifications(
  incidentId: string,
  sla: ServiceSlaNotice,
  options: { fallbackSlackWebhookUrl?: string } = {}
): Promise<{ success: boolean; queued: number; errors?: string[] }> {
  const errors: string[] = [];
  let queued = 0;
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { service: true, assignee: true },
    });
    if (!incident?.service) return { success: false, queued, errors: ['Incident or service not found'] };
    const service = incident.service;
    const channels = service.serviceNotificationChannels || [];
    const ignoredChannels = unsupportedServiceChannels(channels);
    if (ignoredChannels.length > 0) {
      logger.warn('service_notifications.unsupported_channels_ignored', {
        serviceId: service.id,
        channels: ignoredChannels,
      });
    }
    const state = sla.breached ? 'breached' : 'warning';
    const templateKey = `sla-${sla.breachType}-${state}`;
    const incidentPresentation = {
      id: incident.id,
      title: incident.title,
      status: incident.status,
      urgency: incident.urgency,
      serviceName: service.name,
      assigneeName: incident.assignee?.name || undefined,
    };
    const common = {
      category: 'SLA' as const,
      recipientId: service.id,
      incidentId,
      sourceType: 'INCIDENT_SLA',
      sourceId: incidentId,
      eventKey: sla.eventKey,
      displayMessage: sla.text,
      priority: sla.breached ? 0 : 1,
    };
    const lifecyclePolicy = { incidentId, eventType: 'sla', serviceId: service.id };
    const enqueue = async (label: string, input: Parameters<typeof enqueueCentralNotification>[0]) => {
      const result = await persistIntent(async () => {
        await enqueueCentralNotification(input);
      });
      if (result.success) queued += 1;
      else errors.push(`SLA ${label} notification failed: ${result.error || 'Unknown error'}`);
    };

    if (channels.includes('SLACK')) {
      const targets = await loadSlackChannelTargets(service, incident);
      for (const target of targets) {
        // A destination whose priority/urgency conditions do not match the incident gets no new post.
        if (target.matches === false) continue;
        await enqueue(`Slack channel ${target.name ?? target.address}`, {
          ...common,
          channel: 'SLACK',
          recipientType: 'SLACK_CHANNEL',
          recipientAddress: target.address,
          templateKey,
          payload: {
            kind: 'SLACK_CHANNEL',
            channel: target.address,
            incident: incidentPresentation,
            eventType: 'triggered',
            includeInteractiveButtons: true,
            serviceId: service.id,
            additionalMessage: sla.message,
            lifecyclePolicy: {
              ...lifecyclePolicy,
              targetKind: 'SERVICE_SLACK_CHANNEL',
              targetId: target.id,
              targetAddress: target.address,
            },
          },
        });
      }
      const serviceWebhookUrl = await readSlackWebhookUrl(service.slackWebhookUrl);
      if (serviceWebhookUrl) {
        const handle = slackWebhookHandle(serviceWebhookUrl);
        await enqueue('Slack webhook', {
          ...common,
          channel: 'SLACK',
          recipientType: 'WEBHOOK',
          recipientAddress: handle,
          templateKey,
          payload: {
            kind: 'SLACK_WEBHOOK',
            incident: incidentPresentation,
            eventType: 'triggered',
            serviceId: service.id,
            additionalMessage: sla.message,
            lifecyclePolicy: {
              ...lifecyclePolicy,
              targetKind: 'SERVICE_SLACK_WEBHOOK',
              targetId: service.id,
              targetAddress: handle,
            },
          },
        });
      } else if (targets.length === 0 && options.fallbackSlackWebhookUrl) {
        // Deliberate fallback: a service with Slack on but no target of its own uses the global webhook.
        await enqueue('Slack webhook', {
          ...common,
          channel: 'SLACK',
          recipientType: 'WEBHOOK',
          recipientAddress: slackWebhookHandle(options.fallbackSlackWebhookUrl),
          templateKey,
          payload: {
            kind: 'SLACK_WEBHOOK',
            incident: incidentPresentation,
            eventType: 'triggered',
            webhookUrl: options.fallbackSlackWebhookUrl,
            additionalMessage: sla.message,
          },
        });
      }
    }

    if (channels.includes('MICROSOFT_TEAMS')) {
      const teamsDestinations = await (
        prisma as unknown as {
          microsoftTeamsDestination: {
            findMany: (a: unknown) => Promise<
              Array<{
                id: string;
                tenantId: string;
                teamId: string;
                channelId: string;
                channelName?: string | null;
              }>
            >;
          };
        }
      ).microsoftTeamsDestination.findMany({
        where: { serviceId: service.id, enabled: true },
        orderBy: { createdAt: 'asc' },
      } as never);
      const incidentUrl = `${getBaseUrl().replace(/\/+$/, '')}/incidents/${encodeURIComponent(incidentId)}`;
      for (const destination of teamsDestinations) {
        await enqueue(`Microsoft Teams channel ${destination.channelName ?? destination.channelId}`, {
          ...common,
          channel: 'MICROSOFT_TEAMS',
          recipientType: 'MICROSOFT_TEAMS_CHANNEL',
          recipientAddress: `teams:${destination.id}`,
          templateKey,
          payload: {
            kind: 'CHAT_TEXT',
            provider: 'MICROSOFT_TEAMS',
            channel: destination.channelId,
            tenantId: destination.tenantId,
            teamId: destination.teamId,
            title: `SLA ${sla.breachType.toUpperCase()} ${sla.breached ? 'BREACHED' : 'WARNING'}: ${service.name}`,
            text: sla.text,
            url: incidentUrl,
          },
        });
      }
    }
  } catch (error) {
    logger.error('Service SLA notification error', {
      incidentId,
      error: error instanceof Error ? error.message : String(error),
    });
    errors.push(error instanceof Error ? error.message : 'Unknown service SLA notification error');
  }
  return { success: errors.length === 0, queued, errors: errors.length ? errors : undefined };
}
