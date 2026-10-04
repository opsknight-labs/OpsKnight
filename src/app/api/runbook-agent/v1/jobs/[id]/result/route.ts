import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { submitAgentResult } from '@/lib/runbooks/agent-claims';
import { agentJobResultSchema } from '@/lib/runbooks/schemas';
import { signExecutionEnvelope } from '@/lib/runbooks/execution-signing';
import { sha256 } from '@/lib/runbooks/agent-auth';

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
    return jsonOk(
      await signExecutionEnvelope({
        ...(await submitAgentResult(agent.id, payload)),
        attemptId: id,
        signingAgentId: agent.id,
        leaseTokenHash: sha256(payload.leaseToken),
      })
    );
  } catch (error) {
    return agentApiError(error);
  }
}
