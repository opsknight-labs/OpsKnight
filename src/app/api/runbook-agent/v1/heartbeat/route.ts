import { z } from 'zod';
import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { recordAgentHeartbeat } from '@/lib/runbooks/agent-claims';

const schema = z
  .object({
    hostname: z.string().trim().min(1).max(255).optional(),
    version: z.string().trim().min(1).max(100),
    platform: z.string().trim().min(1).max(100),
    labels: z.record(z.string(), z.string().max(200)).optional(),
    capabilities: z.array(z.string().max(100)).max(100).optional(),
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
