import { z } from 'zod/v3';
import { snapshotSchema } from './contract';

export const automationSimulationEventSchema = z
  .object({
    event_action: z.enum(['trigger', 'resolve', 'acknowledge']),
    dedup_key: z.string().max(512),
    payload: z
      .object({
        summary: z.string().min(1).max(500),
        source: z.string().min(1).max(500),
        severity: z.enum(['critical', 'error', 'warning', 'info']),
        custom_details: z.unknown().optional(),
      })
      .strict(),
  })
  .strict();
export const automationSimulationSchema = z
  .object({
    snapshot: snapshotSchema,
    event: automationSimulationEventSchema,
    providerPayload: z.unknown().optional(),
    integrationType: z.string().min(1).max(64),
    integrationId: z.string().cuid().optional(),
    evaluationAt: z.string().datetime().optional(),
  })
  .strict();
