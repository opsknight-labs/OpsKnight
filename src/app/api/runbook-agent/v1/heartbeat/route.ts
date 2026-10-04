import { z } from 'zod';
import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { recordAgentHeartbeat } from '@/lib/runbooks/agent-claims';
import { schedulingLabelsSchema } from '@/lib/runbooks/labels';

const schema = z
  .object({
    hostname: z.string().trim().min(1).max(255).optional(),
    version: z.string().trim().min(1).max(100),
    platform: z.string().trim().min(1).max(100),
    labels: schedulingLabelsSchema.optional(),
    capabilities: z.array(z.string().max(100)).max(100).optional(),
    capabilityReport: z
      .array(
        z
          .object({
            name: z.string().max(100),
            type: z.string().max(100),
            configured: z.boolean(),
            available: z.boolean(),
            reason: z.string().max(200).nullable(),
          })
          .strict()
      )
      .max(32)
      .optional(),
    trustedSigningKeys: z.array(z.string().max(100)).max(8).optional(),
    policyHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    spoolDepth: z.number().int().min(0).max(100000).optional(),
    deadLetterDepth: z.number().int().min(0).max(100000).optional(),
    activeAttemptCount: z.number().int().min(0).max(1000).optional(),
    lastError: z.string().max(1000).nullable().optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const { agent, json } = await authenticatedAgentJson(request);
    return jsonOk(await recordAgentHeartbeat({ agentId: agent.id, ...schema.parse(json) }));
  } catch (error) {
    return agentApiError(error);
  }
}
