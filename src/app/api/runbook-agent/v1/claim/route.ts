import { NextResponse } from 'next/server';
import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { claimAgentAttempt } from '@/lib/runbooks/agent-claims';

export async function POST(request: Request) {
  try {
    const { agent } = await authenticatedAgentJson(request);
    const waitSeconds = Math.min(
      25,
      Math.max(
        0,
        Number.parseInt(new URL(request.url).searchParams.get('waitSeconds') ?? '0', 10) || 0
      )
    );
    const deadline = Date.now() + waitSeconds * 1000;
    let attempt = await claimAgentAttempt(agent.id);
    while (!attempt && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2_000 + Math.floor(Math.random() * 3_001)));
      attempt = await claimAgentAttempt(agent.id);
    }
    return attempt ? jsonOk({ attempt }) : new NextResponse(null, { status: 204 });
  } catch (error) {
    return agentApiError(error);
  }
}
