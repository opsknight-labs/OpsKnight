import { z } from 'zod';

export const suggestionPlanSchema = z
  .object({
    inputValues: z.record(z.string(), z.unknown()),
    agentId: z.string().nullable(),
    agentPoolId: z.string().nullable(),
    definitionChecksum: z.string().length(64),
  })
  .strict();
