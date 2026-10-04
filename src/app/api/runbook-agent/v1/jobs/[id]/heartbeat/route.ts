import { z } from 'zod';
import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { renewAgentAttemptLease } from '@/lib/runbooks/agent-claims';
import { signExecutionEnvelope } from '@/lib/runbooks/execution-signing';
import { sha256 } from '@/lib/runbooks/agent-auth';

const schema = z.object({ leaseToken: z.string().min(20).max(512) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, { agent, json }] = await Promise.all([
      context.params,
      authenticatedAgentJson(request),
    ]);
    const { leaseToken } = schema.parse(json);
    return jsonOk(
      await signExecutionEnvelope({
        ...(await renewAgentAttemptLease({
          attemptId: z.string().cuid().parse(id),
          agentId: agent.id,
          leaseToken,
        })),
        attemptId: id,
        signingAgentId: agent.id,
        leaseTokenHash: sha256(leaseToken),
      })
    );
  } catch (error) {
    return agentApiError(error);
  }
}
