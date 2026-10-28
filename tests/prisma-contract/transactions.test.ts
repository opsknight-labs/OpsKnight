/* eslint-disable security/detect-object-injection -- keys are fixed scenario names, array indices or test-owned object keys, never external input */
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { acquireAdvisoryLock, acquireSharedAdvisoryLock, tryAdvisoryLock } from '@/lib/db-locks';
import { createContractClient, disconnectContractClients, requireEnv } from './support/client';
import { describeValue } from './support/describe';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('transactions');
const RUN = `contract-tx-${process.pid}-${Date.now()}`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => (resolve = r));
  return { promise, resolve };
}

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createContractClient(requireEnv('CONTRACT_DATABASE_URL'));
  await prisma.ingestionQuota.createMany({
    data: Array.from({ length: 6 }, (_, i) => ({
      key: `${RUN}-${i}`,
      tokens: 0,
      rate: 1,
      burst: 1,
      updatedAt: new Date(),
      lastAllowed: false,
    })),
  });
});

afterAll(async () => {
  await prisma.ingestionQuota.deleteMany({ where: { key: { startsWith: RUN } } });
  await prisma.team.deleteMany({ where: { name: { startsWith: RUN } } });
  await disconnectContractClients();
});

describe('isolation levels', () => {
  for (const level of [undefined, 'ReadCommitted', 'RepeatableRead', 'Serializable'] as const) {
    it(`applies ${level ?? 'default'}`, async () => {
      golden.observe(
        `isolation.${level ?? 'default'}`,
        await outcome(
          () =>
            prisma.$transaction(
              tx =>
                tx.$queryRaw<
                  Array<{ level: string }>
                >`SELECT current_setting('transaction_isolation') AS level`,
              level ? { isolationLevel: level } : undefined
            ),
          rows => rows[0]?.level
        )
      );
    });
  }

  it('applies isolation to batch transactions', async () => {
    golden.observe(
      'isolation.batchSerializable',
      await outcome(
        () =>
          prisma.$transaction(
            [
              prisma.$queryRaw<
                Array<{ level: string }>
              >`SELECT current_setting('transaction_isolation') AS level`,
            ],
            { isolationLevel: 'Serializable' }
          ),
        ([rows]) => rows[0]?.level
      )
    );
  });
});

describe('atomicity', () => {
  it('rolls back an interactive transaction that throws', async () => {
    const name = `${RUN}-rollback`;
    const result = await outcome(() =>
      prisma.$transaction(async tx => {
        await tx.team.create({ data: { name } });
        throw new Error('contract rollback');
      })
    );
    golden.observe('atomic.interactiveRollback', {
      threw: (result as { ok: boolean }).ok === false,
      persisted: await prisma.team.count({ where: { name } }),
    });
  });

  it('rolls back a batch transaction when one statement fails', async () => {
    const name = `${RUN}-batch`;
    const result = await outcome(() =>
      prisma.$transaction([
        prisma.team.create({ data: { name } }),
        prisma.$executeRawUnsafe(`SELECT 'x'::int`),
      ])
    );
    golden.observe('atomic.batchRollback', {
      threw: (result as { ok: boolean }).ok === false,
      persisted: await prisma.team.count({ where: { name } }),
    });
  });

  it('returns batch results in order', async () => {
    golden.observe(
      'atomic.batchResults',
      await outcome(
        () =>
          prisma.$transaction([
            prisma.$queryRaw<Array<{ v: number }>>`SELECT 1::int AS v`,
            prisma.ingestionQuota.count({ where: { key: { startsWith: RUN } } }),
            prisma.$executeRaw`UPDATE "IngestionQuota" SET tokens = tokens WHERE key LIKE ${`${RUN}-%`}`,
          ]),
        results => results.map(r => describeValue(r))
      )
    );
  });
});

describe('row locking and SKIP LOCKED claims', () => {
  it('two concurrent workers claim disjoint rows', async () => {
    const claimedBoth = [deferred(), deferred()];
    const claim = (index: 0 | 1) =>
      prisma.$transaction(
        async tx => {
          const rows = await tx.$queryRaw<Array<{ key: string }>>`
            SELECT key FROM "IngestionQuota"
            WHERE key LIKE ${`${RUN}-%`}
            ORDER BY key
            FOR UPDATE SKIP LOCKED
            LIMIT 3`;
          claimedBoth[index].resolve();
          await Promise.all(claimedBoth.map(d => d.promise));
          await tx.$executeRaw`
            UPDATE "IngestionQuota" SET "lastAllowed" = true
            WHERE key = ANY(${rows.map(r => r.key)}::text[])`;
          return rows.map(r => r.key);
        },
        { timeout: 10000 }
      );
    const [a, b] = await Promise.all([claim(0), claim(1)]);
    const overlap = a.filter(key => b.includes(key));
    golden.observe('claims.skipLocked', {
      sizes: [a.length, b.length].sort(),
      overlap: overlap.length,
      claimedRows: await prisma.ingestionQuota.count({
        where: { key: { startsWith: RUN }, lastAllowed: true },
      }),
    });
  });
});

describe('advisory locks (OpsKnight helpers)', () => {
  it('exclusive lock blocks try-lock until commit', async () => {
    const key = BigInt(Date.now() % 1_000_000) + BigInt(7_000_000);
    const held = deferred();
    const release = deferred();
    const holder = prisma.$transaction(
      async tx => {
        await acquireAdvisoryLock(tx, key);
        held.resolve();
        await release.promise;
      },
      { timeout: 10000 }
    );
    await held.promise;
    const whileHeld = await prisma.$transaction(tx => tryAdvisoryLock(tx, key));
    release.resolve();
    await holder;
    const afterCommit = await prisma.$transaction(tx => tryAdvisoryLock(tx, key));
    golden.observe('advisory.exclusive', { whileHeld, afterCommit });
  });

  it('shared locks coexist and exclude the exclusive lock', async () => {
    const key = BigInt(Date.now() % 1_000_000) + BigInt(8_000_000);
    const held = [deferred(), deferred()];
    const release = deferred();
    const sharedHolder = (index: 0 | 1) =>
      prisma.$transaction(
        async tx => {
          await acquireSharedAdvisoryLock(tx, key);
          held[index].resolve();
          await release.promise;
        },
        { timeout: 10000 }
      );
    const holders = [sharedHolder(0), sharedHolder(1)];
    await Promise.all(held.map(d => d.promise));
    const exclusiveWhileShared = await prisma.$transaction(tx => tryAdvisoryLock(tx, key));
    release.resolve();
    await Promise.all(holders);
    golden.observe('advisory.shared', { bothSharedHeld: true, exclusiveWhileShared });
  });

  it('exclusive acquisition waits rather than failing', async () => {
    const key = BigInt(Date.now() % 1_000_000) + BigInt(9_000_000);
    const held = deferred();
    const holder = prisma.$transaction(
      async tx => {
        await acquireAdvisoryLock(tx, key);
        held.resolve();
        await sleep(300);
      },
      { timeout: 10000 }
    );
    await held.promise;
    const startedAt = Date.now();
    const waiter = await outcome(() =>
      prisma.$transaction(tx => acquireAdvisoryLock(tx, key), { timeout: 10000 })
    );
    await holder;
    golden.observe('advisory.waits', { waiter, waitedAtLeast200ms: Date.now() - startedAt >= 200 });
  });
});
