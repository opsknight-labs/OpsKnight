import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import { runV2AuditedMutation, type V2AuditParams } from './audit';
import { recordIdempotency } from './observability';
import {
  executeIdempotentOperation,
  readIdempotentOperationResult,
  type IdempotentExecution,
} from '@/lib/idempotency';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

export async function runV2IdempotentMutation<T>(
  req: NextRequest,
  principalId: string,
  scope: string,
  payload: unknown,
  execute: (tx: Prisma.TransactionClient) => Promise<T>,
  onReplay?: (tx: Prisma.TransactionClient) => Promise<void>,
  persistResult?: (value: T) => T
): Promise<IdempotentExecution<T>> {
  const idempotencyKey = req.headers.get('idempotency-key')?.trim();

  if (!idempotencyKey) {
    return runSerializableTransaction(async tx => {
      const value = await execute(tx);
      return { value, replayed: false };
    });
  }

  const context = { key: idempotencyKey, principalId };
  try {
    return await runSerializableTransaction(async tx => {
      return executeIdempotentOperation(tx, {
        scope,
        context,
        payload,
        execute: () => execute(tx),
        onReplay,
        persistResult,
      });
    });
  } catch (error) {
    // A retry with the same key and If-Match can lose the race to its own first attempt: it waits on the
    // row lock, then sees the revision that attempt just wrote. That attempt's receipt is the answer.
    const precondition = error instanceof AppError && error.code === 'PRECONDITION_FAILED';
    if (!isUniqueConstraintError(error) && !precondition) throw error;
    // Concurrent requests can race on a business unique key or on the durable
    // idempotency receipt itself. Re-read in a fresh snapshot: if the same key
    // committed, return that receipt; otherwise report a resource conflict.
    const replay = await prisma.$transaction(tx =>
      readIdempotentOperationResult<T>(tx, { scope, context, payload, onReplay })
    );
    if (replay) return replay;
    // A real stale revision (another key changed it) stays a 412.
    if (precondition) throw error;
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage: 'The requested resource conflicts with a concurrent change.',
    });
  }
}

export function idempotencyResponseHeaders(replayed: boolean): Record<string, string> {
  if (replayed) {
    recordIdempotency('replayed');
    return { 'Idempotency-Replayed': 'true' };
  }
  return {};
}

/**
 * Idempotent create with a mandatory audit record: when an Idempotency-Key is
 * present, the mutation, its audit event and the replay record commit in one
 * transaction, and a replay returns the stored result without a second audit.
 */
export async function runV2IdempotentAuditedMutation<T>(
  req: NextRequest,
  principalId: string,
  scope: string,
  payload: unknown,
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
  audit: (result: T) => V2AuditParams
): Promise<IdempotentExecution<T>> {
  return runV2IdempotentMutation(req, principalId, scope, payload, tx =>
    runV2AuditedMutation(mutate, audit, tx)
  );
}
