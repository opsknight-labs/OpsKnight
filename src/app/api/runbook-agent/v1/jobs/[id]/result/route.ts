import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { submitAgentResult } from '@/lib/runbooks/agent-claims';
import { agentJobResultSchema } from '@/lib/runbooks/schemas';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, { agent, json }] = await Promise.all([
      context.params,
      authenticatedAgentJson(request),
    ]);
    const payload = agentJobResultSchema.parse({
      ...(json as Record<string, unknown>),
      attemptId: id,
    });
    return jsonOk(await submitAgentResult(agent.id, payload));
  } catch (error) {
    return agentApiError(error);
  }
}
