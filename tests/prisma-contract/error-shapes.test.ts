/* eslint-disable security/detect-object-injection -- keys are fixed scenario names, array indices or test-owned object keys, never external input */
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  createContractClient,
  disconnectContractClients,
  requireEnv,
  withParams,
} from './support/client';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('error-shapes');
const RUN = `contract-errors-${process.pid}-${Date.now()}`;

let prisma: PrismaClient;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

const raiseSql = (sqlState: string) =>
  `DO $$ BEGIN RAISE EXCEPTION 'contract %', '${sqlState}' USING ERRCODE = '${sqlState}'; END $$`;

beforeAll(async () => {
  prisma = createContractClient(requireEnv('CONTRACT_DATABASE_URL'));
  await prisma.user.create({
    data: { id: `${RUN}-user`, name: 'Contract', email: `${RUN}@example.test` },
  });
  await prisma.team.create({ data: { id: `${RUN}-team`, name: `${RUN}-team` } });
  await prisma.teamMember.create({ data: { userId: `${RUN}-user`, teamId: `${RUN}-team` } });
  await prisma.ingestionQuota.createMany({
    data: ['a', 'b'].map(suffix => ({
      key: `${RUN}-${suffix}`,
      tokens: 1,
      rate: 1,
      burst: 1,
      updatedAt: new Date(),
      lastAllowed: true,
    })),
  });
});

afterAll(async () => {
  await prisma.teamMember.deleteMany({ where: { teamId: `${RUN}-team` } });
  await prisma.team.deleteMany({ where: { id: `${RUN}-team` } });
  await prisma.user.deleteMany({ where: { id: `${RUN}-user` } });
  await prisma.ingestionQuota.deleteMany({ where: { key: { startsWith: RUN } } });
  await disconnectContractClients();
});

describe('constraint and lookup errors', () => {
  it('unique violation on a single-column unique (model)', async () => {
    golden.observe(
      'model.uniqueEmail',
      await outcome(() =>
        prisma.user.create({ data: { name: 'Dup', email: `${RUN}@example.test` } })
      )
    );
  });

  it('unique violation on a composite unique (model)', async () => {
    golden.observe(
      'model.uniqueComposite',
      await outcome(() =>
        prisma.teamMember.create({ data: { userId: `${RUN}-user`, teamId: `${RUN}-team` } })
      )
    );
  });

  it('unique violation inside an interactive transaction (model)', async () => {
    golden.observe(
      'model.uniqueInTransaction',
      await outcome(() =>
        prisma.$transaction(tx => tx.team.create({ data: { name: `${RUN}-team` } }))
      )
    );
  });

  it('unique violation via upsert race surface (model createMany)', async () => {
    golden.observe(
      'model.uniqueCreateMany',
      await outcome(() => prisma.team.createMany({ data: [{ name: `${RUN}-team` }] }))
    );
  });

  it('foreign key violation (model)', async () => {
    golden.observe(
      'model.foreignKey',
      await outcome(() =>
        prisma.teamMember.create({ data: { userId: `${RUN}-missing`, teamId: `${RUN}-team` } })
      )
    );
  });

  it('record not found (model)', async () => {
    golden.observe(
      'model.updateMissing',
      await outcome(() =>
        prisma.team.update({ where: { id: `${RUN}-missing` }, data: { description: 'x' } })
      )
    );
    golden.observe(
      'model.findUniqueOrThrowMissing',
      await outcome(() => prisma.team.findUniqueOrThrow({ where: { id: `${RUN}-missing` } }))
    );
    golden.observe(
      'model.deleteMissing',
      await outcome(() => prisma.team.delete({ where: { id: `${RUN}-missing` } }))
    );
  });

  it('unique violation (raw)', async () => {
    golden.observe(
      'raw.uniqueEmail',
      await outcome(
        () => prisma.$executeRaw`
          INSERT INTO "User" (id, name, email, "updatedAt")
          VALUES (${`${RUN}-dup`}, 'Dup', ${`${RUN}@example.test`}, now())`
      )
    );
  });

  it('foreign key violation (raw)', async () => {
    golden.observe(
      'raw.foreignKey',
      await outcome(
        () => prisma.$executeRaw`
          INSERT INTO "TeamMember" (id, "userId", "teamId")
          VALUES (${`${RUN}-fk`}, ${`${RUN}-missing`}, ${`${RUN}-team`})`
      )
    );
  });

  it('raised SQLSTATEs (raw)', async () => {
    for (const state of ['40001', '40P01', '23505', '23503', '57014', '55P03', '22P02', 'P0001']) {
      golden.observe(
        `raw.raise.${state}`,
        await outcome(() => prisma.$executeRawUnsafe(raiseSql(state)))
      );
      golden.observe(
        `raw.raiseInTransaction.${state}`,
        await outcome(() => prisma.$transaction(tx => tx.$executeRawUnsafe(raiseSql(state))))
      );
    }
  });

  it('syntax error and missing relation (raw)', async () => {
    golden.observe('raw.syntax', await outcome(() => prisma.$queryRawUnsafe('SELEC 1')));
    golden.observe(
      'raw.missingTable',
      await outcome(() => prisma.$queryRawUnsafe('SELECT * FROM "NoSuchContractTable"'))
    );
    golden.observe(
      'raw.invalidInput',
      await outcome(() => prisma.$queryRawUnsafe(`SELECT 'abc'::int`))
    );
  });

  it('statement timeout (raw)', async () => {
    golden.observe(
      'raw.statementTimeout',
      await outcome(() =>
        prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = 50`);
          await tx.$queryRawUnsafe(`SELECT pg_sleep(1)`);
        })
      )
    );
  });
});

describe('concurrency errors', () => {
  it('real serialization failure between two Serializable transactions (model)', async () => {
    const bothRead = [deferred(), deferred()];
    const run = (index: 0 | 1) =>
      prisma.$transaction(
        async tx => {
          await tx.ingestionQuota.findMany({ where: { key: { startsWith: RUN } } });
          bothRead[index].resolve();
          await Promise.all(bothRead.map(d => d.promise));
          await tx.ingestionQuota.update({
            where: { key: `${RUN}-${index === 0 ? 'a' : 'b'}` },
            data: { tokens: { increment: 1 } },
          });
          await sleep(50);
        },
        { isolationLevel: 'Serializable', timeout: 10000 }
      );
    const results = await Promise.all([outcome(() => run(0)), outcome(() => run(1))]);
    const failures = results.filter(r => (r as { ok: boolean }).ok === false);
    golden.observe('model.serializationFailure', {
      failures: failures.length,
      failure: failures[0] ?? null,
    });
  });

  it('real deadlock between two transactions (raw advisory locks)', async () => {
    const locked = [deferred(), deferred()];
    const run = (index: 0 | 1) =>
      prisma.$transaction(
        async tx => {
          const [first, second] = index === 0 ? [9101, 9102] : [9102, 9101];
          await tx.$queryRawUnsafe(
            `SELECT TRUE AS ok FROM (SELECT pg_advisory_xact_lock(${first})) l`
          );
          locked[index].resolve();
          await Promise.all(locked.map(d => d.promise));
          await tx.$queryRawUnsafe(
            `SELECT TRUE AS ok FROM (SELECT pg_advisory_xact_lock(${second})) l`
          );
        },
        { timeout: 15000 }
      );
    const results = await Promise.all([outcome(() => run(0)), outcome(() => run(1))]);
    const failures = results.filter(r => (r as { ok: boolean }).ok === false);
    golden.observe('raw.deadlock', { failures: failures.length, failure: failures[0] ?? null });
  });
});

describe('transaction lifecycle errors', () => {
  it('interactive transaction timeout', async () => {
    golden.observe(
      'tx.timeout',
      await outcome(() =>
        prisma.$transaction(
          async tx => {
            await sleep(400);
            await tx.$queryRaw`SELECT 1`;
          },
          { timeout: 100 }
        )
      )
    );
  });

  it('pool exhaustion: query and transaction start time out', async () => {
    const tiny = createContractClient(
      withParams(requireEnv('CONTRACT_DATABASE_URL'), {
        connection_limit: '1',
        pool_timeout: '1',
      })
    );
    const release = deferred();
    const holding = deferred();
    const holder = tiny.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT 1`;
        holding.resolve();
        await release.promise;
      },
      { timeout: 20000, maxWait: 5000 }
    );
    await holding.promise;
    golden.observe('pool.queryWhileExhausted', await outcome(() => tiny.$queryRaw`SELECT 1`));
    golden.observe(
      'pool.transactionMaxWait',
      await outcome(() =>
        tiny.$transaction(async tx => tx.$queryRaw`SELECT 1`, { maxWait: 200, timeout: 2000 })
      )
    );
    release.resolve();
    await holder;
    golden.observe('pool.recoversAfterRelease', await outcome(() => tiny.$queryRaw`SELECT 1`));
  });
});

describe('connectivity errors', () => {
  it('connection refused', async () => {
    const dead = createContractClient(
      withParams(requireEnv('CONTRACT_DATABASE_URL'), { connect_timeout: '2' }).replace(
        /:\d+\//,
        ':1/'
      )
    );
    golden.observe('connect.refusedRaw', await outcome(() => dead.$queryRaw`SELECT 1`));
    golden.observe('connect.refusedModel', await outcome(() => dead.team.count()));
  });

  it('wrong password', async () => {
    const url = new URL(requireEnv('CONTRACT_DATABASE_URL'));
    url.password = 'wrong-password';
    const denied = createContractClient(url.toString());
    golden.observe('connect.authFailed', await outcome(() => denied.team.count()));
  });

  it('unknown database', async () => {
    const url = new URL(requireEnv('CONTRACT_DATABASE_URL'));
    url.pathname = '/no_such_contract_db';
    const missing = createContractClient(url.toString());
    golden.observe('connect.unknownDatabase', await outcome(() => missing.team.count()));
  });

  it('backend terminated by an administrator, then recovery', async () => {
    const victim = createContractClient(
      withParams(requireEnv('CONTRACT_DATABASE_URL'), { connection_limit: '1' })
    );
    const [{ pid }] = await victim.$queryRaw<Array<{ pid: number }>>`
      SELECT pg_backend_pid() AS pid`;
    await prisma.$queryRaw`SELECT pg_terminate_backend(${pid}::int) AS terminated`;
    await sleep(100);
    golden.observe('connect.terminatedNextQuery', await outcome(() => victim.$queryRaw`SELECT 1`));
    let recovered = false;
    for (let attempt = 0; attempt < 5 && !recovered; attempt += 1) {
      recovered = ((await outcome(() => victim.$queryRaw`SELECT 1`)) as { ok: boolean }).ok;
      if (!recovered) await sleep(200);
    }
    golden.observe('connect.recoversAfterTermination', recovered);
  });
});
