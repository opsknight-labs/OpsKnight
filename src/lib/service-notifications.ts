/** Service notification dispatcher with target-level durable idempotency. */
import prisma from './prisma';
import { incidentNotificationPriority } from './notification-priority';
import { logger } from './logger';
import { enqueueCentralNotification } from './notification-control-plane';
import { getBaseUrl } from './env-validation';

export type ServiceNotificationEventType = 'triggered' | 'acknowledged' | 'resolved' | 'updated';

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

export async function sendServiceNotifications(
  incidentId: string,
  eventType: ServiceNotificationEventType,
  options: { eventAt?: Date; escalationGeneration?: number; expectedStatus?: string } = {}
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
    if (
      (eventType === 'triggered' && !(service.serviceNotifyOnTriggered ?? true)) ||
      (eventType === 'acknowledged' && !(service.serviceNotifyOnAck ?? true)) ||
      (eventType === 'resolved' && !(service.serviceNotifyOnResolved ?? true))
    )
      return { success: true };
    const eventGeneration = options.escalationGeneration ?? incident.escalationGeneration ?? 0;
    const deliveryKey = options.eventAt
      ? `${incident.id}:${eventType}:${options.eventAt.toISOString()}${
          eventType === 'triggered' ? `:g${eventGeneration}` : ''
        }`
      : serviceDeliveryKey({ ...incident, escalationGeneration: eventGeneration }, eventType);
    const serviceChannels = service.serviceNotificationChannels || [];
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
      const slackDestinations =
        (await (
          prisma as unknown as {
            slackDestination?: {
              findMany: (
                a: unknown
              ) => Promise<
                Array<{
                  id: string;
                  channelId: string;
                  channelName: string | null;
                  enabled: boolean;
                }>
              >;
            };
          }
        ).slackDestination
          ?.findMany({
            where: { serviceId: service.id, enabled: true },
            orderBy: { createdAt: 'asc' },
          })
          .catch(() => [])) ?? [];

      const activeChannels: Array<{ id: string; address: string; name: string | null }> =
        slackDestinations.length > 0
          ? slackDestinations.map(d => ({
              id: d.id,
              address: d.channelId || d.channelName || '',
              name: d.channelName,
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

      const slackWebhookUrl = service.slackWebhookUrl?.trim();
      if (activeChannels.length > 0 && eventType !== 'updated') {
        await Promise.all(
          activeChannels.map(async target => {
            const channelAddress = target.address;
            if (!channelAddress) return;
            const channelDeliveryKey = `${deliveryKey}:${target.id}`;
            const result = await persistIntent(async () => {
              await enqueueCentralNotification({
                category: 'INCIDENT',
                channel: 'SLACK',
                recipientType: 'SLACK_CHANNEL',
                recipientId: service.id,
                recipientAddress: channelAddress,
                incidentId,
                templateKey: `service-slack-${eventType}`,
                sourceType: 'SERVICE_INCIDENT',
                sourceId: `${service.id}:${incidentId}`,
                eventKey: channelDeliveryKey,
                displayMessage: `${eventType}: ${incident.title}`,
                ...incidentNotificationPriority({
                  eventType,
                  priority: incident.priority,
                  urgency: incident.urgency,
                }),
                payload: {
                  kind: 'SLACK_CHANNEL',
                  channel: channelAddress,
                  incident: incidentPresentation,
                  eventType,
                  includeInteractiveButtons: true,
                  serviceId: incident.serviceId,
                  lifecyclePolicy: {
                    ...lifecyclePolicy,
                    targetKind: 'SERVICE_SLACK_CHANNEL',
                    targetId: service.id,
                    targetAddress: channelAddress,
                  },
                },
              });
            });
            if (!result.success)
              errors.push(
                `Slack channel notification failed for ${target.name ?? channelAddress}: ${result.error || 'Unknown error'}`
              );
          })
        );
      }

      if (slackWebhookUrl && eventType !== 'updated') {
        const result = await persistIntent(async () => {
          await enqueueCentralNotification({
            category: 'INCIDENT',
            channel: 'SLACK',
            recipientType: 'WEBHOOK',
            recipientId: service.id,
            recipientAddress: slackWebhookUrl,
            incidentId,
            templateKey: `service-slack-webhook-${eventType}`,
            sourceType: 'SERVICE_INCIDENT',
            sourceId: `${service.id}:${incidentId}`,
            eventKey: deliveryKey,
            displayMessage: `${eventType}: ${incident.title}`,
            ...incidentNotificationPriority({
              eventType,
              priority: incident.priority,
              urgency: incident.urgency,
            }),
            payload: {
              kind: 'SLACK_WEBHOOK',
              incident: incidentPresentation,
              eventType,
              webhookUrl: slackWebhookUrl,
              serviceId: service.id,
              lifecyclePolicy: {
                ...lifecyclePolicy,
                targetKind: 'SERVICE_SLACK_WEBHOOK',
                targetId: service.id,
                targetAddress: slackWebhookUrl,
              },
            },
          });
        });
        if (!result.success)
          errors.push(`Slack webhook notification failed: ${result.error || 'Unknown error'}`);
      }
    }

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
        const teamsEventType = eventType;
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

    if (serviceChannels.includes('WEBHOOK')) {
      const results = await Promise.all(
        service.webhookIntegrations.map(async webhook => {
          const result = await persistIntent(async () => {
            const [{ decryptStoredSecret }, { formatWebhookPayloadByType }] = await Promise.all([
              import('./encryption'),
              import('./webhooks'),
            ]);
            await enqueueCentralNotification({
              category: 'INCIDENT',
              channel: 'WEBHOOK',
              recipientType: 'WEBHOOK',
              recipientId: webhook.id,
              recipientAddress: webhook.url,
              incidentId,
              templateKey: `service-webhook-${eventType}`,
              sourceType: 'WEBHOOK_INTEGRATION',
              sourceId: webhook.id,
              eventKey: deliveryKey,
              displayMessage: `${eventType}: ${incident.title}`,
              ...incidentNotificationPriority({
                eventType,
                priority: incident.priority,
                urgency: incident.urgency,
              }),
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
                },
              },
            });
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
        await enqueueCentralNotification({
          category: 'INCIDENT',
          channel: 'WEBHOOK',
          recipientType: 'WEBHOOK',
          recipientId: service.id,
          recipientAddress: service.webhookUrl!,
          incidentId,
          templateKey: `legacy-service-webhook-${eventType}`,
          sourceType: 'SERVICE_INCIDENT',
          sourceId: `${service.id}:${incidentId}`,
          eventKey: deliveryKey,
          displayMessage: `${eventType}: ${incident.title}`,
          ...incidentNotificationPriority({
            eventType,
            priority: incident.priority,
            urgency: incident.urgency,
          }),
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
        });
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
