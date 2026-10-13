import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
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
    return { 'Idempotency-Replayed': 'true' };
  }
  return {};
}
