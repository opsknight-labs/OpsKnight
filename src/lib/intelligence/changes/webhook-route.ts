import { z } from 'zod/v3';
import { createIntegrationHandler } from '@/lib/integrations/handler';
import type { MappedChange } from './mappers';
import { recordIntegrationChange } from './service-mapping';

const anyObject = z.object({}).passthrough();

/**
 * Builds a change-source webhook route: authenticated exactly like the generic change endpoint
 * (integration key, optional HMAC, rate limit, delivery de-duplication, generic webhook integration),
 * scoped to the integration's service (or, for a multi-service integration, to the service its app/component
 * labels map to), and mapped by a pure function. Records evidence only: never an
 * alert, never an incident, never the paging path.
 */
export function changeWebhookRoute(
  map: (payload: unknown) => MappedChange | null,
  signatureProvider: 'generic' | 'github' | 'gitlab' = 'generic'
) {
  return createIntegrationHandler<z.infer<typeof anyObject>>(
    { integrationType: 'WEBHOOK', signatureProvider, schema: anyObject },
    async ({ payload, integration }) => {
      const mapped = map(payload);
      if (!mapped) return { action: 'change_ignored' };
      const result = await recordIntegrationChange(integration, mapped);
      return { action: result.status === 'created' ? 'change_recorded' : 'change_duplicate' };
    }
  );
}
