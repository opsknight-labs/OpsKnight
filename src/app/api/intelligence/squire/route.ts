import type { NextRequest } from 'next/server';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import { readSquireRequest } from '@/lib/intelligence/squire/request';
import { getHistoryStatus } from '@/lib/intelligence/conversations/store';
import { SquireTurnRecorder } from '@/lib/intelligence/conversations/turn-record';
import {
  BACKGROUND_LIMITS,
  completeTurn,
  hasBackgroundHandOff,
  liveTurnKey,
  liveTurns,
  runningBackgroundTurns,
  titleOf,
} from '@/lib/intelligence/conversations/background';
import { startBackgroundTurns } from '@/lib/intelligence/conversations/background-run';
import { readIncidentForActor } from '@/lib/intelligence/squire/deterministic';
import { logger } from '@/lib/logger';
import { warnAndContinue } from '@/lib/intelligence/conversations/warn';

export const dynamic = 'force-dynamic';

const PING_MS = 10_000;
/** A hand-off sent as the tab closes can land just after this stream is cut; wait this long for it. */
const HANDOFF_GRACE_MS = 1_500;

/**
 * POST /api/intelligence/squire: one assistant turn, streamed as newline-delimited JSON events.
 * Authenticated by the session and refused cross-site (see `readSquireRequest`). Conversations live in the
 * browser unless an administrator has turned on saved history; then each completed answer is stored,
 * encrypted, for the person who asked only.
 */
export async function POST(request: NextRequest) {
  const read = await readSquireRequest(request);
  if (read instanceof Response) return read;
  const { actor, data: body } = read;
  // Any use of the assistant also picks up queued background answers left behind by a restart.
  void startBackgroundTurns().catch(warnAndContinue('Could not start queued background answers'));

  const startedAt = new Date();
  const controller = new AbortController();
  /** Set when the person hands this turn to the background: it then runs to the end here, without them. */
  let handOff: Promise<string | null> | null = null;
  let timedOut = false;
  let ended!: () => void;
  const done = new Promise<void>(resolve => (ended = resolve));
  const liveKey = liveTurnKey(actor.id, body);
  const adopt = (row: Promise<string | null>) => {
    handOff = row;
    void row.then(id => id && runningBackgroundTurns.set(id, { controller, done }));
  };
  const unlist = () => {
    if (liveTurns.get(liveKey) === adopt) liveTurns.delete(liveKey);
  };
  liveTurns.set(liveKey, adopt);
  request.signal.addEventListener(
    'abort',
    () => {
      if (handOff) return;
      unlist();
      controller.abort();
    },
    { once: true }
  );
  const encoder = new TextEncoder();
  const events = streamSquire(actor, body, controller.signal);
  const turn = new SquireTurnRecorder();
  let saved = false;

  /** Saving is best effort: the person already has the answer, so a storage failure only loses history. */
  const save = async (
    completion: 'COMPLETED' | 'INTERRUPTED' = 'COMPLETED'
  ): Promise<SquireEvent | null> => {
    if (completion === 'COMPLETED' && (turn.failed || !turn.completed || controller.signal.aborted))
      return null;
    if (saved || turn.empty) return null;
    saved = true;
    // Persistence lookups do not delay the first answer token.
    const [history, savedIncident] = await Promise.all([
      getHistoryStatus().catch(() => ({ enabled: false, retentionDays: 0 })),
      body.incidentId
        ? readIncidentForActor(actor, body.incidentId).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (!history.enabled) return null;
    try {
      const id = await turn.save({
        userId: actor.id,
        request: body,
        incidentId: savedIncident?.id,
        completion,
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

  // A ping every few seconds while tools run (or the answer is being saved) keeps proxies from closing a
  // quiet stream and lets the client tell a slow answer from a stalled one.
  const orPing = <T>(work: Promise<T>): Promise<T | 'ping'> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      work,
      new Promise<'ping'>(resolve => {
        timer = setTimeout(() => resolve('ping'), PING_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  };
  const PING = encoder.encode('{"type":"ping"}\n');
  let pending: ReturnType<typeof events.next> | null = null;
  let finishing: Promise<SquireEvent | null> | null = null;
  let cancelled = false;

  /** Saves the turn once, however it ended, and settles the background answer it was handed to. */
  const end = (completion?: 'COMPLETED' | 'INTERRUPTED' | 'CANCELLED') =>
    (finishing ??= (completion === 'CANCELLED' ? Promise.resolve(null) : save(completion)).then(
      async event => {
        unlist();
        const id = await handOff;
        if (id) {
          const conversationId = event?.type === 'conversation' ? event.id : null;
          await completeTurn(id, actor.id, titleOf(body.message), {
            conversationId,
            failure: timedOut
              ? 'TIMED_OUT'
              : conversationId && turn.completed && !turn.failed
                ? undefined
                : 'NO_ANSWER',
          }).catch(warnAndContinue('Could not record the end of an answer'));
          runningBackgroundTurns.delete(id);
        }
        ended();
        return event;
      }
    ));

  /** The person left after handing the turn over: finish it here, within the background time limit. */
  const drain = async (inFlight: typeof pending) => {
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, BACKGROUND_LIMITS.runMs);
    // A turn that ignores the abort still ends at the deadline.
    const stopped = new Promise<IteratorReturnResult<undefined>>(resolve => {
      const stop = () => resolve({ done: true, value: undefined });
      if (controller.signal.aborted) stop();
      controller.signal.addEventListener('abort', stop, { once: true });
    });
    try {
      for (let next = inFlight ?? events.next(); ; next = events.next()) {
        const result = await Promise.race([next, stopped]);
        if (result.done) break;
        turn.observe(result.value);
      }
    } catch {
      turn.failed = true;
    } finally {
      clearTimeout(deadline);
    }
    if (controller.signal.aborted) void events.return(undefined).catch(() => undefined);
    // Aborted without the deadline: the person cancelled the background answer, so nothing is saved.
    await end(
      controller.signal.aborted && !timedOut
        ? 'CANCELLED'
        : turn.completed && !turn.failed && !timedOut
          ? 'COMPLETED'
          : 'INTERRUPTED'
    );
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      for (;;) {
        if (finishing) {
          const saved = await orPing(finishing);
          if (cancelled) return;
          if (saved === 'ping') {
            streamController.enqueue(PING);
            return;
          }
          if (saved) streamController.enqueue(encoder.encode(`${JSON.stringify(saved)}\n`));
          streamController.close();
          return;
        }
        pending ??= events.next();
        const next = await orPing(pending);
        // Cancelled meanwhile: the event belongs to whoever finishes the turn now.
        if (cancelled) return;
        if (next === 'ping') {
          streamController.enqueue(PING);
          return;
        }
        pending = null;
        if (next.done) {
          end();
          continue;
        }
        const event = next.value;
        if (!turn.observe(event)) continue;
        streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        return;
      }
    },
    async cancel() {
      cancelled = true;
      if (handOff) {
        void drain(pending).catch(() => undefined);
        return;
      }
      unlist();
      controller.abort();
      // Let the turn finish its own cleanup (usage accounting, spans) instead of being abandoned mid-await.
      await events.return(undefined).catch(() => undefined);
      // The person left (reload, closed tab, lost network): keep what was already written, unless they
      // handed the question to the background, which saves the whole answer instead of a cut-off copy.
      // Not awaited: a slow history lookup must not hold the cancelled stream open. A first turn (no
      // conversation id yet) is not saved: it would create a conversation the client never learns about.
      if (turn.empty || !body.conversationId) return;
      void (async () => {
        await new Promise(resolve => setTimeout(resolve, HANDOFF_GRACE_MS));
        if (await hasBackgroundHandOff(actor.id, body.conversationId, startedAt).catch(() => false))
          return;
        await save('INTERRUPTED');
      })().catch(() => undefined);
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
