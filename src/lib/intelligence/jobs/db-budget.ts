import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * The lane runs each handler inside this store, so every budgeted transaction the handler opens, however
 * deep in the call stack, is cancelled when the handler's time budget expires. Without this a timed-out
 * handler keeps running and holds its pool connection until its own statements finish.
 */
const ambientSignal = new AsyncLocalStorage<AbortSignal>();

export function withAbortableDbWork<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return ambientSignal.run(signal, work);
}

/** A cancelled statement that is still holding its connection after this long is terminated outright. */
const TERMINATE_AFTER_MS = 1_000;

function abortedError(): Error {
  const error = new Error('Intelligence database work was aborted before it started');
  error.name = 'AbortError';
  return error;
}

async function stopBackend(client: typeof prisma, pid: number, mode: 'cancel' | 'terminate') {
  try {
    if (mode === 'cancel') await client.$queryRaw`SELECT pg_cancel_backend(${pid}::int)`;
    else await client.$queryRaw`SELECT pg_terminate_backend(${pid}::int)`;
  } catch (error) {
    logger.debug('[Intelligence] Could not stop a budgeted statement', {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Runs `work` in a transaction whose statements are bounded by statement_timeout and lock_timeout,
 * so intelligence queries can never hold database resources the paging path needs.
 * set_config(..., true) is transaction-local; SET LOCAL cannot take bind parameters.
 *
 * When an abort signal is given (or ambient from the lane), aborting cancels the statement currently
 * running in this transaction from another connection, and terminates the backend if it has not let go
 * a second later. The work then fails with a database error that is classified as cancelled or busy.
 */
export async function withDbBudget<T>(
  budget: { maxDbMs: number },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  client: typeof prisma = prisma,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const statementMs = Math.max(50, Math.floor(budget.maxDbMs));
  const lockMs = Math.max(50, Math.min(statementMs, 2000));
  const signal = options.signal ?? ambientSignal.getStore();
  if (signal?.aborted) throw abortedError();
  return client.$transaction(
    async tx => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT set_config('statement_timeout', ${String(statementMs)}, true),
               set_config('lock_timeout', ${String(lockMs)}, true),
               pg_backend_pid() AS pid`;
      if (!signal) return work(tx);
      let finished = false;
      let terminate: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        void stopBackend(client, pid, 'cancel');
        terminate = setTimeout(() => {
          if (!finished) void stopBackend(client, pid, 'terminate');
        }, TERMINATE_AFTER_MS);
        terminate.unref?.();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        return await work(tx);
      } finally {
        finished = true;
        signal.removeEventListener('abort', onAbort);
        if (terminate) clearTimeout(terminate);
      }
    },
    { maxWait: Math.min(statementMs, 5000), timeout: statementMs + 5000 }
  );
}

/** The database clock: discovery bounds and eligibility windows must not depend on application clock skew. */
export async function dbNow(client: Client): Promise<Date> {
  const [{ now }] = await client.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
  return now;
}

export type { Client as IntelligenceDbClient };
