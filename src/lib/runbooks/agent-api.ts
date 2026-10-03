import 'server-only';

import { NextResponse } from 'next/server';
import { authenticateAgentRequest } from './agent-auth';

export async function authenticatedAgentJson(request: Request) {
  const rawBody = await request.text();
  const agent = await authenticateAgentRequest(request, rawBody);
  let json: unknown = {};
  if (rawBody) {
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new Error('Request body must be valid JSON.');
    }
  }
  return { agent, json };
}

export function agentApiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Agent request failed.';
  const unauthorized = /auth|signature|replay|revoked|enrollment|lease/i.test(message);
  return NextResponse.json(
    { error: unauthorized ? 'Agent authentication or lease validation failed.' : message },
    { status: unauthorized ? 401 : 400 }
  );
}
