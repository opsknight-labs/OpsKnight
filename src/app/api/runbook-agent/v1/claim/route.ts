import { NextResponse } from 'next/server';
import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { claimAgentAttempt } from '@/lib/runbooks/agent-claims';

export async function POST(request: Request) {
  try {
    const { agent } = await authenticatedAgentJson(request);
    const attempt = await claimAgentAttempt(agent.id);
    return attempt ? jsonOk({ attempt }) : new NextResponse(null, { status: 204 });
  } catch (error) {
    return agentApiError(error);
  }
}
