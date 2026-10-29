import type { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { jsonError, jsonOk } from '@/lib/api-response';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { checkRateLimit } from '@/lib/rate-limit';
import { executeSquireAction } from '@/lib/intelligence/squire/actions/execute';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16_384;
const bodySchema = z.object({ token: z.string().min(1).max(8_192) }).strict();

const deny = (status: number, error: string) =>
  jsonError(error, status, undefined, { 'Cache-Control': 'no-store' });

/**
 * POST /api/intelligence/squire/actions: runs one assistant suggestion the signed-in person confirmed.
 * Session-authenticated, same-origin browsers only (never API keys), like the chat endpoint. The body carries
 * only the sealed proposal; what runs is decided by the server from it, under the person's own permissions.
 */
export async function POST(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return deny(403, 'Cross-site requests are not allowed');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return deny(415, 'Send application/json');
  }

  let actor;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch {
    return deny(401, 'Sign in to use the assistant');
  }
  const rate = await checkRateLimit(`squire:action:${actor.id}`, 30, 60_000);
  if (!rate.allowed) return deny(429, 'Too many requests. Try again in a minute.');

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return deny(413, 'Request is too large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return deny(400, 'Invalid JSON');
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return deny(400, 'Invalid request');

  const result = await executeSquireAction(actor, parsed.data.token);
  return jsonOk(result, result.ok ? 200 : 422, { 'Cache-Control': 'no-store' });
}
