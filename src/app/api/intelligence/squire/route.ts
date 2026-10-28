import type { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-response';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { squireRequestSchema } from '@/lib/intelligence/squire/contract';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32_768;

const deny = (status: number, error: string) => jsonError(error, status, undefined, { 'Cache-Control': 'no-store' });

/**
 * POST /api/intelligence/squire: one assistant turn, streamed as newline-delimited JSON events.
 * Authenticated by the session. Cross-site use is refused three ways: browsers send `Sec-Fetch-Site`, which
 * page script cannot forge and proxies do not change (comparing `Origin` with the server's own idea of its
 * origin breaks behind a reverse proxy); a JSON body needs a CORS preflight that is never granted; and the
 * session cookie is SameSite=Lax. The conversation lives in the browser: nothing is stored server-side.
 */
export async function POST(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return deny(403, 'Cross-site requests are not allowed');
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return deny(415, 'Send application/json');
  }

  let actor;
  try {
    actor = await getCurrentAuthorizationActor();
  } catch {
    return deny(401, 'Sign in to use the assistant');
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return deny(413, 'Request is too large');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return deny(400, 'Invalid JSON');
  }
  const parsed = squireRequestSchema.safeParse(body);
  if (!parsed.success) return deny(400, 'Invalid request');

  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort(), { once: true });
  const encoder = new TextEncoder();
  const events = streamSquire(actor, parsed.data, controller.signal);

  const stream = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      const next = await events.next();
      if (next.done) {
        streamController.close();
        return;
      }
      streamController.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
