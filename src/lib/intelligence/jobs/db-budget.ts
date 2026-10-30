import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

type Client = Prisma.TransactionClient | typeof prisma;

/**
 * Runs `work` in a transaction whose statements are bounded by statement_timeout and lock_timeout,
 * so intelligence queries can never hold database resources the paging path needs.
 * set_config(..., true) is transaction-local; SET LOCAL cannot take bind parameters.
 */
export async function withDbBudget<T>(
  budget: { maxDbMs: number },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
  client: typeof prisma = prisma
): Promise<T> {
  const statementMs = Math.max(50, Math.floor(budget.maxDbMs));
  const lockMs = Math.max(50, Math.min(statementMs, 2000));
  return client.$transaction(
    async tx => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(statementMs)}, true), set_config('lock_timeout', ${String(lockMs)}, true)`;
      return work(tx);
    },
    { maxWait: Math.min(statementMs, 5000), timeout: statementMs + 5000 }
  );
}

export type { Client as IntelligenceDbClient };
