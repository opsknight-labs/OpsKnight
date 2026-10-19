import { z } from 'zod';

export const suggestionPlanSchema = z
  .object({
    inputValues: z.record(z.string(), z.unknown()),
    agentId: z.string().nullable(),
    agentPoolId: z.string().nullable(),
    agentSelector: z.record(z.string(), z.string()).optional(),
    definitionChecksum: z.string().length(64),
    matchReason: z.string().max(4000).optional(),
    configRevision: z.number().int().optional(),
    contextChecksum: z.string().nullable().optional(),
    evaluationSource: z.enum(['MONITORING', 'MANUAL']).optional(),
    inputProvenance: z.record(z.string(), z.unknown()).optional(),
    targetProvenance: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
