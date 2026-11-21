import 'server-only';
import { randomBytes } from 'node:crypto';
import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { decrypt, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { SquireInvestigationStep } from '@/lib/intelligence/squire/contract';
import { collectSquireTurn } from '@/lib/intelligence/squire/surfaces';
import { canAskSquire, squireInvestigationIdSchema } from './ask-squire-contract';
import { isAskSquireEnabled } from './ask-squire-settings';
import { prepareSquireMcpTurn, squireAnswerForMcp } from './ask-squire';
import { McpBoundaryError, requireMcp } from './errors';
import { projectMcpData } from './projection';

/**
 * `squire_start_investigation` / `squire_get_investigation`: the same read-only Squire turn as
 * `ask_squire` (the investigation engine runs when the question calls for it and an administrator
 * enabled it), but without the 30-second call limit. Start passes the same gates and returns an id
 * at once; the turn runs in this process and records its steps; get returns the progress and then
 * the answer. Only the person who started it, on the same connection, can read it, for one hour.
 */

export const SQUIRE_INVESTIGATION_TTL_MS = 3600_000;
/** How long one investigation may run before it is cut short with what it has. */
export const SQUIRE_INVESTIGATION_RUN_MS = 5 * 60_000;
/** A RUNNING row older than this lost its process (restart, crash) and is reported as failed. */
const STALE_MS = SQUIRE_INVESTIGATION_RUN_MS + 60_000;
/** Investigations one person may have running at once. */
export const SQUIRE_INVESTIGATIONS_PER_PERSON = 2;
export const SQUIRE_INVESTIGATION_POLL_MS = 5_000;

const LOST = 'The investigation stopped before it finished. Start it again.';

export async function startSquireInvestigationForMcp(
  actor: AuthorizationActor,
  grantId: string,
  args: unknown,
  options: { sensitiveReads?: boolean } = {}
) {
  const turn = await prepareSquireMcpTurn(actor, args, options);
  const now = new Date();
  const id = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + SQUIRE_INVESTIGATION_TTL_MS);
  // Serializable: two concurrent starts cannot both see a free slot.
  await runSerializableTransaction(async tx => {
    const running = await tx.squireMcpInvestigation.count({
      where: {
        actorId: actor.id,
        status: 'RUNNING',
        createdAt: { gt: new Date(now.getTime() - STALE_MS) },
      },
    });
    if (running >= SQUIRE_INVESTIGATIONS_PER_PERSON)
      throw new McpBoundaryError(
        'MCP_RATE_LIMITED',
        429,
        true,
        `Up to ${SQUIRE_INVESTIGATIONS_PER_PERSON} investigations can run at once; poll one until it finishes.`,
        { retryAfterSeconds: 30 }
      );
    await tx.squireMcpInvestigation.create({
      data: { id, actorId: actor.id, grantId, createdAt: now, expiresAt },
    });
  });
  void runInvestigation(id, turn);
  return {
    investigationId: id,
    status: 'running',
    pollIntervalMs: SQUIRE_INVESTIGATION_POLL_MS,
    expiresAt: expiresAt.toISOString(),
    note: 'Call squire_get_investigation with this investigationId until status is completed or failed.',
  };
}

/** What is stored, encrypted: model-written step titles and the answer can quote incident data. */
interface Payload {
  progress: SquireInvestigationStep[];
  result?: ReturnType<typeof squireAnswerForMcp>;
}
const seal = (payload: Payload) => encrypt(JSON.stringify(payload));

async function runInvestigation(
  id: string,
  turn: Awaited<ReturnType<typeof prepareSquireMcpTurn>>
) {
  const steps = new Map<number, SquireInvestigationStep>();
  const progress = () => [...steps.values()];
  // Progress writes run one at a time, in order; a failed write only delays the progress shown.
  let saving: Promise<unknown> = Promise.resolve();
  try {
    const answer = await collectSquireTurn(turn.person, turn.input, {
      timeoutMs: SQUIRE_INVESTIGATION_RUN_MS,
      scope: { readTools: turn.readTools },
      onEvent: event => {
        if (event.type !== 'investigation') return;
        steps.set(event.step.index, event.step);
        const snapshot = progress();
        saving = saving
          .then(async () =>
            prisma.squireMcpInvestigation.updateMany({
              where: { id, status: 'RUNNING' },
              data: { payloadEncrypted: await seal({ progress: snapshot }) },
            })
          )
          .catch(() => undefined);
      },
    });
    await saving;
    await prisma.squireMcpInvestigation.updateMany({
      where: { id },
      data: answer.error
        ? {
            status: 'FAILED',
            error: answer.error.slice(0, 500),
            payloadEncrypted: await seal({ progress: progress() }),
          }
        : {
            status: 'COMPLETED',
            payloadEncrypted: await seal({
              progress: progress(),
              result: squireAnswerForMcp(answer),
            }),
          },
    });
  } catch (error) {
    logger.warn('[MCP] Squire investigation failed', {
      name: error instanceof Error ? error.name : typeof error,
    });
    await prisma.squireMcpInvestigation
      .updateMany({ where: { id }, data: { status: 'FAILED', error: LOST } })
      .catch(() => undefined);
  }
}

export async function getSquireInvestigationForMcp(
  actor: AuthorizationActor,
  grantId: string,
  args: unknown
) {
  const parsed = squireInvestigationIdSchema.safeParse(args);
  requireMcp(parsed.success, 'MCP_INVALID_ARGUMENTS', 400);
  requireMcp(canAskSquire(actor), 'MCP_OPERATION_FORBIDDEN', 403);
  if (!(await isAskSquireEnabled({ fresh: true })))
    throw new McpBoundaryError('MCP_CAPABILITY_DISABLED', 403);
  const now = new Date();
  const row = await prisma.squireMcpInvestigation.findUnique({
    where: { id: parsed.data.investigationId },
  });
  // Unknown, expired and someone else's ids are indistinguishable.
  requireMcp(
    row && row.actorId === actor.id && row.grantId === grantId && row.expiresAt > now,
    'MCP_TASK_NOT_FOUND',
    404
  );
  const payload: Payload = row.payloadEncrypted
    ? (JSON.parse(await decrypt(row.payloadEncrypted)) as Payload)
    : { progress: [] };
  const lost = row.status === 'RUNNING' && row.createdAt.getTime() < now.getTime() - STALE_MS;
  const status = lost ? 'failed' : row.status.toLowerCase();
  return {
    investigationId: row.id,
    status,
    progress: payload.progress.map(step => ({
      // Step titles are written by the planner model from what it read: business text.
      title: projectMcpData(step.title),
      status: step.status,
      reads: step.calls.map(call => call.label),
    })),
    ...(status === 'running' ? { pollIntervalMs: SQUIRE_INVESTIGATION_POLL_MS } : {}),
    ...(status === 'completed' && payload.result ? { result: payload.result } : {}),
    ...(status === 'failed' ? { error: lost ? LOST : (row.error ?? LOST) } : {}),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Bounded retention on the MCP maintenance run: answers are deleted once unreadable. */
export async function cleanupExpiredSquireInvestigations(now = new Date()) {
  const expired = await prisma.squireMcpInvestigation.findMany({
    where: { expiresAt: { lt: now } },
    take: 500,
    orderBy: { expiresAt: 'asc' },
    select: { id: true },
  });
  const { count } = await prisma.squireMcpInvestigation.deleteMany({
    where: { id: { in: expired.map(row => row.id) } },
  });
  return count;
}
