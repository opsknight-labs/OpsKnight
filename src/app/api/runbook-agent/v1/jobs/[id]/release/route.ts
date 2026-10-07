import { z } from 'zod';
import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { releaseAgentClaim } from '@/lib/runbooks/agent-claims';

const schema = z.object({ leaseToken: z.string().min(20).max(512) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, { agent, json }] = await Promise.all([
      context.params,
      authenticatedAgentJson(request),
    ]);
    const { leaseToken } = schema.parse(json);
    const result = await releaseAgentClaim({
      attemptId: z.string().cuid().parse(id),
      agentId: agent.id,
      leaseToken,
    });
    return jsonOk(result);
  } catch (error) {
    return agentApiError(error);
  }
}
