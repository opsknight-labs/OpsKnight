import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import {
  transformGoogleCloudMonitoringToEvent,
  GoogleCloudMonitoringEvent,
} from '@/lib/integrations/google-cloud-monitoring';

function parsePubSubPayload(body: string): GoogleCloudMonitoringEvent {
  const parsed = JSON.parse(body) as Record<string, any>;
  const message = parsed?.message;
  if (message?.data) {
    try {
      const decoded = Buffer.from(message.data, 'base64').toString('utf8');
      const decodedJson = JSON.parse(decoded);
      return {
        ...decodedJson,
        _pubsub: {
          messageId: message.messageId,
          publishTime: message.publishTime,
          attributes: message.attributes,
          subscription: parsed.subscription,
        },
      } as GoogleCloudMonitoringEvent;
    } catch {
      return parsed as GoogleCloudMonitoringEvent;
    }
  }
  return parsed as GoogleCloudMonitoringEvent;
}

export const POST = createIntegrationRoute<GoogleCloudMonitoringEvent>(
  'GOOGLE_CLOUD_MONITORING',
  transformGoogleCloudMonitoringToEvent,
  {
    signatureProvider: 'generic',
    parsePayload: parsePubSubPayload,
  }
);
