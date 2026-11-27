import 'server-only';
import prisma from '@/lib/prisma';
import { isAppRole } from '@/lib/authorization';
import { resolveUserActor } from '@/lib/authorization-actors';
import { streamSquire } from '../squire/chat';
import { readIncidentForActor } from '../squire/deterministic';
import {
  BACKGROUND_LIMITS,
  completeTurn,
  failTurn,
  finish,
  readRequest,
  runningBackgroundTurns,
  titleOf,
  type BackgroundFailure,
} from './background';
import { getHistoryStatus } from './store';
import { SquireTurnRecorder } from './turn-record';
import { warnAndContinue } from './warn';

/**
 * Runs answers left to finish in the background (see background.ts) in the web server process: one is
 * started as soon as it is handed over, and whenever someone opens their list of background answers any a
 * restart left queued are picked up. The jobs runner only tidies up, so its bundle stays free of the
 * assistant.
 */

const running = runningBackgroundTurns;
let starting: Promise<number> | null = null;

/**
 * Claims queued answers while this process has room and runs them; returns how many it started. Any process
 * may call it: a claim is a conditional update, so each answer runs exactly once.
 */
export function startBackgroundTurns(): Promise<number> {
  // A start requested while a claim pass is already past its last look must not be lost: ask for one more pass.
  if (starting) {
    again = true;
    return starting;
  }
  starting = (async () => {
    let total = 0;
    do {
      again = false;
      total += await claimAndRun();
    } while (again);
    return total;
  })().finally(() => {
    starting = null;
  });
  return starting;
}
let again = false;

async function claimAndRun(): Promise<number> {
  let started = 0;
  while (running.size < BACKGROUND_LIMITS.concurrentPerProcess) {
    const next = await prisma.squireBackgroundTurn.findFirst({
      where: { status: 'QUEUED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!next) break;
    const claimed = await prisma.squireBackgroundTurn.updateMany({
      where: { id: next.id, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    // Another process took it first; look again.
    if (claimed.count !== 1) continue;
    const controller = new AbortController();
    const done = runClaimed(next.id, controller)
      .catch(error => failTurn(next.id, 'ERROR', error))
      .finally(() => {
        running.delete(next.id);
        void startBackgroundTurns().catch(
          warnAndContinue('Could not start the next background answer')
        );
      });
    running.set(next.id, { controller, done });
    started += 1;
  }
  return started;
}

/** Test hook: waits for every answer this process is running. */
export async function settleBackgroundTurns(): Promise<void> {
  while (starting || running.size) {
    await starting;
    await Promise.all([...running.values()].map(entry => entry.done));
  }
}

async function runClaimed(id: string, controller: AbortController): Promise<void> {
  const row = await prisma.squireBackgroundTurn.findUnique({
    where: { id },
    select: { userId: true, requestEncrypted: true },
  });
  if (!row) return;
  const request = await readRequest(row.requestEncrypted);
  if (!request) return failTurn(id, 'ERROR');
  const title = titleOf(request.message);

  // The person as they are now, not as they were when they asked.
  const actor = await resolveUserActor(row.userId);
  if (!actor || actor.status !== 'ACTIVE' || !isAppRole(actor.role)) {
    // Nobody to tell: the account can no longer sign in to read a notification.
    await finish(id, 'FAILED', { failure: 'ACCESS_LOST' });
    return;
  }
  if (!(await getHistoryStatus()).enabled) return failTurn(id, 'HISTORY_OFF');

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, BACKGROUND_LIMITS.runMs);
  // A cancel from another process (or the row's removal) is seen within a few seconds.
  const watch = setInterval(() => {
    void prisma.squireBackgroundTurn
      .findUnique({ where: { id }, select: { status: true } })
      .then(current => {
        if (current?.status !== 'RUNNING') controller.abort();
      })
      .catch(() => undefined);
  }, BACKGROUND_LIMITS.cancelCheckMs);
  const turn = new SquireTurnRecorder();
  const events = streamSquire(actor, request, controller.signal);
  try {
    for await (const event of events) {
      turn.observe(event);
      if (controller.signal.aborted) break;
    }
  } finally {
    clearTimeout(timer);
    clearInterval(watch);
    if (controller.signal.aborted) await events.return(undefined).catch(() => undefined);
  }

  if (controller.signal.aborted && !timedOut) return; // Cancelled: nothing is saved.
  const answered = turn.completed && !turn.failed && !timedOut && !turn.empty;
  if (!answered && turn.empty) return failTurn(id, timedOut ? 'TIMED_OUT' : 'NO_ANSWER');

  const incident = request.incidentId
    ? await readIncidentForActor(actor, request.incidentId).catch(() => null)
    : null;
  const conversationId = await turn.save({
    userId: row.userId,
    request,
    incidentId: incident?.id,
    completion: answered ? 'COMPLETED' : 'INTERRUPTED',
  });
  const failure: BackgroundFailure | undefined = answered
    ? undefined
    : timedOut
      ? 'TIMED_OUT'
      : 'NO_ANSWER';
  await completeTurn(id, row.userId, title, { conversationId, failure });
}
