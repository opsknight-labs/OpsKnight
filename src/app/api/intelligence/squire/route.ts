import type { NextRequest } from 'next/server';
import { jsonError } from '@/lib/api-response';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { squireRequestSchema, type SquireEvent } from '@/lib/intelligence/squire/contract';
import { getHistoryStatus, recordExchange } from '@/lib/intelligence/conversations/store';
import { readIncidentForActor } from '@/lib/intelligence/squire/deterministic';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 65_536;

const deny = (status: number, error: string) =>
  jsonError(error, status, undefined, { 'Cache-Control': 'no-store' });

/**
 * POST /api/intelligence/squire: one assistant turn, streamed as newline-delimited JSON events.
 * Authenticated by the session. Cross-site use is refused three ways: browsers send `Sec-Fetch-Site`, which
 * page script cannot forge and proxies do not change (comparing `Origin` with the server's own idea of its
 * origin breaks behind a reverse proxy); a JSON body needs a CORS preflight that is never granted; and the
 * session cookie is SameSite=Lax. Conversations live in the browser unless an administrator has turned
 * on saved history; then each completed answer is stored, encrypted, for the person who asked only.
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

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return deny(413, 'Request is too large');
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return deny(413, 'Request is too large');
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
  const [history, savedIncident] = await Promise.all([
    getHistoryStatus().catch(() => ({ enabled: false, retentionDays: 0 })),
    // A saved conversation only ever links to an incident the person can read.
    parsed.data.incidentId
      ? readIncidentForActor(actor, parsed.data.incidentId).catch(() => null)
      : Promise.resolve(null),
  ]);
  let answer = '';
  let failed = false;

  /** Saving is best effort: the person already has the answer, so a storage failure only loses history. */
  const save = async (): Promise<SquireEvent | null> => {
    if (!history.enabled || failed || controller.signal.aborted || !answer.trim()) return null;
    try {
      const id = await recordExchange({
        userId: actor.id,
        conversationId: parsed.data.conversationId,
        incidentId: savedIncident?.id,
        question: parsed.data.message,
        answer,
      });
      return { type: 'conversation', id };
    } catch (error) {
      logger.warn('[Squire] Could not save the conversation', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      const next = await events.next();
      if (next.done) {
        const saved = await save();
        if (saved) streamController.enqueue(encoder.encode(`${JSON.stringify(saved)}\n`));
        streamController.close();
        return;
      }
      if (next.value.type === 'delta') answer += next.value.text;
      else if (next.value.type === 'error') failed = true;
      streamController.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
    },
    async cancel() {
      controller.abort();
      // Let the turn finish its own cleanup (usage accounting, spans) instead of being abandoned mid-await.
      await events.return(undefined).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      // Proxies such as nginx buffer responses by default, which would hold back the answer until it ends.
      'X-Accel-Buffering': 'no',
    },
  });
}
