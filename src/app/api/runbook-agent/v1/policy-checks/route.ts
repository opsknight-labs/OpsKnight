import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { pendingAgentPolicyChecks, submitPolicyCheck } from '@/lib/runbooks/policy-checks';
import { z } from 'zod/v3';
export async function POST(request: Request) {
  try {
    const { agent, json } = await authenticatedAgentJson(request, 64 * 1024);
    const input = z.object({ result: z.unknown().optional() }).strict().parse(json);
    if (input.result !== undefined) return jsonOk(await submitPolicyCheck(agent.id, input.result));
    return jsonOk({ checks: await pendingAgentPolicyChecks(agent.id) });
  } catch (error) {
    return agentApiError(error);
  }
}
