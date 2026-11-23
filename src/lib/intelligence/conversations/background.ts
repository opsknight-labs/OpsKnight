import 'server-only';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { acquireTextAdvisoryLocks } from '@/lib/db-locks';
import { decrypt, encrypt } from '@/lib/encryption';
import { createInAppNotifications } from '@/lib/in-app-notifications';
import { logger } from '@/lib/logger';
import { getAiSettings } from '../ai/settings';
import { squireRequestSchema, type SquireRequest } from '../squire/contract';
import { getHistoryStatus } from './store';

/**
 * Answers that finish in the background: storage, listing, cancelling and housekeeping. Running them is in
 * background-run.ts, which needs the whole assistant; this file stays small enough for the jobs runner.
 * When someone leaves an answer running (closes the tab, or asks
 * Squire to keep working), the question is stored encrypted, run again on the server as that person, saved to
 * their conversation history and announced with an in-app notification. Only with saved history on, since the
 * answer has nowhere else to go; only for the person who asked; at most three at a time per person.
 *
 * The person is resolved again when the answer starts, so someone who lost access (or was disabled) in the
 * meantime gets nothing, and every read inside the turn runs under their permissions as they are then.
 */

export const BACKGROUND_LIMITS = {
  /** Queued or running answers one person may have. */
  activePerPerson: 3,
  /** Answers one server process runs at once; the rest wait their turn. */
  concurrentPerProcess: 4,
  /** A turn that runs longer than this is stopped and kept as far as it got. */
  runMs: 10 * 60_000,
  /** A RUNNING row older than this belongs to a process that stopped (a restart or crash). */
  staleMs: 15 * 60_000,
  /**
   * A QUEUED row older than this never got a free slot (no web process picked it up, for example after a
   * restart with nobody using the assistant), so it is given up rather than left waiting for ever.
   */
  queuedMs: 60 * 60_000,
  /** How long finished answers stay in the launcher's list (and their stored questions are kept). */
  keepMs: 24 * 60 * 60_000,
  /** How often a running answer checks whether the person cancelled it from another server process. */
  cancelCheckMs: 5_000,
  listed: 20,
} as const;

type Status = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
const ACTIVE: Status[] = ['QUEUED', 'RUNNING'];

export type BackgroundFailure =
  | 'ACCESS_LOST'
  | 'HISTORY_OFF'
  | 'NO_ANSWER'
  | 'TIMED_OUT'
  | 'INTERRUPTED'
  | 'NOT_STARTED'
  | 'ERROR';

const FAILURE_TEXT: Record<BackgroundFailure, string> = {
  ACCESS_LOST: 'Your access changed before the answer started, so it was not run.',
  HISTORY_OFF: 'Saved conversations were turned off, so the answer had nowhere to go.',
  NO_ANSWER: 'The assistant could not finish this answer. Ask again in the chat.',
  TIMED_OUT:
    'The answer took too long and was stopped. What it found so far is in the conversation.',
  INTERRUPTED: 'The server restarted while answering. Ask again in the chat.',
  NOT_STARTED: 'The answer could not start in time. Ask again in the chat.',
  ERROR: 'Something went wrong while answering. Ask again in the chat.',
};

export class BackgroundTurnRefused extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'BackgroundTurnRefused';
  }
}

export interface BackgroundTurnView {
  id: string;
  title: string;
  status: Status;
  conversationId: string | null;
  failure: string | null;
  createdAt: string;
  completedAt: string | null;
}

export const titleOf = (question: string) => {
  const flat = question.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
};

export async function readRequest(encrypted: string): Promise<SquireRequest | null> {
  try {
    const parsed = squireRequestSchema.safeParse(JSON.parse(await decrypt(encrypted)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Stores a question to finish in the background. The request has already passed the chat route's checks
 * (`readSquireRequest`). Refuses with an explanation when saved history is off or the person already has
 * `activePerPerson` answers queued or running.
 */
export async function enqueueBackgroundTurn(
  userId: string,
  request: SquireRequest
): Promise<{ id: string }> {
  if (!(await getHistoryStatus()).enabled)
    throw new BackgroundTurnRefused(
      409,
      'Answers can only finish in the background when saved conversations are on. Keep this chat open, or ask an administrator to turn on saved conversations.'
    );
  const requestEncrypted = await encrypt(JSON.stringify(request));
  const id = randomUUID();
  await prisma.$transaction(async tx => {
    // One person's hand-offs are taken one at a time, so two at once cannot both slip under the cap.
    await acquireTextAdvisoryLocks(tx, [`squire-background:${userId}`]);
    const active = await tx.squireBackgroundTurn.count({
      where: { userId, status: { in: ACTIVE } },
    });
    if (active >= BACKGROUND_LIMITS.activePerPerson)
      throw new BackgroundTurnRefused(
        429,
        `You already have ${BACKGROUND_LIMITS.activePerPerson} answers working in the background. Wait for one to finish, or cancel one.`
      );
    await tx.squireBackgroundTurn.create({
      data: {
        id,
        userId,
        conversationId: request.conversationId ?? null,
        incidentId: request.incidentId ?? null,
        requestEncrypted,
      },
    });
  });
  return { id };
}

/** The person's background answers from the last day, newest first. */
export async function listBackgroundTurns(
  userId: string,
  now = new Date()
): Promise<BackgroundTurnView[]> {
  const rows = await prisma.squireBackgroundTurn.findMany({
    where: { userId, createdAt: { gt: new Date(now.getTime() - BACKGROUND_LIMITS.keepMs) } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: BACKGROUND_LIMITS.listed,
    select: {
      id: true,
      status: true,
      requestEncrypted: true,
      resultConversationId: true,
      failureCode: true,
      createdAt: true,
      completedAt: true,
    },
  });
  return Promise.all(
    rows.map(async row => ({
      id: row.id,
      title:
        titleOf((await readRequest(row.requestEncrypted))?.message ?? '') || 'Background answer',
      status: row.status as Status,
      conversationId: row.resultConversationId,
      failure:
        row.status === 'FAILED'
          ? (FAILURE_TEXT[row.failureCode as BackgroundFailure] ?? FAILURE_TEXT.ERROR)
          : null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    }))
  );
}

/** Stops one of the person's queued or running answers. Nothing is saved for it. */
export async function cancelBackgroundTurn(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.squireBackgroundTurn.updateMany({
    where: { id, userId, status: { in: ACTIVE } },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
  if (count) runningBackgroundTurns.get(id)?.controller.abort();
  return count > 0;
}

/**
 * True when the person handed a question in this conversation to the background after `since`. The chat
 * route then skips saving its own cut-off copy of that answer.
 */
export async function hasBackgroundHandOff(
  userId: string,
  conversationId: string | undefined,
  since: Date
): Promise<boolean> {
  return (
    (await prisma.squireBackgroundTurn.count({
      // Only a live hand-off: one the client already cancelled must not stop the interrupted copy being saved.
      where: {
        userId,
        conversationId: conversationId ?? null,
        createdAt: { gte: since },
        status: { in: ['QUEUED', 'RUNNING', 'DONE'] },
      },
    })) > 0
  );
}

/** Answers this process is running, so a cancel here stops one at once. */
export const runningBackgroundTurns = new Map<
  string,
  { controller: AbortController; done: Promise<void> }
>();

export async function notify(
  userId: string,
  id: string,
  _title: string,
  outcome: { conversationId: string | null; failure?: BackgroundFailure }
) {
  const name = (await getAiSettings().catch(() => null))?.squireName || 'Squire';
  await createInAppNotifications({
    userIds: [userId],
    type: 'SYSTEM',
    // The question stays encrypted: notifications outlive history retention, so they never repeat it.
    title: outcome.failure ? `${name} could not finish your answer` : `${name} finished your answer`,
    message: outcome.failure
      ? FAILURE_TEXT[outcome.failure]
      : 'Your answer is ready. Open it to read it in your conversation.',
    // Opens the assistant on the conversation (or on its list when there is none).
    entityType: 'SQUIRE_CONVERSATION',
    entityId: outcome.conversationId,
    dedupeKey: `squire-background:${id}`,
  });
}

export async function finish(
  id: string,
  status: 'DONE' | 'FAILED',
  extra: { conversationId?: string | null; failure?: BackgroundFailure } = {}
): Promise<boolean> {
  const { count } = await prisma.squireBackgroundTurn.updateMany({
    // Only a turn still queued or running: a cancelled one stays cancelled.
    where: { id, status: { in: ACTIVE } },
    data: {
      status,
      completedAt: new Date(),
      resultConversationId: extra.conversationId ?? null,
      failureCode: extra.failure ?? null,
    },
  });
  return count === 1;
}

export async function failTurn(id: string, failure: BackgroundFailure, error?: unknown) {
  if (error)
    logger.warn('[Squire] A background answer failed', {
      error: error instanceof Error ? error.name : 'error',
    });
  const row = await prisma.squireBackgroundTurn
    .findUnique({ where: { id }, select: { userId: true, requestEncrypted: true } })
    .catch(() => null);
  if (!row || !(await finish(id, 'FAILED', { failure }).catch(() => false))) return;
  const title =
    titleOf((await readRequest(row.requestEncrypted))?.message ?? '') || 'your question';
  await notify(row.userId, id, title, { conversationId: null, failure }).catch(() => undefined);
}

/**
 * Housekeeping, from the jobs runner (which never runs answers itself): with saved history off every
 * background answer is removed, questions included; answers a restart orphaned (running, or queued and never
 * picked up, for longer than `staleMs`) are marked failed and announced; anything older than a day is removed.
 */
export async function sweepBackgroundTurns(now = new Date()): Promise<void> {
  if (!(await getHistoryStatus()).enabled) {
    await prisma.squireBackgroundTurn.deleteMany({});
    return;
  }
  const staleBefore = new Date(now.getTime() - BACKGROUND_LIMITS.staleMs);
  const queuedBefore = new Date(now.getTime() - BACKGROUND_LIMITS.queuedMs);
  const stale = await prisma.squireBackgroundTurn.findMany({
    where: {
      OR: [
        { status: 'RUNNING', startedAt: { lt: staleBefore } },
        { status: 'QUEUED', createdAt: { lt: queuedBefore } },
      ],
      id: { notIn: [...runningBackgroundTurns.keys()] },
    },
    take: 50,
    select: { id: true, status: true },
  });
  for (const row of stale)
    await failTurn(row.id, row.status === 'QUEUED' ? 'NOT_STARTED' : 'INTERRUPTED');
  await prisma.squireBackgroundTurn.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - BACKGROUND_LIMITS.keepMs) } },
  });
}
