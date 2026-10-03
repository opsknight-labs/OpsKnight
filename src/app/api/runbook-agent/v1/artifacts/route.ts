import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { storeAgentArtifact } from '@/lib/runbooks/agent-claims';
import { agentArtifactSchema } from '@/lib/runbooks/schemas';

export async function POST(request: Request) {
  try {
    const { agent, json } = await authenticatedAgentJson(request);
    return jsonOk(await storeAgentArtifact(agent.id, agentArtifactSchema.parse(json)), 201);
  } catch (error) {
    return agentApiError(error);
  }
}
