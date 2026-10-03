import { NextResponse } from 'next/server';
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
    return NextResponse.json(await submitAgentResult(agent.id, payload));
  } catch (error) {
    return agentApiError(error);
  }
}
