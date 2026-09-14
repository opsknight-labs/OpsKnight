import { describe, expect, it, vi } from 'vitest';

const transaction = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ default: { $transaction: transaction } }));

import { runSerializableTransaction } from '@/lib/db-utils';

describe('transaction retry helpers', () => {
  it('retries structural Prisma write-conflict errors from a generated client', async () => {
    transaction
      .mockRejectedValueOnce({ code: 'P2034', message: 'Transaction failed due to a write conflict.' })
      .mockImplementationOnce(async (operation: (tx: object) => Promise<string>) => operation({}));

    await expect(runSerializableTransaction(async () => 'committed', 2)).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
