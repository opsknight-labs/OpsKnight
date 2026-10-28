import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import prisma, { disconnectPrisma } from '@/lib/prisma';
import { withMcpDatabase } from '@/lib/database-workload';

beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Owned local test database required');
  }
  // Never let an inherited alternate datasource direct isolation probes elsewhere.
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.MCP_DATABASE_POOL_SIZE = '2';
});
afterAll(disconnectPrisma);

describe('real MCP PostgreSQL isolation', () => {
  it('uses separate backend connections with hard SQL and lock budgets', async () => {
    const primary = await prisma.$queryRaw<{ pid: number; timeout: string }[]>`
      SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS timeout`;
    const mcp = await withMcpDatabase(
      () => prisma.$queryRaw<
        {
          pid: number;
          timeout: string;
          lock: string;
          idle: string;
        }[]
      >`SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS timeout,
      current_setting('lock_timeout') AS lock, current_setting('idle_in_transaction_session_timeout') AS idle`
    );
    expect(mcp[0].pid).not.toBe(primary[0].pid);
    expect(mcp[0]).toMatchObject({ timeout: '5s', lock: '1s', idle: '5s' });
    const primaryAfter = await prisma.$queryRaw<{ timeout: string }[]>`
      SELECT current_setting('statement_timeout') AS timeout`;
    expect(primaryAfter[0].timeout).toBe(primary[0].timeout);
    // The explicit transaction client must retain the same MCP budget.
    const transaction = await withMcpDatabase(() =>
      prisma.$transaction(
        tx =>
          tx.$queryRaw<
            { timeout: string }[]
          >`SELECT current_setting('statement_timeout') AS timeout`
      )
    );
    expect(transaction[0].timeout).toBe('5s');
  });

  it('sheds an exhausted MCP pool while primary reads continue', async () => {
    const work = withMcpDatabase(() => [
      Promise.resolve(prisma.$queryRaw`SELECT pg_sleep(2.5)`),
      Promise.resolve(prisma.$queryRaw`SELECT pg_sleep(2.5)`),
    ]);
    const settled = Promise.allSettled(work);
    try {
      let active = 0;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const rows = await prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = 'opsknight-mcp'
            AND state = 'active' AND query LIKE 'SELECT pg_sleep%'`;
        active = rows[0].count;
        if (active === 2) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(active).toBe(2);
      const primary = await prisma.$queryRaw<{ value: number }[]>`SELECT 1::int AS value`;
      expect(primary[0].value).toBe(1);
      await expect(withMcpDatabase(() => prisma.$queryRaw`SELECT 1`)).rejects.toMatchObject({
        code: 'P2024',
      });
    } finally {
      await settled;
    }
  });

  it('PostgreSQL cancels a query beyond the MCP SQL deadline and the pool recovers', async () => {
    await expect(withMcpDatabase(() => prisma.$queryRaw`SELECT pg_sleep(6)`)).rejects.toMatchObject(
      {
        code: 'P2010',
        meta: { code: '57014' },
      }
    );
    const rows = await withMcpDatabase(
      () => prisma.$queryRaw<{ value: number }[]>`SELECT 1::int AS value`
    );
    expect(rows[0].value).toBe(1);
    expect((await prisma.$queryRaw<{ value: number }[]>`SELECT 1::int AS value`)[0].value).toBe(1);
  });

  it('abandons a contended lock without changing the primary transaction', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const paused = new Promise<void>(resolve => {
      release = resolve;
    });
    const lock = Math.floor(Math.random() * 2_000_000_000);
    const holder = prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock}::bigint)::text`;
        entered();
        await paused;
        return tx.$queryRaw<{ value: number }[]>`SELECT 1::int AS value`;
      },
      { timeout: 10000 }
    );
    const settled = Promise.allSettled([holder]);
    try {
      await Promise.race([started, holder]);
      await expect(
        withMcpDatabase(() =>
          prisma.$transaction(
            tx => tx.$queryRaw`SELECT pg_advisory_xact_lock(${lock}::bigint)::text`
          )
        )
      ).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    } finally {
      release();
      await settled;
    }
    expect((await holder)[0].value).toBe(1);
  });
});
