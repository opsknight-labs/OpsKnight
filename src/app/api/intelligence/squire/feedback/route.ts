import type { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { readJsonBodyWithLimit, RequestBodyTooLargeError } from '@/lib/request-body';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { checkRateLimit } from '@/lib/rate-limit';
import { feedbackInputSchema, recordFeedback } from '@/lib/intelligence/squire/feedback';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8_192;
const deny = (status: number, error: string) =>
  jsonError(error, status, undefined, { 'Cache-Control': 'no-store' });

/**
 * POST /api/intelligence/squire/feedback: a thumbs up or down for one answer. Session-authenticated,
 * same-origin only, like the chat endpoint. Nothing about the answer text is stored.
 */
export async function POST(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    return deny(403, 'Cross-site requests are not allowed');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return deny(415, 'Send application/json');
  let actor;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch {
    return deny(401, 'Sign in to use the assistant');
  }
  if (actor.apiKey) return deny(403, 'Feedback is only available in the app');
  const rate = await checkRateLimit(`squire:feedback:${actor.id}`, 60, 60_000);
  if (!rate.allowed) return deny(429, 'Too many requests. Try again in a minute.');
  let body: unknown;
  try {
    body = await readJsonBodyWithLimit(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return deny(413, 'Request is too large');
    return deny(400, 'Invalid JSON');
  }
  const parsed = feedbackInputSchema.safeParse(body);
  if (!parsed.success) return deny(400, 'Invalid request');
  const id = await recordFeedback(actor.id, parsed.data);
  return jsonOk({ id }, 201, { 'Cache-Control': 'no-store' });
}
