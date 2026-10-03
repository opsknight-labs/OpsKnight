import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticatedAgentJson, agentApiError } from '@/lib/runbooks/agent-api';
import { renewAgentAttemptLease } from '@/lib/runbooks/agent-claims';

const schema = z.object({ leaseToken: z.string().min(20).max(512) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, { agent, json }] = await Promise.all([
      context.params,
      authenticatedAgentJson(request),
    ]);
    const { leaseToken } = schema.parse(json);
    return NextResponse.json(
      await renewAgentAttemptLease({
        attemptId: z.string().cuid().parse(id),
        agentId: agent.id,
        leaseToken,
      })
    );
  } catch (error) {
    return agentApiError(error);
  }
}
