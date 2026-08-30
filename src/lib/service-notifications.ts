/** Service notification dispatcher with target-level durable idempotency. */
import prisma from './prisma';
import { notifySlackForIncident, sendSlackMessageToChannel } from './slack';
import { sendIncidentWebhook } from './webhooks';
import { logger } from './logger';
import { deliveryMarkerId, isDeliveryComplete, markDeliveryComplete } from './delivery-idempotency';

export type ServiceNotificationEventType = 'triggered' | 'acknowledged' | 'resolved' | 'updated';

function serviceDeliveryKey(incident: { id: string; createdAt: Date; updatedAt: Date; acknowledgedAt: Date | null; resolvedAt: Date | null }, eventType: ServiceNotificationEventType): string {
  const at = eventType === 'triggered' ? incident.createdAt : eventType === 'acknowledged' ? incident.acknowledgedAt ?? incident.updatedAt : eventType === 'resolved' ? incident.resolvedAt ?? incident.updatedAt : incident.updatedAt;
  return `${incident.id}:${eventType}:${at.toISOString()}`;
}

async function once(deliveryKey: string, targetId: string, deliver: () => Promise<{ success: boolean; error?: string }>): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const markerId = deliveryMarkerId('service-notification', deliveryKey, targetId);
  if (await isDeliveryComplete(markerId)) return { success: true, skipped: true };
  const result = await deliver();
  if (result.success) await markDeliveryComplete({ markerId, namespace: 'service-notification', deliveryKey, targetId });
  return result;
}

export async function sendServiceNotifications(incidentId: string, eventType: ServiceNotificationEventType): Promise<{ success: boolean; errors?: string[] }> {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { service: { include: { webhookIntegrations: { where: { enabled: true } } } }, assignee: true },
    });
    if (!incident?.service) return { success: false, errors: ['Incident or service not found'] };
    if (eventType === 'triggered' && incident.status !== 'OPEN') {
      logger.info('service_notifications.triggered_aborted_non_open_state', { incidentId, currentStatus: incident.status });
      return { success: true };
    }

    const service = incident.service;
    if ((eventType === 'triggered' && !(service.serviceNotifyOnTriggered ?? true)) || (eventType === 'acknowledged' && !(service.serviceNotifyOnAck ?? true)) || (eventType === 'resolved' && !(service.serviceNotifyOnResolved ?? true))) return { success: true };
    const deliveryKey = serviceDeliveryKey(incident, eventType);
    const serviceChannels = service.serviceNotificationChannels || [];
    const errors: string[] = [];

    if (serviceChannels.includes('SLACK')) {
      if (service.slackChannel && eventType !== 'updated') {
        const result = await once(deliveryKey, `slack-channel:${service.id}`, async () => {
          const response = await sendSlackMessageToChannel(service.slackChannel!, {
            id: incident.id, title: incident.title, status: incident.status, urgency: incident.urgency,
            serviceName: service.name, assigneeName: incident.assignee?.name,
          }, eventType, true, incident.serviceId);
          return { success: response.success, error: response.error };
        });
        if (!result.success) errors.push(`Slack channel notification failed: ${result.error || 'Unknown error'}`);
      }

      if (service.slackWebhookUrl && eventType !== 'updated') {
        const result = await once(deliveryKey, `slack-webhook:${service.id}`, async () => {
          try {
            const response = await notifySlackForIncident(incidentId, eventType);
            return { success: response.success, error: response.error };
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
          }
        });
        if (!result.success) errors.push(`Slack webhook notification failed: ${result.error || 'Unknown error'}`);
      }
    }

    if (serviceChannels.includes('WEBHOOK')) {
      const results = await Promise.all(service.webhookIntegrations.map(async webhook => {
        const result = await once(deliveryKey, `webhook:${webhook.id}`, async () => {
          try {
            const { decryptStoredSecret } = await import('./encryption');
            return await sendIncidentWebhook(webhook.url, incidentId, eventType, webhook.secret ? await decryptStoredSecret(webhook.secret) : undefined, webhook.type, webhook.channel || undefined);
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error) };
          }
        });
        return { webhookId: webhook.id, ...result };
      }));
      for (const result of results) if (!result.success) errors.push(`Webhook ${result.webhookId} failed: ${result.error || 'Unknown error'}`);
    }

    if (service.webhookUrl && !serviceChannels.includes('WEBHOOK')) {
      const result = await once(deliveryKey, `legacy-webhook:${service.id}`, () => sendIncidentWebhook(service.webhookUrl!, incidentId, eventType));
      if (!result.success) errors.push(`Legacy webhook failed: ${result.error || 'Unknown error'}`);
    }

    return { success: errors.length === 0, errors: errors.length ? errors : undefined };
  } catch (error) {
    logger.error('Service notification error', { incidentId, error: error instanceof Error ? error.message : String(error) });
    return { success: false, errors: [error instanceof Error ? error.message : 'Unknown service notification error'] };
  }
}
