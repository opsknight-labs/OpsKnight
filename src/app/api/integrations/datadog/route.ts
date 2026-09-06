import { processEvent } from '@/lib/events';
import { transformDatadogToEvent, DatadogEvent } from '@/lib/integrations/datadog';
import { createIntegrationHandler } from '@/lib/integrations/handler';

/**
 * Datadog Webhook Endpoint
 * POST /api/integrations/datadog?integrationId=xxx
 *
 * Industry-standard implementation:
 * - Strict schema validation (Datadog payloads must be valid)
 * - Rate limiting (prevent DOS)
 * - Standardized logging and metrics
 */
export const POST = createIntegrationHandler<DatadogEvent>(
  {
    integrationType: 'DATADOG',
    // Datadog webhooks don't sign requests by default, relying on the capability URL (integrationId).
    // The handler automatically validates the integrationId.
  },
  async ({ payload, integration }) => {
    // Transform to standard event format
    const events = transformDatadogToEvent(payload);

    // Process all events
    const results = await Promise.all(
      events.map(event => processEvent(event, integration.serviceId, integration.id))
    );

    return { action: results[0]?.action || 'acknowledge', incident: results[0]?.incident };
  }
);
