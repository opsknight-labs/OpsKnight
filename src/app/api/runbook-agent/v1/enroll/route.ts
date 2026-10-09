import { z } from 'zod';
import { jsonOk } from '@/lib/api-response';
import { consumeEnrollmentToken } from '@/lib/runbooks/agent-auth';
import { agentApiError, readBoundedRequestBody } from '@/lib/runbooks/agent-api';

const schema = z
  .object({
    token: z.string().min(20).max(512),
    publicKey: z.string().min(40).max(8192),
    hostname: z.string().trim().min(1).max(255).optional(),
    version: z.string().trim().min(1).max(100),
    platform: z.string().trim().min(1).max(100),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const rawBody = await readBoundedRequestBody(request, 16 * 1024);
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new Error('Request body must be valid JSON.');
    }
    const result = await consumeEnrollmentToken(schema.parse(json));
    return jsonOk({ agent: result, protocolVersion: 'v1' }, 201);
  } catch (error) {
    return agentApiError(error);
  }
}
