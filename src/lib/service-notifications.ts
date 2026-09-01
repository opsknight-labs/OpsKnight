/** Service notification dispatcher with target-level durable idempotency. */
import prisma from './prisma';
import { logger } from './logger';
import { enqueueCentralNotification } from './notification-control-plane';
import { formatWebhookPayloadByType, generateIncidentWebhookPayload } from './webhooks';
import { getBaseUrl } from './env-validation';

export type ServiceNotificationEventType = 'triggered' | 'acknowledged' | 'resolved' | 'updated';

function serviceDeliveryKey(
  incident: {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
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
  return `${incident.id}:${eventType}:${at.toISOString()}`;
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
  options: { eventAt?: Date } = {}
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
      eventType === 'triggered'
        ? incident.createdAt
        : eventType === 'acknowledged'
          ? incident.acknowledgedAt
          : eventType === 'resolved'
            ? incident.resolvedAt
            : incident.updatedAt;
    if (
      (requiredStatus && incident.status !== requiredStatus) ||
      (options.eventAt && currentEventAt?.getTime() !== options.eventAt.getTime())
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
    const deliveryKey = options.eventAt
      ? `${incident.id}:${eventType}:${options.eventAt.toISOString()}`
      : serviceDeliveryKey(incident, eventType);
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
      if (service.slackChannel && eventType !== 'updated') {
        const result = await persistIntent(async () => {
          await enqueueCentralNotification({
            category: 'INCIDENT',
            channel: 'SLACK',
            recipientType: 'SLACK_CHANNEL',
            recipientId: service.id,
            recipientAddress: service.slackChannel!,
            incidentId,
            templateKey: `service-slack-${eventType}`,
            sourceType: 'SERVICE_INCIDENT',
            sourceId: `${service.id}:${incidentId}`,
            eventKey: deliveryKey,
            displayMessage: `${eventType}: ${incident.title}`,
            priority: incident.urgency === 'HIGH' ? 1 : 3,
            payload: {
              kind: 'SLACK_CHANNEL',
              channel: service.slackChannel!,
              incident: incidentPresentation,
              eventType,
              includeInteractiveButtons: true,
              serviceId: incident.serviceId,
            },
          });
        });
        if (!result.success)
          errors.push(`Slack channel notification failed: ${result.error || 'Unknown error'}`);
      }

      if (service.slackWebhookUrl && eventType !== 'updated') {
        const result = await persistIntent(async () => {
          await enqueueCentralNotification({
            category: 'INCIDENT',
            channel: 'SLACK',
            recipientType: 'WEBHOOK',
            recipientId: service.id,
            recipientAddress: service.slackWebhookUrl!,
            incidentId,
            templateKey: `service-slack-webhook-${eventType}`,
            sourceType: 'SERVICE_INCIDENT',
            sourceId: `${service.id}:${incidentId}`,
            eventKey: deliveryKey,
            displayMessage: `${eventType}: ${incident.title}`,
            priority: incident.urgency === 'HIGH' ? 1 : 3,
            payload: {
              kind: 'SLACK_WEBHOOK',
              incident: incidentPresentation,
              eventType,
              webhookUrl: service.slackWebhookUrl!,
            },
          });
        });
        if (!result.success)
          errors.push(`Slack webhook notification failed: ${result.error || 'Unknown error'}`);
      }
    }

    if (serviceChannels.includes('WEBHOOK')) {
      const results = await Promise.all(
        service.webhookIntegrations.map(async webhook => {
          const result = await persistIntent(async () => {
            const { decryptStoredSecret } = await import('./encryption');
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
              priority: incident.urgency === 'HIGH' ? 1 : 3,
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
      const result = await persistIntent(() =>
        enqueueCentralNotification({
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
          priority: incident.urgency === 'HIGH' ? 1 : 3,
          payload: {
            kind: 'WEBHOOK',
            url: service.webhookUrl!,
            payload: generateIncidentWebhookPayload(webhookIncident, eventType),
          },
        }).then(() => undefined)
      );
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
