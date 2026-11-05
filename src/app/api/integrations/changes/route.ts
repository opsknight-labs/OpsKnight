import { z } from 'zod/v3';
import { createIntegrationHandler } from '@/lib/integrations/handler';
import { recordChange } from '@/lib/intelligence/changes/service';

/**
 * Change-event ingestion (deploys, config changes, feature flags, infrastructure changes).
 * POST /api/integrations/changes?integrationId=xxx
 *
 * Authenticated exactly like the generic webhook endpoint (integration key, optional HMAC, rate
 * limiting, delivery de-duplication) with a generic webhook integration. A change is scoped to that
 * integration's service; any serviceId in the body is ignored. It records evidence for probable-cause
 * analysis only: it never creates an alert or incident and never enters the paging path.
 */
const bodySchema = z
  .object({
    source: z.string().optional(),
    kind: z.string().optional(),
    summary: z.string().optional(),
    version: z.string().optional(),
    url: z.string().optional(),
    dedupKey: z.string().optional(),
    occurredAt: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export const POST = createIntegrationHandler<z.infer<typeof bodySchema>>(
  {
    integrationType: 'WEBHOOK',
    signatureProvider: 'generic',
    schema: bodySchema,
  },
  async ({ payload, integration }) => {
    const result = await recordChange({
      serviceId: integration.serviceId,
      source: payload.source ?? 'webhook',
      kind: (payload.kind ?? 'DEPLOY').toUpperCase() as 'DEPLOY',
      summary: payload.summary ?? '',
      version: payload.version,
      url: payload.url,
      dedupKey: payload.dedupKey,
      occurredAt:
        payload.occurredAt === undefined ? new Date() : (payload.occurredAt as string | number),
    });
    return { action: result.status === 'created' ? 'change_recorded' : 'change_duplicate' };
  }
);
