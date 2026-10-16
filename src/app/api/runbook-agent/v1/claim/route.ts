import { setTimeout as sleep } from 'node:timers/promises';
import { mayHaveAgentWork } from '@/lib/runbooks/claim-availability';
import { NextResponse } from 'next/server';
import { jsonOk } from '@/lib/api-response';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { claimAgentAttempt } from '@/lib/runbooks/agent-claims';
import { hasConfidentialAgentTransport } from '@/lib/runbooks/agent-transport';

export async function POST(request: Request) {
  try {
    const { agent } = await authenticatedAgentJson(request, 4 * 1024);
    if (request.signal.aborted) return new NextResponse(null, { status: 204 });
    const url = new URL(request.url);
    const waitSeconds = Math.min(
      25,
      Math.max(0, Number.parseInt(url.searchParams.get('waitSeconds') ?? '0', 10) || 0)
    );
    const mode = url.searchParams.get('mode');
    const readOnlyOnly = mode === 'READ_ONLY_ONLY';
    const deadline = Date.now() + waitSeconds * 1000;
    const confidentialTransport = hasConfidentialAgentTransport(request);
    const claim = async () => {
      if (request.signal.aborted || !(await mayHaveAgentWork()) || request.signal.aborted)
        return null;
      return claimAgentAttempt(agent.id, confidentialTransport, { readOnlyOnly });
    };
    let attempt = await claim();
    while (!attempt && Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || request.signal.aborted) break;
      await sleep(Math.min(remaining, 2_000 + Math.floor(Math.random() * 3_001)), undefined, {
        signal: request.signal,
      });
      if (!request.signal.aborted) attempt = await claim();
    }
    return attempt ? jsonOk({ attempt }) : new NextResponse(null, { status: 204 });
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 204 });
    return agentApiError(error);
  }
}
