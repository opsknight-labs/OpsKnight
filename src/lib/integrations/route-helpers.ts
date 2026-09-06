import { createIntegrationHandler } from './handler';
import { processEvent, EventPayload } from '@/lib/events';
import { IntegrationSchemas } from './schemas';

type SignatureProvider =
  | 'github'
  | 'gitlab'
  | 'sentry'
  | 'slack'
  | 'grafana'
  | 'vercel'
  | 'generic';

export function createIntegrationRoute<T>(
  integrationType: keyof typeof IntegrationSchemas,
  transform: (payload: T) => EventPayload,
  options?: {
    signatureProvider?: SignatureProvider;
    skipRateLimit?: boolean;
    skipSignatureVerification?: boolean;
    parsePayload?: (body: string) => T;
  }
) {
  return createIntegrationHandler<T>(
    {
      integrationType,
      signatureProvider: options?.signatureProvider,
      skipRateLimit: options?.skipRateLimit,
      skipSignatureVerification: options?.skipSignatureVerification,
      parsePayload: options?.parsePayload,
    },
    async ({ payload, integration }) => {
      const event = transform(payload);
      const result = await processEvent(event, integration.serviceId, integration.id);
      return { action: result.action, incident: result.incident };
    }
  );
}
