import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-utils', () => ({ runReadCommittedTransaction: vi.fn() }));
vi.mock('@/lib/incidents/lifecycle', () => ({ applyIncidentLifecycleCommand: vi.fn() }));
vi.mock('@/lib/incidents/event-identity', () => ({ lockEventDedupKeys: vi.fn() }));

import { withSavepoint } from '@/lib/db-savepoint';
import { checkAlertFlapping } from '@/lib/flapping';

function fakeTx(queryRaw: () => Promise<unknown>) {
  const statements: string[] = [];
  return {
    statements,
    tx: {
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        statements.push(sql);
        return 0;
      }),
      $queryRaw: vi.fn(async () => {
        statements.push('QUERY');
        return queryRaw();
      }),
    },
  };
}

describe('withSavepoint', () => {
  it('releases the savepoint when the optional work succeeds', async () => {
    const { tx, statements } = fakeTx(async () => []);
    await expect(withSavepoint(tx, 'opt_read', async () => 'ok')).resolves.toBe('ok');
    expect(statements).toEqual(['SAVEPOINT opt_read', 'RELEASE SAVEPOINT opt_read']);
  });

  it('rolls back to the savepoint, then rethrows, when the work fails', async () => {
    const { tx, statements } = fakeTx(async () => []);
    await expect(
      withSavepoint(tx, 'opt_read', async () => {
        throw new Error('canceling statement due to statement timeout');
      })
    ).rejects.toThrow('statement timeout');
    expect(statements).toEqual([
      'SAVEPOINT opt_read',
      'ROLLBACK TO SAVEPOINT opt_read',
      'RELEASE SAVEPOINT opt_read',
    ]);
  });

  it('does nothing on the pooled root client, which has no transaction to protect', async () => {
    const root = { $transaction: vi.fn(), $executeRawUnsafe: vi.fn() };
    await expect(withSavepoint(root, 'opt_read', async () => 7)).resolves.toBe(7);
    expect(root.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects a name that is not a plain identifier', async () => {
    const { tx } = fakeTx(async () => []);
    await expect(withSavepoint(tx, 'x; DROP TABLE "Alert"', async () => 1)).rejects.toThrow(
      'Invalid savepoint name'
    );
  });
});

describe('checkAlertFlapping inside the processing transaction', () => {
  it('falls back to "not flapping" and leaves the transaction usable when the query fails', async () => {
    const { tx, statements } = fakeTx(async () => {
      throw new Error('canceling statement due to statement timeout');
    });
    const result = await checkAlertFlapping('dedup-1', 'svc-1', undefined, tx as never);
    expect(result).toEqual({ isFlapping: false, transitionCount: 0 });
    expect(statements).toEqual([
      'SAVEPOINT opsknight_flapping_check',
      'QUERY',
      'ROLLBACK TO SAVEPOINT opsknight_flapping_check',
      'RELEASE SAVEPOINT opsknight_flapping_check',
    ]);
  });

  it('releases the savepoint when the query succeeds', async () => {
    const { tx, statements } = fakeTx(async () => []);
    const result = await checkAlertFlapping('dedup-1', 'svc-1', undefined, tx as never);
    expect(result.isFlapping).toBe(false);
    expect(statements).toEqual([
      'SAVEPOINT opsknight_flapping_check',
      'QUERY',
      'RELEASE SAVEPOINT opsknight_flapping_check',
    ]);
  });
});
