import { createIntegrationHandler } from './handler';
import { processIntegrationEvent, EventPayload } from '@/lib/events';
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
  // null marks a provider notification that must not change incident state.
  transform: (payload: T) => EventPayload | null,
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
      if (!event) return { action: 'ignored' };
      const result = await processIntegrationEvent({
        event,
        serviceId: integration.serviceId,
        integrationId: integration.id,
        integrationType,
        providerPayload: payload,
        receivedAt: new Date(),
      });
      return result;
    }
  );
}
