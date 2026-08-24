import { describe, expect, it } from 'vitest';
import { acquireAdvisoryLock } from '@/lib/db-locks';
import { testPrisma } from '../helpers/test-db';

describe('database advisory locks', () => {
  it('acquires a transaction-scoped lock without deserializing PostgreSQL void', async () => {
    const result = await testPrisma.$transaction(async tx => {
      await acquireAdvisoryLock(tx, BigInt(9141002));

      return tx.$queryRaw<Array<{ value: number }>>`SELECT 1 AS value`;
    });

    expect(result).toEqual([{ value: 1 }]);
  });
});
