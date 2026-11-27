import { jsonOk } from '@/lib/api-response';
import {
  BackgroundTurnRefused,
  enqueueBackgroundTurn,
  listBackgroundTurns,
} from '@/lib/intelligence/conversations/background';
import { startBackgroundTurns } from '@/lib/intelligence/conversations/background-run';
import { conversationActor, NO_STORE } from '@/lib/intelligence/conversations/http';
import { denySquire, readSquireRequest } from '@/lib/intelligence/squire/request';
import { warnAndContinue } from '@/lib/intelligence/conversations/warn';

export const dynamic = 'force-dynamic';

/**
 * POST: finish this question in the background (the same body, checks and limits as the chat route). The
 * answer is saved to the person's conversation and announced with an in-app notification. Also accepted
 * as a keepalive request sent while the tab closes. 202 with the background answer's id.
 */
export async function POST(request: Request) {
  const read = await readSquireRequest(request);
  if (read instanceof Response) return read;
  try {
    const queued = await enqueueBackgroundTurn(read.actor.id, read.data);
    // Started here, in this process; the jobs runner never runs answers.
    void startBackgroundTurns().catch(warnAndContinue('Could not start queued background answers'));
    return jsonOk(queued, 202, NO_STORE);
  } catch (error) {
    if (error instanceof BackgroundTurnRefused) return denySquire(error.status, error.message);
    throw error;
  }
}

/** GET: the signed-in person's background answers from the last day, newest first. */
export async function GET(request: Request) {
  const actor = await conversationActor(request);
  if (actor instanceof Response) return actor;
  // Someone is watching: pick up anything a restart left queued, without waiting for the jobs runner.
  void startBackgroundTurns().catch(warnAndContinue('Could not start queued background answers'));
  return jsonOk({ turns: await listBackgroundTurns(actor.id) }, 200, NO_STORE);
}
