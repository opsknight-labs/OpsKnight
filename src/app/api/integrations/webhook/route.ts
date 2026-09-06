import { processEvent } from '@/lib/events';
import { transformWebhookToEvent, WebhookPayload } from '@/lib/integrations/webhook';
import { createIntegrationHandler } from '@/lib/integrations/handler';

/**
 * Generic Webhook Endpoint
 * POST /api/integrations/webhook?integrationId=xxx
 *
 * Industry-standard implementation:
 * - Rate limiting (100 req/min)
 * - HMAC signature verification (if secret configured)
 * - Flexible payload validation (allows most JSON)
 */
export const POST = createIntegrationHandler<WebhookPayload>(
  {
    integrationType: 'WEBHOOK',
    signatureProvider: 'generic', // Uses generic HMAC verification
  },
  async ({ payload, integration }) => {
    // Transform to standard event format
    // Generic webhooks use a flexible config (currently empty default)
    const event = transformWebhookToEvent(payload, {});

    // Process the event
    const result = await processEvent(event, integration.serviceId, integration.id);

    return { action: result.action, incident: result.incident };
  }
);
