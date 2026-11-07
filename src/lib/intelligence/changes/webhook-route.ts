import { z } from 'zod/v3';
import { createIntegrationHandler } from '@/lib/integrations/handler';
import { recordChange } from '@/lib/intelligence/changes/service';
import type { MappedChange } from './mappers';

const anyObject = z.object({}).passthrough();

/**
 * Builds a change-source webhook route: authenticated exactly like the generic change endpoint
 * (integration key, optional HMAC, rate limit, delivery de-duplication, generic webhook integration),
 * scoped to the integration's service, and mapped by a pure function. Records evidence only: never an
 * alert, never an incident, never the paging path.
 */
export function changeWebhookRoute(map: (payload: unknown) => MappedChange | null) {
  return createIntegrationHandler<z.infer<typeof anyObject>>(
    { integrationType: 'WEBHOOK', signatureProvider: 'generic', schema: anyObject },
    async ({ payload, integration }) => {
      const mapped = map(payload);
      if (!mapped) return { action: 'change_ignored' };
      const result = await recordChange({ serviceId: integration.serviceId, ...mapped });
      return { action: result.status === 'created' ? 'change_recorded' : 'change_duplicate' };
    }
  );
}
