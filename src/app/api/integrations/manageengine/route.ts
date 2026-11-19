import { z } from 'zod/v3';
import { createIntegrationHandler } from '@/lib/integrations/handler';
import { processIntegrationBatch, processIntegrationEvent } from '@/lib/events';
import {
  transformManageEngineToEvent,
  parseManageEngineAlarms,
  ManageEngineEvent,
} from '@/lib/integrations/manageengine';
import { ManageEnginePayloadSchema } from '@/lib/integrations/schemas';

// A JSON array body is a batch; every alarm in it becomes its own event.
export const POST = createIntegrationHandler<ManageEngineEvent[]>(
  {
    integrationType: 'MANAGEENGINE',
    signatureProvider: 'generic',
    parsePayload: parseManageEngineAlarms,
    schema: z.array(ManageEnginePayloadSchema).min(1) as z.ZodSchema<ManageEngineEvent[]>,
  },
  async ({ payload, integration }) => {
    const input = {
      serviceId: integration.serviceId,
      integrationId: integration.id,
      integrationType: 'MANAGEENGINE',
      receivedAt: new Date(),
    };
    if (payload.length === 1) {
      return processIntegrationEvent({
        ...input,
        providerPayload: payload[0],
        event: transformManageEngineToEvent(payload[0]),
      });
    }
    const results = await processIntegrationBatch(
      { ...input, providerPayload: payload },
      payload.map(alarm => transformManageEngineToEvent(alarm))
    );
    return { action: 'batch', results };
  }
);
