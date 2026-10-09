import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { storeAgentArtifact } from '@/lib/runbooks/agent-claims';
import { agentArtifactSchema } from '@/lib/runbooks/schemas';
import { signExecutionEnvelope } from '@/lib/runbooks/execution-signing';
import { sha256 } from '@/lib/runbooks/agent-auth';

export async function POST(request: Request) {
  try {
    const { agent, json } = await authenticatedAgentJson(request, 15 * 1024 * 1024);
    const payload = agentArtifactSchema.parse(json);
    return jsonOk(
      await signExecutionEnvelope({
        ...(await storeAgentArtifact(agent.id, payload)),
        attemptId: payload.attemptId,
        signingAgentId: agent.id,
        leaseTokenHash: sha256(payload.leaseToken),
      }),
      201
    );
  } catch (error) {
    return agentApiError(error);
  }
}
