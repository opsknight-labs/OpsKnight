import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import { runV2AuditedMutation, type V2AuditParams } from './audit';
import { recordIdempotency } from './observability';
import {
  executeIdempotentOperation,
  type IdempotentExecution,
} from '@/lib/idempotency';

export async function runV2IdempotentMutation<T>(
  req: NextRequest,
  principalId: string,
  scope: string,
  payload: unknown,
  execute: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<IdempotentExecution<T>> {
  const idempotencyKey = req.headers.get('idempotency-key')?.trim();

  if (!idempotencyKey) {
    return runSerializableTransaction(async tx => {
      const value = await execute(tx);
      return { value, replayed: false };
    });
  }

  return runSerializableTransaction(async tx => {
    return executeIdempotentOperation(tx, {
      scope,
      context: {
        key: idempotencyKey,
        principalId,
      },
      payload,
      execute: () => execute(tx),
    });
  });
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
