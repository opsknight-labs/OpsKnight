import type { NextRequest } from 'next/server';
import type {
  SavedTurnInput,
  SavedActionReference,
} from '@/lib/intelligence/conversations/contract';
import { jsonError } from '@/lib/api-response';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { squireRequestSchema, type SquireEvent } from '@/lib/intelligence/squire/contract';
import { getHistoryStatus, recordExchange } from '@/lib/intelligence/conversations/store';
import { readIncidentForActor } from '@/lib/intelligence/squire/deterministic';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 65_536;
const PING_MS = 10_000;

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

  if (actor.apiKey) return deny(403, 'The assistant is only available in the app');
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return deny(413, 'Request is too large');
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BODY_BYTES) {
          await reader.cancel();
          return deny(413, 'Request is too large');
        }
        chunks.push(value);
      }
    } catch {
      return deny(400, 'Could not read request');
    } finally {
      reader.releaseLock();
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8');
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
  let answer = '';
  let failed = false;
  let completed = false;
  let memory: SavedTurnInput | undefined;
  const notices: string[] = [];
  const actions: SavedActionReference[] = [];
  let citations: Extract<SquireEvent, { type: 'citations' }>['items'] = [];
  let saved = false;

  /** Saving is best effort: the person already has the answer, so a storage failure only loses history. */
  const save = async (
    completion: 'COMPLETED' | 'INTERRUPTED' = 'COMPLETED'
  ): Promise<SquireEvent | null> => {
    if (completion === 'COMPLETED' && (failed || !completed || controller.signal.aborted))
      return null;
    if (saved || (!answer.trim() && actions.length === 0)) return null;
    saved = true;
    // Persistence lookups do not delay the first answer token.
    const [history, savedIncident] = await Promise.all([
      getHistoryStatus().catch(() => ({ enabled: false, retentionDays: 0 })),
      parsed.data.incidentId
        ? readIncidentForActor(actor, parsed.data.incidentId).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (!history.enabled) return null;
    try {
      const id = await recordExchange({
        userId: actor.id,
        conversationId: parsed.data.conversationId,
        incidentId: savedIncident?.id,
        question: parsed.data.message,
        answer: answer.trim() ? answer : 'Review the suggested action.',
        dataClass: memory?.dataClass,
        turn: {
          ...memory,
          // An interrupted answer is kept as the person's record but never replayed to the model.
          ...(completion === 'INTERRUPTED' ? { verified: false } : {}),
          context: savedIncident
            ? { kind: 'incident', id: savedIncident.id }
            : parsed.data.pageContext,
          completion,
          citations,
          actions,
          notices: [...new Set([...(memory?.notices ?? []), ...notices])].slice(0, 4),
        },
      });
      return { type: 'conversation', id };
    } catch (error) {
      logger.warn('[Squire] Could not save the conversation', {
        error: error instanceof Error ? error.name : 'error',
      });
      return {
        type: 'notice',
        text: 'This answer could not be saved to history. Copy it before leaving this chat.',
      };
    }
  };

  // A ping every few seconds while tools run keeps proxies from closing a quiet stream and lets the
  // client tell a slow answer from a stalled one.
  let pending: ReturnType<typeof events.next> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      for (;;) {
        pending ??= events.next();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const next = await Promise.race([
          pending,
          new Promise<'ping'>(resolve => {
            timer = setTimeout(() => resolve('ping'), PING_MS);
          }),
        ]).finally(() => clearTimeout(timer));
        if (next === 'ping') {
          streamController.enqueue(encoder.encode('{"type":"ping"}\n'));
          return;
        }
        pending = null;
        if (next.done) {
          const saved = await save();
          if (saved) streamController.enqueue(encoder.encode(`${JSON.stringify(saved)}\n`));
          streamController.close();
          return;
        }
        const event = next.value;
        if (event.type === 'memory') {
          memory = event.turn;
          continue;
        }
        if (event.type === 'delta') answer += event.text;
        else if (event.type === 'error') failed = true;
        else if (event.type === 'done') completed = true;
        else if (event.type === 'notice' && notices.length < 4)
          notices.push(event.text.slice(0, 1_000));
        else if (event.type === 'citations') citations = event.items.slice(0, 8);
        else if (
          event.type === 'proposal' &&
          event.proposal.kind === 'WRITE' &&
          event.proposal.receiptId &&
          actions.length < 2
        )
          actions.push({
            receiptId: event.proposal.receiptId,
            action: event.proposal.action,
            title: event.proposal.title,
            incidentId: event.proposal.incidentId,
          });
        streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        return;
      }
    },
    async cancel() {
      controller.abort();
      // Let the turn finish its own cleanup (usage accounting, spans) instead of being abandoned mid-await.
      await events.return(undefined).catch(() => undefined);
      // The person left (reload, closed tab, lost network): keep what was already written.
      // Not awaited: a slow history lookup must not hold the cancelled stream open.
      void save('INTERRUPTED').catch(() => undefined);
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
