/* eslint-disable security/detect-object-injection -- keys are fixed scenario names, array indices or test-owned object keys, never external input */
import { afterAll, describe, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { configurePrismaDatasource } from '@/lib/prisma-datasource';
import { createContractClient, disconnectContractClients, requireEnv } from './support/client';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('session-pooling');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

afterAll(disconnectContractClients);

async function sessionSettings(prisma: PrismaClient) {
  return outcome(
    () =>
      prisma.$queryRaw<Array<Record<string, string>>>`
        SELECT current_setting('statement_timeout') AS "statementTimeout",
               current_setting('jit') AS jit,
               current_setting('TimeZone') AS "timeZone",
               current_setting('search_path') AS "searchPath",
               current_schema() AS "currentSchema",
               current_setting('DateStyle') AS "dateStyle",
               current_setting('client_encoding') AS "clientEncoding",
               current_setting('extra_float_digits') AS "extraFloatDigits"`,
    rows => rows[0]
  );
}

/** Highest number of distinct server backends observed while saturating the client pool. */
async function maxConcurrentBackends(prisma: PrismaClient, concurrency: number) {
  const pids = await Promise.all(
    Array.from(
      { length: concurrency },
      () =>
        prisma.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid() AS pid FROM (SELECT pg_sleep(0.3)) s`
    )
  );
  return new Set(pids.map(rows => rows[0]?.pid)).size;
}

describe('application datasource configuration (direct PostgreSQL)', () => {
  const raw = () => requireEnv('CONTRACT_DATABASE_URL');

  it('bare URL session settings', async () => {
    golden.observe('direct.bare', await sessionSettings(createContractClient(raw())));
  });

  it('OpsKnight-configured worker URL session settings', async () => {
    const url = configurePrismaDatasource(raw(), undefined, false)!;
    golden.observe('direct.configured', await sessionSettings(createContractClient(url)));
  });

  it('operator-supplied options are preserved verbatim', async () => {
    const parsed = new URL(raw());
    parsed.searchParams.set('options', '-c statement_timeout=1234');
    const url = configurePrismaDatasource(parsed.toString(), undefined, false)!;
    golden.observe('direct.operatorOptions', await sessionSettings(createContractClient(url)));
  });

  it('role pool size bounds concurrent server connections', async () => {
    const url = configurePrismaDatasource(raw(), '2', false)!;
    golden.observe(
      'direct.poolSize2.maxBackends',
      await maxConcurrentBackends(createContractClient(url), 6)
    );
  });

  it('legacy connection_limit in the URL is honoured', async () => {
    const parsed = new URL(raw());
    parsed.searchParams.set('connection_limit', '3');
    const url = configurePrismaDatasource(parsed.toString(), undefined, false)!;
    golden.observe(
      'direct.connectionLimit3.maxBackends',
      await maxConcurrentBackends(createContractClient(url), 8)
    );
  });

  it('explicit schema parameter is honoured', async () => {
    const parsed = new URL(raw());
    parsed.searchParams.set('schema', 'public');
    golden.observe(
      'direct.schemaPublic',
      await sessionSettings(createContractClient(parsed.toString()))
    );
  });
});

describe('PgBouncer transaction pooling', () => {
  const pooledUrl = () =>
    configurePrismaDatasource(requireEnv('CONTRACT_PGBOUNCER_URL'), '5', true)!;

  it('session settings through PgBouncer', async () => {
    golden.observe(
      'pgbouncer.configured',
      await sessionSettings(createContractClient(pooledUrl()))
    );
  });

  it('session settings through PgBouncer in front of a non-UTC server', async () => {
    const url = configurePrismaDatasource(requireEnv('CONTRACT_PGBOUNCER_TZ_URL'), '5', true)!;
    golden.observe('pgbouncerTz.configured', await sessionSettings(createContractClient(url)));
  });

  it('session settings on a non-UTC server (direct)', async () => {
    const url = configurePrismaDatasource(
      requireEnv('CONTRACT_TZ_DATABASE_URL'),
      undefined,
      false
    )!;
    golden.observe('directTz.configured', await sessionSettings(createContractClient(url)));
  });

  it('repeated and concurrent statements never collide on prepared statements', async () => {
    const prisma = createContractClient(pooledUrl());
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        outcome(async () => {
          const rows = await prisma.$queryRaw<Array<{ v: number }>>`SELECT ${i}::int AS v`;
          const count = await prisma.team.count();
          return rows[0]?.v === i && typeof count === 'number';
        })
      )
    );
    golden.observe(
      'pgbouncer.preparedStatementSafety',
      results.every(r => JSON.stringify(r) === JSON.stringify({ ok: true, value: 'ok' }))
        ? 'all-ok'
        : results.find(r => (r as { ok: boolean }).ok === false)
    );
  });

  it('interactive transactions keep one server connection', async () => {
    const prisma = createContractClient(pooledUrl());
    golden.observe(
      'pgbouncer.transactionAffinity',
      await outcome(
        () =>
          Promise.all(
            Array.from({ length: 10 }, () =>
              prisma.$transaction(async tx => {
                const [{ pid: first }] = await tx.$queryRaw<
                  Array<{ pid: number }>
                >`SELECT pg_backend_pid() AS pid`;
                await tx.$queryRaw`SELECT TRUE AS ok FROM (SELECT pg_advisory_xact_lock(424242)) l`;
                await sleep(10);
                const [{ pid: second }] = await tx.$queryRaw<
                  Array<{ pid: number }>
                >`SELECT pg_backend_pid() AS pid`;
                return first === second;
              })
            )
          ),
        same => same.every(Boolean)
      )
    );
  });

  it('a failed transaction does not poison pooled server connections', async () => {
    const prisma = createContractClient(pooledUrl());
    const failed = await outcome(() =>
      prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = 25`);
        await tx.$queryRawUnsafe(`SELECT pg_sleep(1)`);
      })
    );
    const after = await Promise.all(
      Array.from({ length: 12 }, () => outcome(() => prisma.$queryRaw`SELECT 1 AS ok`))
    );
    golden.observe('pgbouncer.afterFailure', {
      failed,
      allHealthy: after.every(r => (r as { ok: boolean }).ok),
    });
  });

  it('PgBouncer reports no leaked active server connections afterwards', async () => {
    await sleep(300);
    const admin = new Client({ connectionString: requireEnv('CONTRACT_PGBOUNCER_ADMIN_URL') });
    await admin.connect();
    try {
      const pools = await admin.query({ text: 'SHOW POOLS', rowMode: 'array' });
      const columns = pools.fields.map(f => f.name);
      const rows = pools.rows
        .map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])))
        .filter(row => row.database === 'opsknight_contract');
      golden.observe('pgbouncer.poolsAfterLoad', {
        serverActive: rows.reduce((sum, row) => sum + Number(row.sv_active ?? 0), 0),
        clientWaiting: rows.reduce((sum, row) => sum + Number(row.cl_waiting ?? 0), 0),
      });
    } finally {
      await admin.end();
    }
  });
});
