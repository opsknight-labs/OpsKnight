import { createIntegrationRoute } from '@/lib/integrations/route-helpers';
import {
  transformGoogleCloudMonitoringToEvent,
  GoogleCloudMonitoringEvent,
} from '@/lib/integrations/google-cloud-monitoring';

function parsePubSubPayload(body: string): GoogleCloudMonitoringEvent {
  const parsed = JSON.parse(body) as {
    message?: {
      data?: string;
      messageId?: string;
      publishTime?: string;
      attributes?: Record<string, string>;
    };
    subscription?: string;
  };
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
      // An undecodable Pub/Sub message is invalid input, not an alert; the handler returns 400.
      throw new Error('Invalid Pub/Sub message data');
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
